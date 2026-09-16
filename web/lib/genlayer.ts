/**
 * Stream 4 — GenLayer Studio Next client for the web UI.
 *
 * genlayer-js 1.1.x ships `studionet` but not Studio Next (chain 61997). The
 * portal requires explorer links on 61997, so we define the chain inline via
 * `createClient({ chain: ... })` and read the deployed JobEscrow IC.
 *
 * The contract address is resolved from:
 *   1. `GENLAYER_JOBEscrow_ADDRESS` env var (set after deploy)
 *   2. `scripts/genlayer-agent-tank-demo.lastrun.txt` (written by deploy.py)
 *
 * Reads use `readContract` (no signing, no value). Writes are NOT wired here —
 * the demo flow (create → deliver → dispute → resolve → claim) is owned by
 * `pnpm demo:genlayer` (Stream 3, shells to `deploy.py`). The UI is a thin
 * observer: it shows the Ligis gate receipt, the job lifecycle, and the
 * verdict, with deep links to the explorer + the /gate page.
 */
import { createClient } from "genlayer-js";
import {
  jobViewFromContract,
  gateReceiptFromJson,
  type JobView,
  type GateReceipt,
  GENLAYER_STUDIO_NEXT,
} from "@ligis/core";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Studio Next chain definition for genlayer-js (chain 61997). */
export const STUDIO_NEXT_CHAIN = {
  id: GENLAYER_STUDIO_NEXT.chainId,
  name: "GenLayer Studio Devnet",
  rpcUrls: {
    default: {
      http: [GENLAYER_STUDIO_NEXT.rpcUrl],
    },
  },
  nativeCurrency: {
    name: "GEN Token",
    symbol: "GEN",
    decimals: 18,
  },
  blockExplorers: {
    default: {
      name: "GenLayer Explorer",
      url: "https://explorer-studio-dev.genlayer.com",
    },
  },
} as const;

let _client: ReturnType<typeof createClient> | null = null;

/** Singleton read-only client for Studio Next. */
export function getGenLayerClient(): ReturnType<typeof createClient> {
  if (!_client) {
    _client = createClient({
      chain: STUDIO_NEXT_CHAIN as any,
    });
  }
  return _client;
}

/** Path to the lastrun file written by deploy.py / Stream 3. */
export const LASTRUN_PATH = resolve(
  process.cwd(),
  "..",
  "scripts",
  "genlayer-agent-tank-demo.lastrun.txt",
);

/** Parsed lastrun.txt (written by deploy.py). */
export interface LastrunSummary {
  raw: string;
  contractAddress?: string;
  explorer?: string;
  jobId?: number;
  finalStatus?: string;
  verdictSummary?: string;
  gateProofRef?: string;
  gateChain?: string;
  runAt?: string;
}

/** Read and parse lastrun.txt if it exists. */
export function readLastrun(): LastrunSummary | null {
  if (!existsSync(LASTRUN_PATH)) return null;
  const raw = readFileSync(LASTRUN_PATH, "utf8");
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const m = raw.match(re);
    return m?.[1]?.trim();
  };
  const jobIdRaw = get("job_id");
  return {
    raw,
    contractAddress: get("contract_address"),
    explorer: get("explorer"),
    jobId: jobIdRaw ? Number(jobIdRaw) : undefined,
    finalStatus: get("final_status"),
    verdictSummary: get("verdict_summary"),
    gateProofRef: get("gate_proof_ref"),
    gateChain: get("gate_chain"),
    runAt: get("run_at"),
  };
}

/** Resolve the deployed JobEscrow address from env or lastrun.txt. */
export function resolveJobEscrowAddress(): string | null {
  const env = process.env.GENLAYER_JOBEscrow_ADDRESS;
  if (env && env.trim()) return env.trim();
  const lastrun = readLastrun();
  return lastrun?.contractAddress ?? null;
}

/** Read a job from the deployed IC. Returns null if the contract isn't deployed. */
export async function readJob(
  jobEscrowAddress: string,
  jobId: bigint,
): Promise<JobView | null> {
  const client = getGenLayerClient();
  const raw = await client.readContract({
    address: jobEscrowAddress as any,
    functionName: "get_job",
    args: [jobId],
  });
  if (typeof raw !== "string") return null;
  return jobViewFromContract(raw);
}

/** Read the on-chain Ligis gate receipt for a job. */
export async function readGateReceipt(
  jobEscrowAddress: string,
  jobId: bigint,
): Promise<GateReceipt | null> {
  const client = getGenLayerClient();
  const raw = await client.readContract({
    address: jobEscrowAddress as any,
    functionName: "get_gate_receipt",
    args: [jobId],
  });
  if (typeof raw !== "string") return null;
  return gateReceiptFromJson(JSON.parse(raw) as Record<string, unknown>);
}

/** Read the job count from the deployed IC. */
export async function readJobCount(
  jobEscrowAddress: string,
): Promise<bigint | null> {
  const client = getGenLayerClient();
  const raw = await client.readContract({
    address: jobEscrowAddress as any,
    functionName: "job_count",
  });
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") return BigInt(raw);
  return null;
}

/** Check if a job's gate receipt says the seller was eligible. */
export async function readIsEligible(
  jobEscrowAddress: string,
  jobId: bigint,
): Promise<boolean | null> {
  const client = getGenLayerClient();
  const raw = await client.readContract({
    address: jobEscrowAddress as any,
    functionName: "is_eligible",
    args: [jobId],
  });
  if (typeof raw === "boolean") return raw;
  return null;
}

/** Build the explorer URL for a contract address on Studio Next. */
export function explorerUrl(address: string): string {
  return GENLAYER_STUDIO_NEXT.explorerAddressUrl(address);
}
