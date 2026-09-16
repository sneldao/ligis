/**
 * Stream 3 — JobEscrow client.
 *
 * Studio Next (chain 61997) is driven by genlayer-py today. Per-method
 * genlayer-js wiring waits on a studio_devnet chain preset; until then:
 *
 * - Full lifecycle: {@link runJobEscrowDemoViaPython} (used by pnpm demo:genlayer)
 * - {@link createJobEscrowClient} validates config and throws with the
 *   judge-repro path so Stream 4 does not silently call a stub.
 */
import type { CreateJobArgs, GateReceipt, JobView } from "@ligis/core";
import { GENLAYER_STUDIO_NEXT } from "@ligis/core";

export interface GenLayerAdapterConfig {
  jobEscrowAddress: string;
  rpcUrl?: string;
  account?: unknown;
}

export interface JobEscrowClient {
  readonly address: string;
  /** Payable create_job — locks stake (valueWei). Returns job id. */
  createJob(args: CreateJobArgs): Promise<number>;
  submitDelivery(jobId: number, evidenceUri: string): Promise<string>;
  openDispute(jobId: number, reason: string): Promise<string>;
  resolve(jobId: number): Promise<string>;
  claim(jobId: number): Promise<string>;
  cancelJob(jobId: number): Promise<string>;
  getJob(jobId: number): Promise<JobView>;
  getGateReceipt(jobId: number): Promise<GateReceipt>;
  isEligible(jobId: number): Promise<boolean>;
  jobCount(): Promise<number>;
}

/**
 * Validates the Studio Next address, then points callers at the working
 * Python lifecycle until genlayer-js supports chain 61997 natively.
 */
export function createJobEscrowClient(
  config: GenLayerAdapterConfig,
): JobEscrowClient {
  const address = String(config.jobEscrowAddress ?? "").trim();
  if (!address) {
    throw new Error(
      "createJobEscrowClient: jobEscrowAddress is required " +
        "(set JOBEscrow_ADDRESS or pass it explicitly).",
    );
  }
  const rpc = config.rpcUrl ?? GENLAYER_STUDIO_NEXT.rpcUrl;
  const hint =
    `JobEscrow at ${address} (rpc=${rpc}). ` +
    `Per-method genlayer-js client for Studio Next (chain ${GENLAYER_STUDIO_NEXT.chainId}) ` +
    `is not wired yet — run the frozen lifecycle via:\n` +
    `  pnpm demo:genlayer\n` +
    `or:\n` +
    `  runJobEscrowDemoViaPython({ gate, jobEscrowAddress: "${address}", noDeploy: true })`;

  const notImplemented = (method: string) => async () => {
    throw new Error(`JobEscrowClient.${method}: ${hint}`);
  };

  return {
    address,
    createJob: notImplemented("createJob") as JobEscrowClient["createJob"],
    submitDelivery: notImplemented(
      "submitDelivery",
    ) as JobEscrowClient["submitDelivery"],
    openDispute: notImplemented(
      "openDispute",
    ) as JobEscrowClient["openDispute"],
    resolve: notImplemented("resolve") as JobEscrowClient["resolve"],
    claim: notImplemented("claim") as JobEscrowClient["claim"],
    cancelJob: notImplemented("cancelJob") as JobEscrowClient["cancelJob"],
    getJob: notImplemented("getJob") as JobEscrowClient["getJob"],
    getGateReceipt: notImplemented(
      "getGateReceipt",
    ) as JobEscrowClient["getGateReceipt"],
    isEligible: notImplemented("isEligible") as JobEscrowClient["isEligible"],
    jobCount: notImplemented("jobCount") as JobEscrowClient["jobCount"],
  };
}
