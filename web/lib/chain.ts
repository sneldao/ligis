import "server-only";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import {
  PHAROS_AGENT_ID_ABI,
  CREDENTIAL_REGISTRY_ABI,
} from "@ligis/adapter-evm";
import networks from "../../assets/networks.json";
import credentialsRef from "../../assets/credentials.example.json";

/** EVM network slug used when a caller does not name one explicitly. */
export const DEFAULT_EVM_NETWORK = "atlantic-testnet";

/** Shape of the network/deployment records read from assets/networks.json. */
type NetworkRecord = {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeToken: { symbol: string; name: string; decimals: number };
};
type DeploymentRecord = {
  pharosAgentId: string;
  credentialRegistry: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
};
type NetworksConfig = {
  networks: Record<string, NetworkRecord>;
  deployment: Record<string, DeploymentRecord>;
};

const config = networks as unknown as NetworksConfig;

/**
 * Per-network RPC overrides, keyed by network so one global override can never
 * point two chains at the same endpoint.
 */
const RPC_OVERRIDES: Record<string, string | undefined> = {
  "atlantic-testnet": process.env.PHAROS_RPC_URL,
  "monad-testnet": process.env.LIGIS_MONAD_RPC_URL,
};

/**
 * Event-history limits, per network.
 *
 * `LOG_CHUNK` is the largest block range the network's public RPC accepts in a
 * single `eth_getLogs` call — exceeding it is an error, not a partial result.
 * `LOG_REQUESTS` caps how many calls a page render will make, so the scan
 * window is `LOG_CHUNK * LOG_REQUESTS` blocks, newest first.
 *
 * Monad public RPC (Sep 2026) accepts `eth_getLogs` but caps the range at 100
 * blocks — not a method rejection. Deeper history is free via Envio HyperIndex
 * (`LIGIS_ENVIO_GRAPHQL_URL`); see `packages/envio-indexer/`. When Envio is
 * configured, Monad issuer / capability history skips this RPC path entirely.
 */
const LOG_CHUNK: Record<string, bigint> = {
  // Measured limit: 1000 blocks inclusive. 200k was requested historically and
  // silently failed, which is why issuer history looked permanently empty.
  "atlantic-testnet": 1_000n,
  // Measured 2026-09-24: "eth_getLogs is limited to a 100 range".
  "monad-testnet": 100n,
};

const LOG_REQUESTS: Record<string, number> = {
  "atlantic-testnet": 25,
  // 100 × 60 = 6k blocks ≈ 30 min at 300 ms — recent window only. Full history
  // needs Envio (free HyperIndex / HyperRPC with a free API token).
  "monad-testnet": 60,
};

export type EvmReadContext = {
  networkId: string;
  chain: ReturnType<typeof defineChain>;
  client: ReturnType<typeof createPublicClient>;
  addresses: { pharosAgentId: Address; credentialRegistry: Address };
  explorerUrl: string;
  rpcUrl: string;
};

const contexts = new Map<string, EvmReadContext>();

/** Network slugs that have both a network entry and a recorded deployment. */
export function evmNetworkIds(): string[] {
  return Object.keys(config.deployment).filter((id) =>
    Boolean(config.networks[id]),
  );
}

export function hasEvmDeployment(networkId: string): boolean {
  return Boolean(config.networks[networkId] && config.deployment[networkId]);
}

/**
 * Build (and memoize) the read context for a network. Throws when the network
 * has no recorded deployment, so a read can never silently fall through to
 * another chain's contracts.
 */
export function getEvmReadContext(
  networkId: string = DEFAULT_EVM_NETWORK,
): EvmReadContext {
  const cached = contexts.get(networkId);
  if (cached) return cached;

  const net = config.networks[networkId];
  const dep = config.deployment[networkId];
  if (!net || !dep) {
    throw new Error(`No EVM network/deployment configured for "${networkId}".`);
  }

  const rpcUrl = RPC_OVERRIDES[networkId] ?? net.rpcUrl;
  const chain = defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency: {
      name: net.nativeToken.name,
      symbol: net.nativeToken.symbol,
      decimals: net.nativeToken.decimals,
    },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: { name: net.name, url: net.explorerUrl },
    },
  });

  const ctx: EvmReadContext = {
    networkId,
    chain,
    client: createPublicClient({
      chain,
      transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }),
    }),
    addresses: {
      pharosAgentId: dep.pharosAgentId as Address,
      credentialRegistry: dep.credentialRegistry as Address,
    },
    explorerUrl: net.explorerUrl,
    rpcUrl,
  };
  contexts.set(networkId, ctx);
  return ctx;
}

/*
 * Legacy Pharos-bound exports. The Trust Steward and a few editorial surfaces
 * are Pharos-specific by design; everything chain-selectable goes through
 * `chain-router.ts`, which passes the selected network explicitly.
 */
const defaultContext = getEvmReadContext(DEFAULT_EVM_NETWORK);
export const pharosAtlantic = defaultContext.chain;
export const publicClient = defaultContext.client;
export const addresses = defaultContext.addresses;

export { network } from "./network";

export async function readAgentId(
  wallet: Address,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<bigint> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "walletOfAgent",
    args: [wallet],
  })) as bigint;
}

export async function readOwnerOf(
  tokenId: bigint,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<Address> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address;
}

export async function readTotalSupply(
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<bigint> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "totalSupply",
    args: [],
  })) as bigint;
}

export async function readBlockNumber(
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<bigint> {
  const { client } = getEvmReadContext(networkId);
  return await client.getBlockNumber();
}

export async function isCapable(
  subject: Address,
  capabilityHash: Hex,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<boolean> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capabilityHash],
  })) as boolean;
}

export async function isCapableMulti(
  subject: Address,
  capabilityHashes: readonly Hex[],
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<boolean[]> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "isCapableMulti",
    args: [subject, capabilityHashes],
  })) as boolean[];
}

export async function readTokenUri(
  tokenId: bigint,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<string> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "tokenURI",
    args: [tokenId],
  })) as string;
}

export type CapabilityRef = {
  id: string;
  label: string;
  hash: Hex;
  description: string;
};

export const capabilities: ReadonlyArray<CapabilityRef> =
  credentialsRef.capabilities.map((c) => ({
    id: c.id,
    label: c.label,
    hash: c.hash as Hex,
    description: c.description,
  }));

export type CredentialView = {
  issuer: Address;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  valid: boolean;
};

export type HeldCredential = {
  capability: CapabilityRef;
  view: CredentialView;
};

export async function readCredential(
  subject: Address,
  capabilityHash: Hex,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<CredentialView> {
  const { client, addresses } = getEvmReadContext(networkId);
  return (await client.readContract({
    address: addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "latestCredential",
    args: [subject, capabilityHash],
  })) as CredentialView;
}

export type AgentSnapshot = {
  exists: boolean;
  tokenId: bigint;
  controller: Address | null;
  tokenUri: string;
  held: HeldCredential[];
};

export async function readAgentSnapshot(
  wallet: Address,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<AgentSnapshot> {
  const tokenId = await readAgentId(wallet, networkId).catch(() => 0n);
  if (tokenId === 0n) {
    return {
      exists: false,
      tokenId: 0n,
      controller: null,
      tokenUri: "",
      held: [],
    };
  }

  const [controller, tokenUri, capableResults, ...views] = await Promise.all([
    readOwnerOf(tokenId, networkId).catch(() => null as Address | null),
    readTokenUri(tokenId, networkId).catch(() => ""),
    isCapableMulti(
      wallet,
      capabilities.map((c) => c.hash),
      networkId,
    ).catch(() => capabilities.map(() => false)),
    ...capabilities.map((c) =>
      readCredential(wallet, c.hash, networkId).catch(() => null),
    ),
  ]);

  const held: HeldCredential[] = [];
  capabilities.forEach((cap, i) => {
    const view = views[i] as CredentialView | null;
    const capable = capableResults[i];
    if (capable && view && view.valid && !view.revoked) {
      held.push({ capability: cap, view });
    }
  });

  return {
    exists: true,
    tokenId,
    controller: controller as Address,
    tokenUri: tokenUri as string,
    held,
  };
}

export type IssuerActivity = {
  issuer: Address;
  count: number;
  lastSeen: bigint;
};

export type IssuanceLog = {
  blockRange: { from: bigint; to: bigint };
  truncated: boolean;
  issuers: IssuerActivity[];
  totalIssuances: number;
  /**
   * True when the history read itself failed. Some RPCs reject or mis-serve
   * `eth_getLogs`, and "no issuers" must not be shown when the truth is
   * "could not read". Prefer Envio GraphQL when configured.
   */
  unavailable: boolean;
  /** Where the rows came from — drives copy on `/issuers`. */
  source: "envio" | "rpc" | "none";
};

const CREDENTIAL_ISSUED_EVENT = {
  type: "event",
  name: "CredentialIssued",
  inputs: [
    { name: "issuer", type: "address", indexed: true },
    { name: "subject", type: "address", indexed: true },
    { name: "capabilityHash", type: "bytes32", indexed: true },
    // Order must match CredentialRegistry.sol (topic0 depends on it).
    { name: "nonce", type: "uint256", indexed: false },
    { name: "issuedAt", type: "uint64", indexed: false },
    { name: "expiresAt", type: "uint64", indexed: false },
  ],
} as const;

/** A log entry narrowed to the fields these readers actually consume. */
type ScannedLog = {
  args: unknown;
  blockNumber: bigint;
  transactionHash?: Hex;
  logIndex: number;
};

/**
 * Scan a block window for a registry event, newest block first, in chunks the
 * network's public RPC will accept.
 *
 * Returns `null` when the first chunk fails, so callers can distinguish "no
 * activity" from "this RPC cannot serve history at all".
 */
async function scanRegistryLogs(
  networkId: string,
  event: object,
  args: object | undefined,
): Promise<{ logs: ScannedLog[]; range: { from: bigint; to: bigint } } | null> {
  const ctx = getEvmReadContext(networkId);
  const chunk = LOG_CHUNK[networkId] ?? 1_000n;
  const maxRequests = LOG_REQUESTS[networkId] ?? 10;

  try {
    const head = await ctx.client.getBlockNumber();
    const logs: ScannedLog[] = [];
    let scannedFrom = head;

    for (let i = 0; i < maxRequests; i++) {
      const toBlock = head - BigInt(i) * chunk;
      if (toBlock < 0n) break;
      const fromBlock = toBlock > chunk ? toBlock - chunk + 1n : 0n;

      const page = await ctx.client.getLogs({
        address: ctx.addresses.credentialRegistry,
        event,
        args,
        fromBlock,
        toBlock,
      } as Parameters<typeof ctx.client.getLogs>[0]);

      logs.push(...(page as unknown as ScannedLog[]));
      scannedFrom = fromBlock;
      if (fromBlock === 0n) break;
    }

    return { logs, range: { from: scannedFrom, to: head } };
  } catch {
    // A rejected first call means history is not readable here at all.
    return null;
  }
}

export async function readIssuerActivity(
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<IssuanceLog> {
  if (networkId === "monad-testnet") {
    const { readIssuerActivityFromEnvio } = await import("./envio");
    const fromEnvio = await readIssuerActivityFromEnvio();
    if (fromEnvio) return fromEnvio;
  }

  const scan = await scanRegistryLogs(
    networkId,
    CREDENTIAL_ISSUED_EVENT,
    undefined,
  );
  if (!scan) {
    return {
      blockRange: { from: 0n, to: 0n },
      truncated: false,
      issuers: [],
      totalIssuances: 0,
      unavailable: true,
      source: "none",
    };
  }

  const tally = new Map<Address, { count: number; lastSeen: bigint }>();
  for (const log of scan.logs) {
    const issuer = (log.args as { issuer?: Address }).issuer;
    if (!issuer) continue;
    const prev = tally.get(issuer);
    tally.set(issuer, {
      count: (prev?.count ?? 0) + 1,
      lastSeen:
        prev && prev.lastSeen > log.blockNumber
          ? prev.lastSeen
          : log.blockNumber,
    });
  }

  const issuers = Array.from(tally.entries())
    .map(([issuer, v]) => ({ issuer, count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count || (b.lastSeen > a.lastSeen ? 1 : -1));

  return {
    blockRange: scan.range,
    truncated: scan.range.from > 0n,
    issuers,
    totalIssuances: scan.logs.length,
    unavailable: false,
    source: "rpc",
  };
}

/** Read unique agent addresses (subjects) from recent CredentialIssued events. */
export async function readRecentSubjects(
  limit = 100,
  networkId: string = DEFAULT_EVM_NETWORK,
): Promise<Address[]> {
  const scan = await scanRegistryLogs(
    networkId,
    CREDENTIAL_ISSUED_EVENT,
    undefined,
  );
  if (!scan) return [];

  const seen = new Set<Address>();
  for (const log of scan.logs) {
    const subject = (log.args as { subject?: Address }).subject;
    if (subject) seen.add(subject);
  }
  return Array.from(seen).slice(0, limit);
}

export { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI };

// ---------- Capability change history (AgentCapabilityChanged events) ----------

const AGENT_CAPABILITY_CHANGED_EVENT = {
  type: "event",
  name: "AgentCapabilityChanged",
  inputs: [
    { name: "subject", type: "address", indexed: true },
    { name: "capabilityHash", type: "bytes32", indexed: true },
    { name: "capable", type: "bool", indexed: false },
  ],
} as const;

export type CapabilityChange = {
  capabilityHash: Hex;
  capable: boolean;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
};

export async function readCapabilityHistory(
  subject: Address,
  opts?: { fromBlock?: bigint; toBlock?: bigint; networkId?: string },
  networkId: string = opts?.networkId ?? DEFAULT_EVM_NETWORK,
): Promise<CapabilityChange[]> {
  if (networkId === "monad-testnet") {
    const { readCapabilityHistoryFromEnvio } = await import("./envio");
    const fromEnvio = await readCapabilityHistoryFromEnvio(subject);
    if (fromEnvio) {
      const fromFilter = opts?.fromBlock;
      const toFilter = opts?.toBlock;
      return fromEnvio
        .filter((h) =>
          fromFilter === undefined ? true : h.blockNumber >= fromFilter,
        )
        .filter((h) =>
          toFilter === undefined ? true : h.blockNumber <= toFilter,
        );
    }
  }

  const scan = await scanRegistryLogs(
    networkId,
    AGENT_CAPABILITY_CHANGED_EVENT,
    {
      subject,
    },
  );
  if (!scan) return [];

  const fromFilter = opts?.fromBlock;
  const toFilter = opts?.toBlock;

  return scan.logs
    .filter((log) =>
      fromFilter === undefined ? true : log.blockNumber >= fromFilter,
    )
    .filter((log) =>
      toFilter === undefined ? true : log.blockNumber <= toFilter,
    )
    .map((log) => ({
      capabilityHash:
        (log.args as { capabilityHash?: Hex }).capabilityHash ?? ("0x" as Hex),
      capable: (log.args as { capable?: boolean }).capable ?? false,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash ?? ("0x" as Hex),
      logIndex: log.logIndex,
    }))
    .sort((a, b) =>
      b.blockNumber > a.blockNumber
        ? 1
        : b.blockNumber < a.blockNumber
          ? -1
          : b.logIndex - a.logIndex,
    );
}
