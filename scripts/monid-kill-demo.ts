/**
 * Monid "We Kill" demo — the payments-risk dashboard, killed.
 *
 * A richer terminal version of `ligis trust check` with the same colored
 * output style as scripts/casper-e2e-demo.ts. It shows the whole kill in one
 * run: what died (Persona Essential's $250/mo identity dashboard), what
 * Monid discovered, the Ligis trust decision (boot → reason → risk → gate →
 * act → record), and the receipt with the per-check cost comparison.
 *
 * Usage:
 *   set -a && source .env.d/casper.env && source .env.d/zerog.env \
 *     && source .env.d/monid.env && set +a
 *   export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
 *   npx tsx scripts/monid-kill-demo.ts [--chain casper] \
 *     [--counterparty 0x...] [--intent "..."] [--amount "10 USD"]
 *
 * On the default evm chain the Pharos env (PRIVATE_KEY, LIGIS_NETWORK) is
 * expected instead of the Casper env.
 */
import {
  buildTrustReceipt,
  PERSONA_ESSENTIAL_PRICING,
  type ChainAdapter,
  type Reasoner,
} from "@ligis/core";
import { EvmAdapter } from "@ligis/adapter-evm";
import { CasperAdapter } from "@ligis/adapter-casper";
import { ZeroGAdapter } from "@ligis/adapter-0g";
import {
  TrustSteward,
  LocalReasoner,
  MonidClient,
  MonidRiskProvider,
  loadMonidConfig,
} from "@ligis/agent-logic";
import {
  ZeroGCompute,
  ZeroGStorage,
  loadZeroGConfig,
  loadZeroGStorageConfig,
} from "@ligis/zerog";
import { renderTrustReceipt } from "../packages/cli/src/receipt.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  return argv[i]!.startsWith("--") && argv[i]!.includes("=")
    ? argv[i]!.split("=").slice(1).join("=")
    : argv[i + 1];
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

function getAdapter(): ChainAdapter {
  const chain = (arg("chain") ?? "evm").toLowerCase();
  switch (chain) {
    case "evm":
    case "pharos":
      return new EvmAdapter();
    case "casper":
      return new CasperAdapter();
    case "0g":
    case "zerog":
      return new ZeroGAdapter();
    default:
      throw new Error(`Unknown --chain: ${chain}. Supported: evm, casper, 0g.`);
  }
}

async function main() {
  const counterparty =
    arg("counterparty") ??
    process.env.MONID_COUNTERPARTY ??
    "0x0000000000000000000000000000000000000000";
  const intent = arg("intent") ?? "pay for premium RWA data";
  const amount = arg("amount") ?? "10 USD";

  console.log(`${BOLD}${CYAN}`);
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis × Monid — We Kill the payments-risk dashboard         ║");
  console.log("║  Monid \u201cWe Kill\u201d Hackathon 2026                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`${RESET}`);

  info("Counterparty", counterparty);
  info("Intent", intent);
  info("Amount", amount);

  // --- 1. What died ---
  step(1, "What died: the pre-payment risk dashboard...");
  info(
    "Incumbent",
    `${PERSONA_ESSENTIAL_PRICING.name} — $${PERSONA_ESSENTIAL_PRICING.monthlyUsd}/mo minimum ` +
      `+ $${PERSONA_ESSENTIAL_PRICING.perCheckUsd}/verification`,
  );
  info("Killed workflow", "human logs into a dashboard, runs a check, tells payments to release");
  info("Replacement", "the agent asks Monid what is available, pays per call, gates itself");

  // --- 2. Monid discovery ---
  step(2, "Monid discover — what risk endpoints exist?");
  const monidConfig = loadMonidConfig();
  if (!monidConfig) {
    fail("MONID_API_KEY not set — source .env.d/monid.env first.");
    process.exit(1);
  }
  const monid = new MonidClient(monidConfig);
  const query = `crypto counterparty risk for ${counterparty}`;
  info("Query", query);
  try {
    const discovered = await monid.discover(query);
    for (const ep of discovered.results) {
      const price = ep.price
        ? `$${ep.price.amount} ${ep.price.currency} per call`
        : "price on dashboard";
      console.log(
        `  ${BOLD}${ep.provider}/${ep.endpoint}${RESET} ${DIM}— ${ep.description}${RESET}`,
      );
      console.log(`    ${DIM}${price}${RESET}`);
    }
    success(`${discovered.count} live endpoint(s) discovered — no API docs, no scrapers`);
  } catch (e: any) {
    warn(`discover failed (${e.message}) — continuing with the trust flow`);
  }

  // --- 3. Trust check: boot → reason → risk → gate → act → record ---
  step(3, "Ligis trust check — boot → reason → risk → gate → act → record");
  const adapter = getAdapter();
  info("Chain", `${adapter.chainName} (${adapter.chainId})`);
  const controller = adapter.walletAddress();
  info("Controller", controller ?? "(none)");
  if (!controller) {
    fail("Adapter has no wallet — set the chain env (PRIVATE_KEY or LIGIS_CASPER_*).");
    process.exit(1);
  }

  let reasoner: Reasoner;
  try {
    const zerog = new ZeroGCompute(loadZeroGConfig());
    await Promise.race([
      zerog.reason('Reply with: {"capabilities":[],"reasoning":"ok"}'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    reasoner = zerog;
    success("0G Compute available — TEE-verified reasoning");
  } catch (e: any) {
    warn(`0G Compute unavailable (${e.message}), using local keyword matcher`);
    reasoner = new LocalReasoner();
  }

  const store = new ZeroGStorage(loadZeroGStorageConfig());
  const provider = new MonidRiskProvider(monid);
  const steward = new TrustSteward(adapter, reasoner, store, [provider]);
  console.log(`  ${DIM}running the loop against ${counterparty}${RESET}`);
  const result = await steward.run(intent, {
    counterparty,
    amount,
    capability: arg("capability"),
    issuerKey: process.env.PRIVATE_KEY ?? process.env.LIGIS_CASPER_PRIVATE_KEY,
  });

  for (const cap of result.capabilities) {
    const status = cap.capable
      ? `${GREEN}capable${RESET}`
      : cap.selfIssued
        ? `${YELLOW}self-issued${RESET}`
        : `${RED}missing${RESET}`;
    console.log(`  ${BOLD}${cap.name}${RESET} — ${status}`);
  }

  // --- 4. Receipt ---
  step(4, "Receipt — the decision, measured");
  const receipt = buildTrustReceipt(result.decision, {
    storage: result.storage,
    anchoredTokenUri: result.anchored?.tokenUri ?? null,
  });
  console.log(renderTrustReceipt(receipt));

  // --- Verdict banner ---
  const go = receipt.verdict === "go";
  const perCheck = receipt.cost.provider.perCheckUsd;
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  if (go) {
    console.log(`${BOLD}${GREEN}  ✓ GO — the agent may pay ${counterparty.slice(0, 10)}··${RESET}`);
  } else {
    console.log(`${BOLD}${RED}  ✗ STOP — the agent must not pay this counterparty${RESET}`);
  }
  console.log(
    `${BOLD}  Persona wanted $${PERSONA_ESSENTIAL_PRICING.perCheckUsd}/verification ` +
      `(+ $${PERSONA_ESSENTIAL_PRICING.monthlyUsd}/mo).${RESET}`,
  );
  if (perCheck !== undefined) {
    console.log(`${BOLD}  This check cost $${perCheck}, measured by Monid.${RESET}`);
  } else {
    console.log(`${BOLD}  Monid cost: measured on dashboard.${RESET}`);
  }
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  process.exitCode = go ? 0 : 1;
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET} ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
