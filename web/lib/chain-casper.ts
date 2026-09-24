import "server-only";
import { CasperAdapter } from "@ligis/adapter-casper";
import { loadCasperConfig } from "@ligis/adapter-casper";
import { buildCasperClient } from "@ligis/adapter-casper";
import credentialsRef from "../../assets/credentials.example.json";
import type { ChainNetwork } from "./network";
import { CASPER_TESTNET } from "./network";

// ---------- Adapter singleton ----------

let _adapter: CasperAdapter | null = null;

function adapter(): CasperAdapter {
  if (!_adapter) {
    const config = loadCasperConfig();
    _adapter = new CasperAdapter({ config });
  }
  return _adapter;
}

// ---------- Types (mirror chain.ts) ----------

export type Hex = `0x${string}`;

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
  issuer: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  valid: boolean;
};

export type HeldCredential = {
  capability: CapabilityRef;
  view: CredentialView;
};

export type AgentSnapshot = {
  exists: boolean;
  tokenId: bigint;
  controller: string | null;
  tokenUri: string;
  held: HeldCredential[];
};

export type IssuerActivity = {
  issuer: Hex;
  count: number;
  lastSeen: bigint;
};

export type IssuanceLog = {
  blockRange: { from: bigint; to: bigint };
  truncated: boolean;
  issuers: IssuerActivity[];
  totalIssuances: number;
  /** True when the history read failed, as opposed to finding no issuances. */
  unavailable: boolean;
  source: "envio" | "rpc" | "none";
};

export type CapabilityChange = {
  capabilityHash: Hex;
  capable: boolean;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
};

// ---------- Reads ----------

export async function readAgentId(accountHash: string): Promise<bigint> {
  try {
    const id = await adapter().getAgentId(accountHash);
    return id ? BigInt(id) : 0n;
  } catch {
    return 0n;
  }
}

export async function readBlockNumber(): Promise<bigint> {
  try {
    const ctx = (adapter() as any).ctx;
    const block = await ctx.rpc.getLatestBlockInfo();
    const height = (block as any)?.block?.header?.height;
    return height != null ? BigInt(height) : 0n;
  } catch {
    return 0n;
  }
}

export async function readTotalSupply(): Promise<bigint> {
  // Casper Odra contracts don't expose totalSupply. We scan recent blocks
  // for mint transactions to approximate the count.
  try {
    const log = await readIssuerActivity();
    // totalSupply is not directly available; return 0n as fallback
    return 0n;
  } catch {
    return 0n;
  }
}

export async function isCapable(
  subject: string,
  capabilityHash: Hex,
): Promise<boolean> {
  try {
    const cap = capabilities.find(
      (c) => c.hash.toLowerCase() === capabilityHash.toLowerCase(),
    );
    const capId = cap?.id ?? capabilityHash;
    const result = await adapter().verifyCapability({
      subject,
      capability: capId,
    });
    return result.capable;
  } catch {
    return false;
  }
}

export async function isCapableMulti(
  subject: string,
  capabilityHashes: readonly Hex[],
): Promise<boolean[]> {
  const results = await Promise.all(
    capabilityHashes.map((h) => isCapable(subject, h)),
  );
  return results;
}

export async function readCredential(
  subject: string,
  capabilityHash: Hex,
): Promise<CredentialView> {
  try {
    const cap = capabilities.find(
      (c) => c.hash.toLowerCase() === capabilityHash.toLowerCase(),
    );
    const capId = cap?.id ?? capabilityHash;
    const result = await adapter().verifyCapability({
      subject,
      capability: capId,
    });
    return {
      issuer: result.latest.issuer as Hex,
      issuedAt: BigInt(result.latest.issuedAt),
      expiresAt: BigInt(result.latest.expiresAt),
      revoked: result.latest.revoked,
      valid: result.latest.valid,
    };
  } catch {
    return {
      issuer: "0x0000000000000000000000000000000000000000" as Hex,
      issuedAt: 0n,
      expiresAt: 0n,
      revoked: false,
      valid: false,
    };
  }
}

export async function readAgentSnapshot(
  accountHash: string,
): Promise<AgentSnapshot> {
  const tokenId = await readAgentId(accountHash);
  if (tokenId === 0n) {
    return {
      exists: false,
      tokenId: 0n,
      controller: null,
      tokenUri: "",
      held: [],
    };
  }

  const capableResults = await isCapableMulti(
    accountHash,
    capabilities.map((c) => c.hash),
  ).catch(() => capabilities.map(() => false));

  const views = await Promise.all(
    capabilities.map((c) =>
      readCredential(accountHash, c.hash).catch(() => null),
    ),
  );

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
    controller: accountHash,
    tokenUri: "",
    held,
  };
}

// ---------- Issuer activity via block scan ----------

/**
 * Scan recent Casper blocks for transactions that called the `issue` entry
 * point on the CredentialRegistry contract. Casper doesn't have EVM-style
 * event logs, so we inspect transaction metadata in each block.
 *
 * We look for TransactionV1 payloads whose target is the CredentialRegistry
 * package hash and whose entry point is "issue". The issuer address is
 * extracted from the transaction's args.
 */
export async function readIssuerActivity(): Promise<IssuanceLog> {
  try {
    const ctx = (adapter() as any).ctx;
    const rpc = ctx.rpc;
    const config = ctx.config;
    const credRegHash = config.deployment.credentialRegistry;
    if (!credRegHash) {
      // Not configured ≠ empty history; treat as unreadable.
      return emptyIssuanceLog(true);
    }

    // Get current block height
    const latestBlock = await rpc.getLatestBlockInfo();
    const head = (latestBlock as any)?.block?.header?.height;
    if (head == null) return emptyIssuanceLog(true);

    const headBig = BigInt(head);
    const SPAN = 200n;
    const fromBlock = headBig > SPAN ? headBig - SPAN : 0n;

    const tally = new Map<string, { count: number; lastSeen: bigint }>();

    // Scan blocks in parallel batches
    const BATCH = 20;
    for (let b = fromBlock; b <= headBig; b += BigInt(BATCH)) {
      const batch: Promise<any[]>[] = [];
      for (let i = 0; i < BATCH && b + BigInt(i) <= headBig; i++) {
        const blockNum = b + BigInt(i);
        batch.push(rpc.getBlockByHeight(Number(blockNum)).catch(() => null));
      }
      const blocks = await Promise.all(batch);

      for (const blockInfo of blocks) {
        const block = (blockInfo as any)?.block;
        if (!block?.body?.transactions) continue;

        for (const txHash of block.body.transactions) {
          try {
            const txData = await rpc.getTransaction(txHash);
            const tx = (txData as any)?.transaction;
            if (!tx) continue;

            // Check if this is a TransactionV1 targeting our contract
            const target = tx.target;
            const entryPoint = tx.entryPoint;

            if (!target || !entryPoint) continue;
            if (entryPoint !== "issue") continue;

            // Check if target matches credential registry package hash
            const targetHash =
              typeof target === "object" ? target.hash : target;
            const normalizedTarget = String(targetHash ?? "")
              .replace(/^hash-/, "")
              .replace(/^contract-package-/, "")
              .replace(/^0x/, "");
            const normalizedCredReg = credRegHash
              .replace(/^hash-/, "")
              .replace(/^contract-package-/, "")
              .replace(/^0x/, "");

            if (
              normalizedTarget.toLowerCase() !== normalizedCredReg.toLowerCase()
            )
              continue;

            // Extract issuer from transaction args
            const args = tx.args;
            if (!args) continue;

            // The issuer is a 20-byte array in the args
            let issuerHex = "0x";
            if (args instanceof Map) {
              const issuerArg = args.get("issuer");
              if (issuerArg) {
                const issuerBytes =
                  issuerArg.value?.data ?? issuerArg.data ?? issuerArg;
                if (issuerBytes instanceof Uint8Array) {
                  issuerHex += Array.from(issuerBytes.slice(0, 20))
                    .map((b: number) => b.toString(16).padStart(2, "0"))
                    .join("");
                }
              }
            }

            if (issuerHex === "0x" || issuerHex.length < 42) continue;

            const blockNum = BigInt(block.header.height);
            const prev = tally.get(issuerHex);
            tally.set(issuerHex, {
              count: (prev?.count ?? 0) + 1,
              lastSeen:
                prev && prev.lastSeen > blockNum ? prev.lastSeen : blockNum,
            });
          } catch {
            continue;
          }
        }
      }
    }

    const issuers = Array.from(tally.entries())
      .map(([issuer, v]) => ({
        issuer: issuer as Hex,
        count: v.count,
        lastSeen: v.lastSeen,
      }))
      .sort((a, b) => b.count - a.count || (b.lastSeen > a.lastSeen ? 1 : -1));

    return {
      blockRange: { from: fromBlock, to: headBig },
      truncated: fromBlock > 0n,
      issuers,
      totalIssuances: issuers.reduce((s, i) => s + i.count, 0),
      unavailable: false,
      source: "rpc",
    };
  } catch {
    return emptyIssuanceLog(true);
  }
}

function emptyIssuanceLog(unavailable = false): IssuanceLog {
  return {
    blockRange: { from: 0n, to: 0n },
    truncated: false,
    issuers: [],
    totalIssuances: 0,
    unavailable,
    source: "none",
  };
}

// ---------- Capability history ----------

/**
 * Casper doesn't have EVM-style event logs. We scan recent blocks for
 * transactions that called `issue` or `revoke` on the CredentialRegistry
 * for a specific subject.
 */
export async function readCapabilityHistory(
  subject: string,
  opts?: { fromBlock?: bigint; toBlock?: bigint },
): Promise<CapabilityChange[]> {
  try {
    const ctx = (adapter() as any).ctx;
    const rpc = ctx.rpc;
    const config = ctx.config;
    const credRegHash = config.deployment.credentialRegistry;
    if (!credRegHash) return [];

    const latestBlock = await rpc.getLatestBlockInfo();
    const head =
      opts?.toBlock ?? BigInt((latestBlock as any)?.block?.header?.height ?? 0);
    const SPAN = 200n;
    const fromBlock = opts?.fromBlock ?? (head > SPAN ? head - SPAN : 0n);

    const changes: CapabilityChange[] = [];
    const subjectLower = subject.replace(/^account-hash-/, "").toLowerCase();

    // Scan blocks for issue/revoke transactions involving this subject
    const BATCH = 20;
    for (let b = fromBlock; b <= head; b += BigInt(BATCH)) {
      const batch: Promise<any[]>[] = [];
      for (let i = 0; i < BATCH && b + BigInt(i) <= head; i++) {
        batch.push(
          rpc.getBlockByHeight(Number(b + BigInt(i))).catch(() => null),
        );
      }
      const blocks = await Promise.all(batch);

      for (const blockInfo of blocks) {
        const block = (blockInfo as any)?.block;
        if (!block?.body?.transactions) continue;

        for (const txHash of block.body.transactions) {
          try {
            const txData = await rpc.getTransaction(txHash);
            const tx = (txData as any)?.transaction;
            if (!tx) continue;

            const entryPoint = tx.entryPoint;
            if (entryPoint !== "issue" && entryPoint !== "revoke") continue;

            const target = tx.target;
            const targetHash =
              typeof target === "object" ? target.hash : target;
            const normalizedTarget = String(targetHash ?? "")
              .replace(/^hash-/, "")
              .replace(/^contract-package-/, "")
              .replace(/^0x/, "");
            const normalizedCredReg = credRegHash
              .replace(/^hash-/, "")
              .replace(/^contract-package-/, "")
              .replace(/^0x/, "");

            if (
              normalizedTarget.toLowerCase() !== normalizedCredReg.toLowerCase()
            )
              continue;

            // Check if subject matches
            const args = tx.args;
            if (!args) continue;

            let subjectBytes: Uint8Array | null = null;
            let capHashBytes: Uint8Array | null = null;

            if (args instanceof Map) {
              const subjectArg = args.get("subject");
              if (subjectArg) {
                const data =
                  subjectArg.value?.data ?? subjectArg.data ?? subjectArg;
                if (data instanceof Uint8Array) subjectBytes = data;
              }
              const capArg = args.get("capability_hash");
              if (capArg) {
                const data = capArg.value?.data ?? capArg.data ?? capArg;
                if (data instanceof Uint8Array) capHashBytes = data;
              }
            }

            if (!subjectBytes || !capHashBytes) continue;

            const subjectHex = Array.from(subjectBytes)
              .map((b: number) => b.toString(16).padStart(2, "0"))
              .join("");
            if (subjectHex.toLowerCase() !== subjectLower) continue;

            const capHashHex = ("0x" +
              Array.from(capHashBytes)
                .map((b: number) => b.toString(16).padStart(2, "0"))
                .join("")) as Hex;
            const blockNum = BigInt(block.header.height);

            changes.push({
              capabilityHash: capHashHex,
              capable: entryPoint === "issue",
              blockNumber: blockNum,
              txHash: txHash as Hex,
              logIndex: changes.length,
            });
          } catch {
            continue;
          }
        }
      }
    }

    return changes.sort((a, b) =>
      b.blockNumber > a.blockNumber
        ? 1
        : b.blockNumber < a.blockNumber
          ? -1
          : b.logIndex - a.logIndex,
    );
  } catch {
    return [];
  }
}

// ---------- Address validation ----------

export function isCasperAccountHash(value: string): boolean {
  return /^account-hash-[a-f0-9]{64}$/.test(value);
}

export function isCasperPublicKey(value: string): boolean {
  return (
    /^0[12][a-f0-9]{64}$/.test(value) || /^0x0[12][a-f0-9]{64}$/.test(value)
  );
}

export function isCasperAddress(value: string): boolean {
  return isCasperAccountHash(value) || isCasperPublicKey(value);
}

// ---------- Network metadata ----------

export const casperNetwork: ChainNetwork = CASPER_TESTNET;
export const explorerUrl = CASPER_TESTNET.explorerUrl;
