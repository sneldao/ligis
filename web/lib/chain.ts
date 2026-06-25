import "server-only";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI } from "@ligis/abi";
import networks from "../../assets/networks.json";
import credentialsRef from "../../assets/credentials.example.json";

const atlantic = networks.networks["atlantic-testnet"];
const deployment = networks.deployment["atlantic-testnet"];

const RPC_URL = process.env.PHAROS_RPC_URL ?? atlantic.rpcUrl;
if (!RPC_URL) {
  console.warn("[ligis] No PHAROS_RPC_URL set and no fallback in networks.json — chain reads will fail.");
}

export const pharosAtlantic = defineChain({
  id: atlantic.chainId,
  name: atlantic.name,
  nativeCurrency: {
    name: atlantic.nativeToken.name,
    symbol: atlantic.nativeToken.symbol,
    decimals: atlantic.nativeToken.decimals,
  },
  rpcUrls: {
    default: { http: [atlantic.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "PharosScan", url: atlantic.explorerUrl },
  },
});

export const publicClient = createPublicClient({
  chain: pharosAtlantic,
  transport: http(RPC_URL, {
    retryCount: 3,
    timeout: 20_000,
  }),
});

export const addresses = {
  pharosAgentId: deployment.pharosAgentId as Address,
  credentialRegistry: deployment.credentialRegistry as Address,
};

export { network } from "./network";

export async function readAgentId(wallet: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "walletOfAgent",
    args: [wallet],
  })) as bigint;
}

export async function readOwnerOf(tokenId: bigint): Promise<Address> {
  return (await publicClient.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address;
}

export async function readTotalSupply(): Promise<bigint> {
  return (await publicClient.readContract({
    address: addresses.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "totalSupply",
    args: [],
  })) as bigint;
}

export async function readBlockNumber(): Promise<bigint> {
  return await publicClient.getBlockNumber();
}

export async function isCapable(
  subject: Address,
  capabilityHash: Hex
): Promise<boolean> {
  return (await publicClient.readContract({
    address: addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "isCapable",
    args: [subject, capabilityHash],
  })) as boolean;
}

export async function isCapableMulti(
  subject: Address,
  capabilityHashes: readonly Hex[]
): Promise<boolean[]> {
  return (await publicClient.readContract({
    address: addresses.credentialRegistry,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "isCapableMulti",
    args: [subject, capabilityHashes],
  })) as boolean[];
}

export async function readTokenUri(tokenId: bigint): Promise<string> {
  return (await publicClient.readContract({
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

export const capabilities: ReadonlyArray<CapabilityRef> = credentialsRef.capabilities.map(
  (c) => ({
    id: c.id,
    label: c.label,
    hash: c.hash as Hex,
    description: c.description,
  })
);

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
  capabilityHash: Hex
): Promise<CredentialView> {
  return (await publicClient.readContract({
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

export async function readAgentSnapshot(wallet: Address): Promise<AgentSnapshot> {
  const tokenId = await readAgentId(wallet).catch(() => 0n);
  if (tokenId === 0n) {
    return { exists: false, tokenId: 0n, controller: null, tokenUri: "", held: [] };
  }

  const [controller, tokenUri, capableResults, ...views] = await Promise.all([
    readOwnerOf(tokenId).catch(() => null as Address | null),
    readTokenUri(tokenId).catch(() => ""),
    isCapableMulti(wallet, capabilities.map((c) => c.hash)).catch(() =>
      capabilities.map(() => false)
    ),
    ...capabilities.map((c) => readCredential(wallet, c.hash).catch(() => null)),
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
};

const CREDENTIAL_ISSUED_EVENT = {
  type: "event",
  name: "CredentialIssued",
  inputs: [
    { name: "issuer", type: "address", indexed: true },
    { name: "subject", type: "address", indexed: true },
    { name: "capabilityHash", type: "bytes32", indexed: true },
    { name: "nonce", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export async function readIssuerActivity(): Promise<IssuanceLog> {
  try {
    const head = await publicClient.getBlockNumber();
    const SPAN = 200_000n;
    const fromBlock = head > SPAN ? head - SPAN : 0n;

    const logs = await publicClient.getLogs({
      address: addresses.credentialRegistry,
      event: CREDENTIAL_ISSUED_EVENT,
      fromBlock,
      toBlock: head,
    });

    const tally = new Map<Address, { count: number; lastSeen: bigint }>();
    for (const log of logs) {
      const issuer = (log.args as { issuer?: Address }).issuer;
      if (!issuer) continue;
      const prev = tally.get(issuer);
      tally.set(issuer, {
        count: (prev?.count ?? 0) + 1,
        lastSeen:
          prev && prev.lastSeen > log.blockNumber ? prev.lastSeen : log.blockNumber,
      });
    }

    const issuers = Array.from(tally.entries())
      .map(([issuer, v]) => ({ issuer, count: v.count, lastSeen: v.lastSeen }))
      .sort((a, b) => b.count - a.count || (b.lastSeen > a.lastSeen ? 1 : -1));

    return {
      blockRange: { from: fromBlock, to: head },
      truncated: fromBlock > 0n,
      issuers,
      totalIssuances: logs.length,
    };
  } catch {
    return {
      blockRange: { from: 0n, to: 0n },
      truncated: false,
      issuers: [],
      totalIssuances: 0,
    };
  }
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
  opts?: { fromBlock?: bigint; toBlock?: bigint }
): Promise<CapabilityChange[]> {
  try {
    const head = opts?.toBlock ?? (await publicClient.getBlockNumber());
    const SPAN = 200_000n;
    const fromBlock = opts?.fromBlock ?? (head > SPAN ? head - SPAN : 0n);

    const logs = await publicClient.getLogs({
      address: addresses.credentialRegistry,
      event: AGENT_CAPABILITY_CHANGED_EVENT,
      args: { subject },
      fromBlock,
      toBlock: head,
    });

    return logs
      .map((log) => ({
        capabilityHash: (log.args as { capabilityHash?: Hex }).capabilityHash ?? "0x" as Hex,
        capable: (log.args as { capable?: boolean }).capable ?? false,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash ?? "0x" as Hex,
        logIndex: log.logIndex,
      }))
      .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : b.logIndex - a.logIndex));
  } catch {
    return [];
  }
}
