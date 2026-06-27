/**
 * Casper End-to-End Demo — the full autonomous agent loop.
 *
 * This script runs the Trust Steward on Casper Testnet with rich console
 * output suitable for screen recording. It demonstrates:
 *
 *   1. Agent boots on Casper (mint_self)
 *   2. Steward reasons about required capabilities (0G Compute or local fallback)
 *   3. Self-issues credentials on Casper (CredentialRegistry.issue)
 *   4. Verifies capabilities are valid (CredentialRegistry.is_capable)
 *   5. Anchors evidence to 0G Storage + Casper (AgentId.set_token_uri)
 *
 * Usage:
 *   source .env.d/casper.env
 *   source .env.d/zerog.env
 *   export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
 *   export LIGIS_CASPER_PUBLIC_KEY=$LIGIS_CASPER_DEPLOYER_PUBKEY
 *   npx tsx scripts/casper-e2e-demo.ts [--goal "<text>"]
 */
import { CasperAdapter } from "@ligis/adapter-casper";
import { TrustSteward, LocalReasoner } from "@ligis/agent-logic";
import { ZeroGCompute, ZeroGStorage, loadZeroGConfig, loadZeroGStorageConfig } from "@ligis/zerog";
import type { Reasoner } from "@ligis/core";

const EXPLORER = "https://testnet.cspr.live";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function txLink(hash: string): string {
  return `${DIM}${EXPLORER}/transaction/${hash}${RESET}`;
}

function step(num: number, title: string): void {
  console.log(`\n${BOLD}[${num}] ${title}${RESET}`);
}

function info(label: string, value: string): void {
  console.log(`  ${CYAN}${label}:${RESET} ${value}`);
}

function success(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

async function main() {
  const goal = process.argv.find((_, i, a) => a[i - 1] === "--goal") ??
    "fetch premium RWA market data for tokenized real estate and pay for it via x402";

  console.log(`${BOLD}${CYAN}`);
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis Trust Steward — Autonomous Agent Loop on Casper       ║");
  console.log("║  Casper Agentic Buildathon 2026 — Qualification Demo        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`${RESET}`);

  info("Goal", goal);
  info("Chain", "Casper Testnet (casper-test)");
  info("Explorer", EXPLORER);

  // --- Setup adapter ---
  step(0, "Initializing Casper adapter...");
  const adapter = new CasperAdapter();
  const controller = adapter.walletAddress();
  info("Controller", controller ?? "(none)");

  if (!adapter.hasWallet()) {
    fail("No Casper wallet configured. Set LIGIS_CASPER_PRIVATE_KEY or LIGIS_CASPER_KEY_PATH.");
    process.exit(1);
  }

  // Check balance
  try {
    const bal = await adapter.getBalance();
    info("Deployer balance", bal.displayBalance);
  } catch (e: any) {
    warn(`Could not query balance: ${e.message}`);
  }

  // --- Setup reasoner (0G Compute with local fallback) ---
  step(1, "Initializing reasoner...");
  let reasoner: Reasoner;
  let reasoningMode: string;
  try {
    const zerog = new ZeroGCompute(loadZeroGConfig());
    await Promise.race([
      zerog.reason('Reply with: {"capabilities":[],"reasoning":"ok"}'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    reasoner = zerog;
    reasoningMode = "0G Compute (TEE-verified LLM)";
    success(`0G Compute available — using ${reasoningMode}`);
  } catch (e: any) {
    reasoningMode = "local keyword matcher (fallback)";
    warn(`0G Compute unavailable (${e.message}), using ${reasoningMode}`);
    reasoner = new LocalReasoner();
  }

  // --- Setup evidence store ---
  step(2, "Initializing evidence store...");
  let store;
  try {
    store = new ZeroGStorage(loadZeroGStorageConfig());
    success("0G Storage connected");
  } catch (e: any) {
    warn(`0G Storage unavailable (${e.message}), evidence will not be persisted`);
    store = { store: async () => ({ rootHash: "0x0", txHash: "0x0" }), retrieve: async () => null } as any;
  }

  // --- Run the steward loop ---
  step(3, "Running Trust Steward loop...");
  console.log(`  ${DIM}boot → reason → gate → act → re-gate → record${RESET}\n`);

  const steward = new TrustSteward(adapter, reasoner, store);
  const result = await steward.run(goal, {
    issuerKey: process.env.PRIVATE_KEY ?? process.env.LIGIS_CASPER_PRIVATE_KEY,
  });

  // --- Display results ---
  step(4, "Results");

  // Boot
  console.log(`\n  ${BOLD}BOOT:${RESET}`);
  info("AgentId", result.booted.agentId);
  info("DID", result.booted.did);
  info("Minted", result.booted.minted ? "yes (new identity)" : "no (existing)");
  if (result.booted.minted) {
    const mintTx = result.action.txHashes[0];
    if (mintTx) console.log(`  ${DIM}tx: ${EXPLORER}/transaction/${mintTx}${RESET}`);
  }

  // Reasoning
  console.log(`\n  ${BOLD}REASON:${RESET}`);
  info("Model", result.reasoning.model || "(none)");
  info("Verified", result.reasoning.verified ? "yes (TEE)" : "no");
  info("Reasoning mode", reasoningMode);
  if (result.reasoning.text) {
    const text = result.reasoning.text.length > 200
      ? result.reasoning.text.slice(0, 200) + "..."
      : result.reasoning.text;
    console.log(`  ${DIM}${text}${RESET}`);
  }

  // Capabilities
  console.log(`\n  ${BOLD}CAPABILITIES:${RESET}`);
  for (const cap of result.capabilities) {
    const status = cap.capable ? `${GREEN}capable${RESET}` : `${RED}not capable${RESET}`;
    const selfIssued = cap.selfIssued ? `${YELLOW} (self-issued)${RESET}` : "";
    console.log(`  ${BOLD}${cap.name}${RESET} ${DIM}(${cap.hash})${RESET}`);
    console.log(`    status: ${status}${selfIssued}`);
    if (cap.issueTxHash) {
      console.log(`    ${DIM}issue tx: ${EXPLORER}/transaction/${cap.issueTxHash}${RESET}`);
    }
  }

  if (result.unknownCapabilities.length > 0) {
    warn(`Unknown capabilities (not self-issued): ${result.unknownCapabilities.join(", ")}`);
  }

  // Gate
  console.log(`\n  ${BOLD}GATE:${RESET}`);
  if (result.gated) {
    success("All required capabilities are held — agent is authorized.");
  } else {
    fail("Agent is NOT authorized — missing capabilities.");
  }

  // Storage
  console.log(`\n  ${BOLD}RECORD:${RESET}`);
  if (result.storage) {
    info("0G Storage root", result.storage.rootHash);
    info("0G Storage tx", result.storage.txHash);
  } else {
    warn("Evidence not stored (0G Storage unavailable)");
  }

  if (result.anchored) {
    info("Anchored token URI", result.anchored.tokenUri);
    info("Anchor tx", result.anchored.txHash);
    console.log(`  ${DIM}${EXPLORER}/transaction/${result.anchored.txHash}${RESET}`);
  }

  // Summary
  console.log(`\n  ${BOLD}TRANSACTIONS:${RESET}`);
  for (const hash of result.action.txHashes) {
    console.log(`  ${DIM}• ${EXPLORER}/transaction/${hash}${RESET}`);
  }
  console.log(`  ${BOLD}${result.action.txHashes.length}${RESET} on-chain transactions on Casper Testnet`);

  // Error
  if (result.error) {
    console.log(`\n  ${RED}${BOLD}ERROR:${RESET} ${result.error}`);
  }

  // Final verdict
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  if (result.ok && result.gated) {
    console.log(`${BOLD}${GREEN}  ✅ SUCCESS — Agent is autonomous and authorized on Casper.${RESET}`);
  } else if (result.ok) {
    console.log(`${BOLD}${YELLOW}  ⚠ PARTIAL — Loop completed but agent is not fully gated.${RESET}`);
  } else {
    console.log(`${BOLD}${RED}  ❌ FAILED — ${result.error ?? "unknown error"}${RESET}`);
  }
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET} ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
