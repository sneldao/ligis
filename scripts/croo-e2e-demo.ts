/**
 * CROO End-to-End Demo — hire Ligis on the CROO Agent Store.
 *
 * Demonstrates the full CAP lifecycle for CROO Agent Hackathon judges:
 *
 *   negotiate → accept → pay USDC → deliver JSON verdict → on-chain proof
 *
 * Ligis reads CredentialRegistry on Casper (default) or Pharos when fulfilling
 * ligis.verify / ligis.risk orders. The Casper on-chain layer is shared with
 * the Casper Agentic Buildathon demo — same contracts, same capability hashes.
 *
 * Prerequisites:
 *   1. Ligis listed on https://agent.croo.network with ligis.verify / ligis.risk
 *   2. Ligis provider running: `pnpm croo` (separate terminal)
 *   3. Requester agent wallet funded with USDC on Base (see CROO Dashboard)
 *   4. `.env.d/croo.env` with CROO_SDK_KEY (requester) + Casper read config
 *
 * Usage:
 *   source .env.d/casper.env
 *   source .env.d/croo.env
 *   npx tsx scripts/croo-e2e-demo.ts
 *   npx tsx scripts/croo-e2e-demo.ts --service ligis.risk --capability agent.commerce.escrow
 *   npx tsx scripts/croo-e2e-demo.ts --on-chain-only   # skip CROO; direct registry read
 */
import { CasperAdapter } from "@ligis/adapter-casper";
import {
  LigisCrooRequester,
  createCrooClient,
  loadCrooConfig,
} from "../packages/croo-adapter/src/index.js";

const EXPLORER = "https://testnet.cspr.live";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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

function fail(msg: string): never {
  console.log(`  ${RED}✗${RESET} ${msg}`);
  process.exit(1);
}

async function resolveSubject(adapter: CasperAdapter): Promise<string> {
  const explicit = arg("--subject");
  if (explicit) return explicit;

  const envSubject =
    process.env.CROO_DEMO_SUBJECT ??
    process.env.LIGIS_CASPER_PUBLIC_KEY ??
    process.env.LIGIS_CASPER_DEPLOYER_PUBKEY;

  if (envSubject) {
    if (envSubject.startsWith("account-hash-")) return envSubject;
    if (envSubject.startsWith("did:")) return envSubject;
    return `account-hash-${envSubject.replace(/^0x/i, "")}`;
  }

  const wallet = adapter.walletAddress();
  if (wallet) {
    try {
      const existing = await adapter.getAgentId(wallet);
      if (existing) return existing;
    } catch {
      // Registry not configured — require explicit --subject
    }
  }

  fail(
    "No subject found. Pass --subject <account-hash-...|did:...> or set LIGIS_CASPER_PUBLIC_KEY.",
  );
}

async function onChainOnlyDemo(): Promise<void> {
  step(1, "Direct on-chain verification (Casper CredentialRegistry)...");
  const adapter = new CasperAdapter();
  const subject = await resolveSubject(adapter);
  const capability =
    arg("--capability") ?? arg("--capabilities") ?? "agent.commerce.escrow";

  info("Subject", subject);
  info("Capability", capability);
  info("Chain", "Casper Testnet");
  info("Registry", process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? "(from env)");

  const result = await adapter.verifyCapability({ subject, capability });
  success(`capable = ${result.capable}`);
  info("Capability hash", result.capabilityHash);
  if (result.latest) {
    info("Latest credential", JSON.stringify(result.latest, null, 2));
  }

  console.log(`\n${DIM}On-chain read only — no CROO payment in this mode.${RESET}`);
  console.log(
    `${DIM}For full CAP flow, run \`pnpm croo\` in another terminal and re-run without --on-chain-only.${RESET}`,
  );
}

async function capDemo(): Promise<void> {
  const serviceId = arg("--service", "ligis.verify")!;
  const capability =
    arg("--capability") ?? arg("--capabilities") ?? "agent.commerce.escrow";

  step(0, "Loading CROO + Casper configuration...");
  const config = loadCrooConfig();
  const adapter = new CasperAdapter();
  const subject = await resolveSubject(adapter);

  info("CROO API", config.apiURL);
  info("Service", serviceId);
  info("Subject", subject);
  info("Ligis chain", config.ligisChain);
  info("Casper explorer", EXPLORER);

  const client = createCrooClient(
    { baseURL: config.apiURL, wsURL: config.wsURL },
    config.sdkKey,
  );

  step(1, "Hiring Ligis on CROO (CAP requester)...");
  console.log(
    `  ${DIM}Lifecycle: negotiateOrder → OrderCreated → payOrder → OrderCompleted → getDelivery${RESET}`,
  );
  warn("Ensure `pnpm croo` is running so Ligis accepts and fulfills the order.");

  const requester = new LigisCrooRequester({ client, serviceId });

  const requirements =
    serviceId === "ligis.risk"
      ? {
          subject,
          capabilities: capability.includes(",")
            ? capability.split(",").map((s) => s.trim())
            : capability,
          minTtlSeconds: Number(arg("--min-ttl", "86400")),
        }
      : {
          subject,
          capability,
        };

  info("Requirements", JSON.stringify(requirements));

  const started = Date.now();
  const deliveryText = await requester.startAndWait(requirements);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  step(2, "Delivery received");
  success(`Order completed in ${elapsed}s`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(deliveryText);
  } catch {
    console.log(deliveryText);
    fail("Delivery was not valid JSON");
  }

  console.log("\n" + JSON.stringify(parsed, null, 2));

  step(3, "On-chain proof (Casper read that backed the delivery)");
  if (parsed.error) {
    warn(`Service returned error: ${String(parsed.message ?? "unknown")}`);
  } else if (serviceId === "ligis.risk") {
    success(`overallVerdict = ${String(parsed.overallVerdict)}`);
    info("riskScore", String(parsed.riskScore ?? "n/a"));
    info("summary", String(parsed.summary ?? ""));
  } else {
    success(`capable = ${String(parsed.capable)}`);
    info("capabilityHash", String(parsed.capabilityHash ?? ""));
  }

  info(
    "CredentialRegistry",
    process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? "(see .env.d/casper.env)",
  );
  console.log(
    `\n${DIM}View Casper contracts: ${EXPLORER}/contract-package/${(process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? "").replace(/^hash-/, "")}${RESET}`,
  );
}

async function main() {
  console.log(`${BOLD}${CYAN}`);
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis on CROO — CAP Commerce + Casper On-Chain Verification ║");
  console.log("║  CROO Agent Hackathon 2026 — Judge Repro                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`${RESET}`);

  if (hasFlag("--on-chain-only")) {
    await onChainOnlyDemo();
    return;
  }

  if (!process.env.CROO_SDK_KEY) {
    warn("CROO_SDK_KEY not set — falling back to on-chain-only demo.");
    warn("Copy .env.d/croo.env.example → .env.d/croo.env and add your SDK key.");
    await onChainOnlyDemo();
    return;
  }

  await capDemo();
}

main().catch((err) => {
  console.error(`\n${RED}Fatal:${RESET}`, err);
  process.exit(1);
});
