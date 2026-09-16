"use server";

import {
  resolveJobEscrowAddress,
  readJob,
  readGateReceipt,
  readJobCount,
  readIsEligible,
  readLastrun,
  explorerUrl,
  type LastrunSummary,
} from "@/lib/genlayer";
import type { JobView, GateReceipt } from "@ligis/core";

export type GenLayerReadResult =
  | {
      ok: true;
      address: string;
      explorer: string;
      jobCount: bigint | null;
      job: JobView | null;
      gateReceipt: GateReceipt | null;
      eligible: boolean | null;
      lastrun: LastrunSummary | null;
    }
  | { ok: false; error: string; lastrun: LastrunSummary | null };

/**
 * Read the deployed JobEscrow state for the UI. Falls back gracefully when
 * the contract isn't deployed yet (Stream 1 deploy pending) — returns the
 * lastrun summary so the page can show "deploy pending" with the last run.
 */
export async function readJobEscrowAction(
  jobId?: number,
): Promise<GenLayerReadResult> {
  const lastrun = readLastrun();
  const address = resolveJobEscrowAddress();

  if (!address) {
    return {
      ok: false,
      error:
        "JobEscrow not deployed yet. Run `pnpm demo:genlayer --mock-gate` to deploy to Studio Next (chain 61997), then refresh.",
      lastrun,
    };
  }

  try {
    const jobCount = await readJobCount(address).catch(() => null);
    const targetJobId =
      jobId !== undefined
        ? BigInt(jobId)
        : lastrun?.jobId
          ? BigInt(lastrun.jobId)
          : jobCount && jobCount > 0n
            ? jobCount
            : 1n;

    const [job, gateReceipt, eligible] = await Promise.all([
      readJob(address, targetJobId).catch(() => null),
      readGateReceipt(address, targetJobId).catch(() => null),
      readIsEligible(address, targetJobId).catch(() => null),
    ]);

    return {
      ok: true,
      address,
      explorer: explorerUrl(address),
      jobCount,
      job,
      gateReceipt,
      eligible,
      lastrun,
    };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read JobEscrow at ${address}: ${(e as Error).message}`,
      lastrun,
    };
  }
}
