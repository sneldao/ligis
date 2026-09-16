/**
 * Ligis × GenLayer Agent Tank — judge repro (Stream 3 orchestrator).
 *
 * Sequence (frozen in docs/genlayer-interface-v1.md):
 *   1. checkLigisGate(seller) on Casper (or Pharos)
 *   2. create_job (payable) + GateReceipt JSON on Studio Next 61997
 *   3. submit_delivery → open_dispute → resolve (AI jury) → claim
 *   4. write scripts/genlayer-agent-tank-demo.lastrun.txt
 *
 * GenLayer half shells to packages/contracts-genlayer/deploy.py (studio_devnet).
 *
 * Usage:
 *   set -a && source .env.d/casper.env && set +a
 *   pnpm demo:genlayer
 *
 * Flags:
 *   --mock-gate     Skip live Ligis; inject a labeled mock GO receipt
 *   --stop          Also exercise on-chain STOP path after GO flow
 *   --no-deploy     Reuse JOBEscrow_ADDRESS (required in env)
 *   --dry-run       Gate only; do not call GenLayer
 *   --help
 *
 * Env:
 *   LIGIS_GENLAYER_SUBJECT   Ligis subject to gate (default: agent account-hash)
 *   LIGIS_GENLAYER_GATE_CHAIN  casper-testnet | pharos-atlantic
 *   JOBEscrow_ADDRESS / GENLAYER_PRIVATE_KEY  (passed through to deploy.py)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_STUDIO_NEXT,
  buildGateReceipt,
  type GateReceipt,
} from "@ligis/core";
import {
  GateRefusedError,
  checkLigisGate,
  refuseIfNotCapable,
  runJobEscrowDemoViaPython,
} from "@ligis/adapter-genlayer";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  return {
    help: flags.has("--help") || flags.has("-h"),
    mockGate: flags.has("--mock-gate"),
    stop: flags.has("--stop"),
    noDeploy: flags.has("--no-deploy"),
    dryRun: flags.has("--dry-run"),
  };
}

function defaultSubject(): string {
  return (
    process.env.LIGIS_GENLAYER_SUBJECT ||
    process.env.LIGIS_CASPER_AGENT_ACCOUNT_HASH ||
    process.env.LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH ||
    ""
  );
}

function printHelp(): void {
  console.log(`Ligis × GenLayer Agent Tank demo

  pnpm demo:genlayer [options]

Options:
  --mock-gate   Use a labeled mock GO receipt (no Casper RPC)
  --stop        After GO flow, also show on-chain STOP revert
  --no-deploy   Reuse JOBEscrow_ADDRESS (must be set)
  --dry-run     Run Ligis gate only; skip GenLayer
  --help        Show this help

Requires for live GenLayer:
  pip install -r packages/contracts-genlayer/requirements.txt
  (optional) GENLAYER_PRIVATE_KEY, JOBEscrow_ADDRESS

Studio Next: chain ${GENLAYER_STUDIO_NEXT.chainId} · ${GENLAYER_STUDIO_NEXT.rpcUrl}
`);
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  // Auto-load Casper env when present (same pattern as other demos).
  loadEnvFile(resolve(process.cwd(), ".env.d/casper.env"));

  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  Ligis × GenLayer — Agent Tank demo (gate → escrow → jury)  ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );
  console.log(`Studio Next chainId: ${GENLAYER_STUDIO_NEXT.chainId}`);
  console.log(`Capability:          ${GENLAYER_DEFAULT_CAPABILITY}`);

  let gate: GateReceipt;

  if (flags.mockGate) {
    const subject = defaultSubject() || "account-hash-mock-seller";
    gate = buildGateReceipt({
      subject,
      capability: GENLAYER_DEFAULT_CAPABILITY,
      capable: true,
      ligisChain: "casper-testnet",
      proofRef:
        "mock:--mock-gate — replace with live checkLigisGate for submission",
      checkedAt: Math.floor(Date.now() / 1000),
    });
    console.log("\n[1] Ligis gate: MOCK GO (flag --mock-gate)");
  } else {
    const subject = defaultSubject();
    if (!subject) {
      console.error(
        "\nMissing Ligis subject. Set LIGIS_GENLAYER_SUBJECT or source .env.d/casper.env\n" +
          "Or pass --mock-gate for a GenLayer-only dry path.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\n[1] Ligis gate: checkLigisGate(${subject}) ...`);
    try {
      gate = await refuseIfNotCapable({
        subject,
        capability: GENLAYER_DEFAULT_CAPABILITY,
      });
      console.log(`    GO  capable=${gate.capable}`);
      console.log(`    proof_ref=${gate.proofRef}`);
      console.log(`    chain=${gate.ligisChain}`);
    } catch (err) {
      if (err instanceof GateRefusedError) {
        console.log(`    STOP capable=false`);
        console.log(`    proof_ref=${err.receipt.proofRef}`);
        console.log(
          "\nSubject is not capable. Issue agent.commerce.escrow on Casper,",
        );
        console.log("or re-run with --mock-gate for GenLayer-only testing.");
        // Still useful: show checkLigisGate worked.
        const dry = await checkLigisGate({ subject });
        console.log(
          `\nDry receipt JSON:\n${JSON.stringify(
            {
              subject: dry.subject,
              capability: dry.capability,
              capable: dry.capable,
              ligis_chain: dry.ligisChain,
              proof_ref: dry.proofRef,
              checked_at: dry.checkedAt,
            },
            null,
            2,
          )}`,
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  if (flags.dryRun) {
    console.log("\n[--dry-run] Skipping GenLayer. Gate receipt ready.");
    console.log(JSON.stringify(gate, null, 2));
    return;
  }

  if (flags.noDeploy && !process.env.JOBEscrow_ADDRESS) {
    console.error("--no-deploy requires JOBEscrow_ADDRESS");
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n[2–5] GenLayer JobEscrow lifecycle (deploy.py / Studio Next) ...",
  );
  const lastrun = await runJobEscrowDemoViaPython({
    gate,
    jobEscrowAddress: process.env.JOBEscrow_ADDRESS,
    noDeploy: flags.noDeploy,
    showStop: flags.stop,
  });

  console.log("\n═══ lastrun ═══");
  console.log(lastrun.raw);
  console.log(`Wrote ${lastrun.path}`);
  if (lastrun.explorer) {
    console.log(`Explorer: ${lastrun.explorer}`);
  }
  console.log("\nSUCCESS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
