import "server-only";
import type { Address } from "viem";
import {
  isCasperChain,
  readOwnerOf,
  readTotalSupply,
} from "@/lib/chain-router";
import { readAgentId as casperReadAgentId } from "@/lib/chain-casper";
import { evmNetworkKey, type ChainNetwork } from "@/lib/network";

export type ListedAgent = {
  address: string;
  tokenId: string;
};

const DEFAULT_MAX = 200;
const EVM_BATCH = 24;

/**
 * Enumerate minted AgentId controllers for the field.
 * EVM: ownerOf(1..totalSupply). Casper: deployer + optional LIGIS_FIELD_AGENTS.
 */
export async function listAgents(
  chain: ChainNetwork,
  opts?: { max?: number },
): Promise<ListedAgent[]> {
  const max = opts?.max ?? DEFAULT_MAX;
  if (isCasperChain(chain)) {
    return listCasperAgents(max);
  }
  return listEvmAgents(chain, max);
}

async function listEvmAgents(
  chain: ChainNetwork,
  max: number,
): Promise<ListedAgent[]> {
  const networkId = evmNetworkKey(chain);
  let supply: bigint;
  try {
    supply = await readTotalSupply(chain);
  } catch {
    return [];
  }
  if (supply <= 0n) return [];

  const n = Number(supply > BigInt(max) ? BigInt(max) : supply);
  const out: ListedAgent[] = [];
  const seen = new Set<string>();

  for (let start = 1; start <= n; start += EVM_BATCH) {
    const end = Math.min(start + EVM_BATCH - 1, n);
    const ids = Array.from({ length: end - start + 1 }, (_, i) =>
      BigInt(start + i),
    );
    const results = await Promise.all(
      ids.map(async (tokenId) => {
        try {
          const owner = await readOwnerOf(tokenId, networkId);
          return { tokenId, owner };
        } catch {
          return null;
        }
      }),
    );
    for (const row of results) {
      if (!row) continue;
      const addr = (row.owner as Address).toLowerCase();
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push({
        address: row.owner,
        tokenId: row.tokenId.toString(),
      });
    }
  }

  return out;
}

/**
 * Casper AgentId has no totalSupply. Probe known controllers:
 * deployer env + comma-separated LIGIS_FIELD_AGENTS.
 */
async function listCasperAgents(max: number): Promise<ListedAgent[]> {
  const candidates: string[] = [];
  const deployer =
    process.env.LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH ??
    process.env.LIGIS_CASPER_ACCOUNT_HASH ??
    "";
  if (deployer) candidates.push(deployer.trim());
  const extra = process.env.LIGIS_FIELD_AGENTS ?? "";
  for (const part of extra.split(",")) {
    const t = part.trim();
    if (t) candidates.push(t);
  }

  const out: ListedAgent[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (out.length >= max) break;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const id = await casperReadAgentId(raw);
      if (id > 0n) {
        out.push({ address: raw, tokenId: id.toString() });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}
