/**
 * Jev Transport Smoke Test — prove the intent layer is actually answering.
 *
 * The gate is fail-open by design: when Jev is unreachable, misconfigured, or
 * missing a credential, every verdict becomes SKIPPED and the flow carries on
 * with the credential check alone. That is the right runtime behavior and a
 * terrible operational blind spot — the free AI Gateway promo ends
 * 2026-09-25, and after it does the gate will keep serving payments while
 * quietly reporting `SKIPPED`.
 *
 * This script calls `evaluatePaymentIntent` directly (no gate server, no
 * credential, no chain RPC) and exits non-zero the moment Jev stops
 * answering, so it can run in CI or a cron:
 *
 *   set -a; source .env.d/aigateway.env; set +a
 *   LIGIS_JEV_ENABLED=1 pnpm smoke:jev
 *
 * Two probes, both expected to produce a real verdict:
 *   legit        exact amount to the advertised payee   → GO
 *   misdirected  exact amount to a fresh account        → STOP
 *
 * Exit codes: 0 = both probes answered; 1 = at least one SKIPPED (with the
 * resolved route and the remedy printed); 2 = a probe answered but the
 * verdict was not what the scenario predicts.
 *
 * Output: scripts/jev-transport-smoke.lastrun.txt
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePaymentIntent,
  loadJevConfig,
  type JevIntentInput,
  type JevIntentResult,
} from "@ligis/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The gate's own Casper identity — the payee we advertise. */
const ADVERTISED_PAYEE =
  process.env.LIGIS_GATE_PAY_TO ??
  "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1";

const SUBJECT =
  process.env.LIGIS_CASPER_AGENT_ID ??
  "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37";

/** Price of the gated capability in motes (1 CSPR). */
const PRICE = process.env.LIGIS_GATE_PRICE ?? "1000000000";

function freshPayee(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `0x00${hex}`;
}

function baseInput(): JevIntentInput {
  return {
    subject: SUBJECT,
    capability: process.env.LIGIS_GATE_CAPABILITY ?? "data.premium",
    capabilityDescription:
      "One-shot access to a premium RWA data feed offered by the Ligis agent",
    gatePriceSmallestUnit: PRICE,
    tokenSymbol: "CSPR",
    tokenDecimals: "9",
    advertisedPayTo: ADVERTISED_PAYEE,
    serviceName: "ligis.gate",
    serviceDescription:
      "Pre-flight trust read for an agent payment: intent verdict + on-chain credential check",
  };
}

interface Probe {
  id: string;
  expected: "GO" | "STOP";
  input: JevIntentInput;
}

const PROBES: Probe[] = [
  {
    id: "legit",
    expected: "GO",
    input: {
      ...baseInput(),
      payment: {
        scheme: "exact",
        amountSmallestUnit: PRICE,
        payTo: ADVERTISED_PAYEE,
      },
    },
  },
  {
    id: "misdirected",
    expected: "STOP",
    input: {
      ...baseInput(),
      payment: {
        scheme: "exact",
        amountSmallestUnit: PRICE,
        payTo: freshPayee(),
      },
    },
  },
];

/** Never print a credential — just enough to tell two keys apart. */
function mask(value: string): string {
  return value.length <= 4
    ? "***"
    : `${value.slice(0, 4)}…(${value.length} chars)`;
}

function printRoute(config: ReturnType<typeof loadJevConfig>): void {
  console.log("Jev transport smoke test");
  console.log("=".repeat(40));
  console.log(
    `enabled:    ${config.enabled ? "yes" : "NO (set LIGIS_JEV_ENABLED=1)"}`,
  );
  console.log(`transport:  ${config.transport}`);
  console.log(`endpoint:   ${config.apiUrl}`);
  console.log(`model:      ${config.model}`);
  console.log(`credential: ${config.apiKey ? mask(config.apiKey) : "MISSING"}`);
  console.log("");
}

function printResult(probe: Probe, result: JevIntentResult): void {
  const cost =
    result.costUsd === undefined ? "n/a" : `$${result.costUsd.toFixed(8)}`;
  console.log(
    `  ${probe.id.padEnd(13)} → ${result.verdict.padEnd(8)} ` +
      `conf=${result.confidence.toFixed(3)} ` +
      `${String(result.latencyMs)}ms cost=${cost} ` +
      `model=${result.model ?? "?"}`,
  );
  for (const flag of result.flags) {
    console.log(
      `      flag: ${flag.id} (${flag.label}) conf=${flag.confidence.toFixed(3)}`,
    );
  }
  if (result.skippedReason) {
    console.log(`      skipped: ${result.skippedReason}`);
  }
}

function remedy(config: ReturnType<typeof loadJevConfig>): void {
  console.log("");
  console.log("Jev is not answering — the gate is running credential-only.");
  if (!config.enabled) {
    console.log("  → enable the layer: LIGIS_JEV_ENABLED=1");
  } else if (!config.apiKey) {
    console.log(
      "  → no credential for the resolved route: " +
        (config.transport === "gateway"
          ? "set AI_GATEWAY_API_KEY (dashboard) or TYPESAFE_API_KEY (direct)"
          : "set TYPESAFE_API_KEY"),
    );
  } else if (config.transport === "gateway") {
    console.log(
      "  → the AI Gateway promo ended 2026-09-25. Either attach billing/BYOK " +
        "to the gateway key, or switch to the direct route:",
    );
    console.log("      TYPESAFE_API_KEY=sk-... LIGIS_JEV_TRANSPORT=direct");
  } else {
    console.log(
      "  → check the direct key and endpoint: TYPESAFE_API_KEY / LIGIS_JEV_API_URL",
    );
  }
}

async function main(): Promise<void> {
  const config = loadJevConfig();
  printRoute(config);

  const results: Array<{
    id: string;
    expected: string;
    result: JevIntentResult;
  }> = [];

  for (const probe of PROBES) {
    const result = await evaluatePaymentIntent(probe.input, config);
    printResult(probe, result);
    results.push({ id: probe.id, expected: probe.expected, result });
  }

  const skipped = results.filter((r) => r.result.verdict === "SKIPPED");
  const wrong = results.filter(
    (r) => r.result.verdict !== "SKIPPED" && r.result.verdict !== r.expected,
  );

  // Cost is the other half of the promo story: the real AI Gateway reports
  // billed USD in provider_metadata, so a non-zero cost means the free window
  // is over. A URL override (stub, self-hosted, or direct route) reports cost
  // derived from token usage instead — that is not promo evidence.
  const billed = results
    .map((r) => r.result.costUsd ?? 0)
    .reduce((sum, c) => sum + c, 0);
  const answered = skipped.length === 0;
  const onRealGateway =
    answered &&
    config.transport === "gateway" &&
    !process.env.LIGIS_JEV_API_URL;

  const lastrun = {
    ranAt: new Date().toISOString(),
    transport: config.transport,
    endpoint: config.apiUrl,
    model: results[0]?.result.model ?? config.model,
    billedUsd: Number(billed.toFixed(8)),
    probes: results.map((r) => ({
      id: r.id,
      expected: r.expected,
      verdict: r.result.verdict,
      confidence: Number(r.result.confidence.toFixed(3)),
      latencyMs: r.result.latencyMs,
      flags: r.result.flags.map((f) => f.id),
      ...(r.result.skippedReason
        ? { skippedReason: r.result.skippedReason }
        : {}),
    })),
  };
  const out = join(__dirname, "jev-transport-smoke.lastrun.txt");
  writeFileSync(out, JSON.stringify(lastrun, null, 2));

  console.log("");
  if (onRealGateway && billed === 0) {
    console.log(
      "note: gateway reports $0.00 — promo still active (ends 2026-09-25).",
    );
  } else if (onRealGateway && billed > 0) {
    console.log(
      `note: gateway billed $${billed.toFixed(8)} — the promo is over.`,
    );
  }
  console.log(`lastrun → scripts/jev-transport-smoke.lastrun.txt`);

  if (skipped.length > 0) {
    remedy(config);
    process.exit(1);
  }
  if (wrong.length > 0) {
    console.log("");
    console.log(
      `✗ unexpected verdict(s): ${wrong
        .map((r) => `${r.id} expected ${r.expected} got ${r.result.verdict}`)
        .join(", ")}`,
    );
    process.exit(2);
  }

  console.log("");
  console.log("✓ Jev answered both probes with the expected verdicts.");
}

main().catch((err) => {
  console.error("smoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
