import "server-only";
import type { Address } from "viem";
import {
  isCasperChain,
  readAgentId,
  readOwnerOf,
  readTotalSupply,
} from "@/lib/chain-router";
import { DEMO_GATE_SAMPLES } from "@/lib/demo-subjects";
import { evmNetworkKey, type ChainNetwork } from "@/lib/network";

export type ListedAgent = {
  address: string;
  tokenId: string;
};

const DEFAULT_MAX = 200;
const EVM_BATCH = 24;

/**
 * Enumerate minted AgentId controllers for the field.
 * EVM: ownerOf(1..totalSupply). Casper: deployer + LIGIS_FIELD_AGENTS.
 * Always merges DEMO_GATE_SAMPLES subjects that actually hold an AgentId
 * (so Casper default field has at least the verified demo hash).
 */
export async function listAgents(
  chain: ChainNetwork,
  opts?: { max?: number },
): Promise<ListedAgent[]> {
  const max = opts?.max ?? DEFAULT_MAX;
  const primary = isCasperChain(chain)
    ? await listCasperCandidates(chain, max)
    : await listEvmAgents(chain, max);

  return mergeDemoSubjects(chain, primary, max);
}

async function mergeDemoSubjects(
  chain: ChainNetwork,
  primary: ListedAgent[],
  max: number,
): Promise<ListedAgent[]> {
  const out = [...primary];
  const seen = new Set(primary.map((a) => a.address.toLowerCase()));
  const samples = DEMO_GATE_SAMPLES[chain.id] ?? [];

  for (const sample of samples) {
    if (out.length >= max) break;
    if (sample.expect === "none") continue;
    const key = sample.subject.toLowerCase();
    if (seen.has(key)) continue;
    try {
      const id = await readAgentId(chain, sample.subject);
      if (id > 0n) {
        seen.add(key);
        out.push({ address: sample.subject, tokenId: id.toString() });
      }
    } catch {
      /* skip */
    }
  }
  return out;
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
 * Casper AgentId has no totalSupply. Probe known controllers;
 * DEMO_GATE_SAMPLES are merged afterward.
 */
async function listCasperCandidates(
  chain: ChainNetwork,
  max: number,
): Promise<ListedAgent[]> {
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
      const id = await readAgentId(chain, raw);
      if (id > 0n) {
        out.push({ address: raw, tokenId: id.toString() });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}
