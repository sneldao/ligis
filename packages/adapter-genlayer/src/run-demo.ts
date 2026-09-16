/**
 * Stream 3 — run JobEscrow lifecycle on Studio Next via Python deploy.py.
 *
 * genlayer-js 1.1.x ships `studionet`, not Studio Next (chain 61997). The
 * portal requires explorer links on 61997, so the GenLayer half shells to
 * `packages/contracts-genlayer/deploy.py` (genlayer-py `studio_devnet`).
 * The Ligis half stays in TypeScript via {@link checkLigisGate}.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENLAYER_STUDIO_NEXT,
  gateReceiptToJsonString,
  type GateReceipt,
} from "@ligis/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DEFAULT_DEPLOY_PY = join(
  REPO_ROOT,
  "packages/contracts-genlayer/deploy.py",
);
const DEFAULT_LASTRUN = join(
  REPO_ROOT,
  "scripts/genlayer-agent-tank-demo.lastrun.txt",
);

export interface RunJobEscrowDemoOptions {
  /** Live Ligis GateReceipt (JSON injected into deploy.py). */
  gate: GateReceipt;
  /** Reuse an existing JobEscrow; skip deploy when set with noDeploy. */
  jobEscrowAddress?: string;
  /** Pass --no-deploy to Python. */
  noDeploy?: boolean;
  /** Pass --stop to also exercise the STOP gate path on-chain. */
  showStop?: boolean;
  /** Override path to deploy.py. */
  deployScript?: string;
  /** Override lastrun path. */
  lastrunPath?: string;
  /** Extra env for the Python child. */
  env?: Record<string, string>;
  /** Python executable (default: python3). */
  python?: string;
}

export interface JobEscrowLastrun {
  raw: string;
  path: string;
  chainId: number;
  contractAddress?: string;
  explorer?: string;
  jobId?: number;
  finalStatus?: string;
  verdictSummary?: string;
  gateProofRef?: string;
  gateChain?: string;
  runAt?: string;
}

function parseLastrun(raw: string, path: string): JobEscrowLastrun {
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const m = raw.match(re);
    return m?.[1]?.trim();
  };
  const jobIdRaw = get("job_id");
  return {
    raw,
    path,
    chainId: GENLAYER_STUDIO_NEXT.chainId,
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

/**
 * Spawn `deploy.py` with the Ligis receipt injected and wait for exit 0.
 * On success, parse and return `scripts/genlayer-agent-tank-demo.lastrun.txt`.
 */
export async function runJobEscrowDemoViaPython(
  opts: RunJobEscrowDemoOptions,
): Promise<JobEscrowLastrun> {
  const deployScript = opts.deployScript ?? DEFAULT_DEPLOY_PY;
  const lastrunPath = opts.lastrunPath ?? DEFAULT_LASTRUN;
  const python = opts.python ?? process.env.PYTHON ?? "python3";

  if (!existsSync(deployScript)) {
    throw new Error(`deploy.py not found at ${deployScript}`);
  }
  if (!opts.gate.capable) {
    throw new Error(
      "runJobEscrowDemoViaPython: gate.capable must be true " +
        "(use --stop on the orchestrator for the STOP path)",
    );
  }

  const args = [deployScript];
  if (opts.noDeploy) args.push("--no-deploy");
  if (opts.showStop) args.push("--stop");

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    LIGIS_GATE_RECEIPT_JSON: gateReceiptToJsonString(opts.gate),
  };
  if (opts.jobEscrowAddress) {
    childEnv.JOBEscrow_ADDRESS = opts.jobEscrowAddress;
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(python, args, {
      cwd: dirname(deployScript),
      env: childEnv,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`deploy.py exited with code ${code}`));
    });
  });

  if (!existsSync(lastrunPath)) {
    throw new Error(`expected lastrun file missing: ${lastrunPath}`);
  }
  const raw = readFileSync(lastrunPath, "utf8");
  return parseLastrun(raw, lastrunPath);
}

export { DEFAULT_DEPLOY_PY, DEFAULT_LASTRUN, parseLastrun };
