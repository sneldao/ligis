#!/usr/bin/env node
/**
 * Prod watchdog for the gate's Jev intent layer.
 *
 * The layer is fail-open: a missing key, a dead route or a timeout makes every
 * verdict SKIPPED and the gate keeps answering exactly as it did before. An
 * outage is therefore invisible unless something looks for it. This asserts one
 * thing — that production's own provenance line says the model answered — and
 * nothing else. It deliberately does not fail on the gate verdict itself:
 * expiring fixtures are `pnpm smoke:demo-credentials`'s problem, not this one.
 *
 *   node scripts/jev-prod-watchdog.mjs
 *   node scripts/jev-prod-watchdog.mjs --self-test
 *   LIGIS_GATE_URL=https://staging/app/api/gate node scripts/jev-prod-watchdog.mjs
 *
 * Costs ~$0.00005 of the server's key per live run.
 */

const GATE_URL = process.env.LIGIS_GATE_URL ?? "https://ligis.vercel.app/api/gate";
const TIMEOUT_MS = Number(process.env.WATCHDOG_TIMEOUT_MS ?? 15_000);
const PAYEE = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

// web/lib/decide.ts emits `jev <verdict>[ <model>] (<transport>, <n>ms[, <reason>])`.
// A reason is only ever appended when the layer abstained.
export function parseJevProvenance(provenance) {
  const line = (Array.isArray(provenance) ? provenance : [])
    .map(String)
    .find((entry) => entry.toLowerCase().startsWith("jev "));
  if (!line) {
    return { ok: false, reason: "missing", line: undefined };
  }

  const verdict = line.slice("jev ".length).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const group = line.match(/\(([^()]*)\)\s*$/)?.[1] ?? "";
  const parts = group.split(",").map((part) => part.trim()).filter(Boolean);
  const transport = parts[0] ?? "";
  const latency = parts[1] ?? "";
  const skippedReason = parts.slice(2).join(", ");

  const abnormal = verdict !== "go" && verdict !== "stop" && verdict !== "unknown";
  // The model id is the token right after the verdict when present ("jev-1.13.0").
  const model =
    line.slice("jev ".length).trim().split(/\s+/)[1]?.match(/^jev-[\w.\-]+$/)?.[0] ??
    undefined;
  return { ok: !abnormal && verdict !== "skipped" && !skippedReason, line, verdict, model, transport, latency, skippedReason, abnormal };
}

async function probe() {
  let response;
  try {
    response = await fetch(GATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payee: PAYEE,
        amountUsd: 5,
        purpose: "Watchdog probe: renew the market-data subscription the operator contracted",
        capability: "agent.commerce.escrow",
        mandate: { payees: [PAYEE], maxUsd: 500, expectedUsd: 5 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    die(`gate did not answer (${err?.name}: ${err?.message})`, "is the deployment live?");
  }

  if (!response.ok) {
    die(`HTTP ${response.status} from the gate`, "is the deployment live?");
  }

  const decision = await response.json().catch(() => null);
  if (!decision || !Array.isArray(decision.provenance)) {
    die("gate response carries no provenance array", "did /api/gate change shape?");
  }

  const parsed = parseJevProvenance(decision.provenance);
  if (parsed.reason === "missing") {
    die(
      "no jev line in provenance — the intent layer is not running at all",
      "LIGIS_JEV_ENABLED=1 plus TYPESAFE_API_KEY (or AI_GATEWAY_API_KEY) on the Vercel deployment",
    );
  }
  if (!parsed.ok) {
    die(
      `the layer is present but abstained: ${parsed.line}`,
      "route dead or key unusable — check LIGIS_JEV_TRANSPORT, then run: LIGIS_JEV_ENABLED=1 pnpm smoke:jev",
    );
  }

  console.log(
    `ok  gate ${decision.verdict} · ${parsed.line} · ` +
      `model ${parsed.model ?? "unversioned"} · ` +
      `cost $${Number(decision.costUsd ?? 0).toFixed(8)} · decision ${decision.latencyMs}ms`,
  );
}

/**
 * Optional failure alert. When LIGIS_WATCHDOG_WEBHOOK_URL is set (Slack/Discord
 * style webhook), a failing run posts there as well as exiting non-zero — a
 * scheduled workflow nobody watches is just a log line. Set
 * LIGIS_WATCHDOG_WEBHOOK_TEXT=1 for webhooks that want { text } instead of
 * { content }.
 */
async function alert(message, fix) {
  const url = process.env.LIGIS_WATCHDOG_WEBHOOK_URL;
  if (!url) return;
  const text = `JEV WATCHDOG: ${message}\nurl ${GATE_URL}${fix ? `\ncheck ${fix}` : ""}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        process.env.LIGIS_WATCHDOG_WEBHOOK_TEXT === "1" ? { text } : { content: text },
      ),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error(`watchdog alert delivery failed (${err?.name}: ${err?.message})`);
  }
}

function die(message, fix) {
  console.error(`\nJEV WATCHDOG: ${message}`);
  console.error(`  url    ${GATE_URL}`);
  if (fix) console.error(`  check  ${fix}`);
  // Fire-and-forget: exit must not depend on the alert path being reachable.
  alert(message, fix).finally(() => process.exit(1));
}

async function selfTest() {
  const cases = [
    ["jev go jev-1.13.0 (direct, 127ms)", true],
    ["jev stop jev-1.13.0 (direct, 58ms)", true],
    ["jev go (gateway, 401ms)", true],
    ["jev skipped (direct, 0ms, layer disabled)", false],
    ["jev skipped  (gateway, 4001ms, timeout after 4000ms)", false],
    ["jev go jev-1.13.0 (direct, 127ms, http 401)", false],
    [null, false],
  ];
  let failed = 0;
  for (const [line, expected] of cases) {
    const parsed = parseJevProvenance(["policy: ok", ...(line ? [line] : [])]);
    const pass = parsed.ok === expected;
    if (!pass) failed++;
    const detail =
      parsed.reason === "missing"
        ? "no jev line"
        : `verdict=${parsed.verdict} model=${parsed.model ?? "-"} transport=${parsed.transport} latency=${parsed.latency} reason=${parsed.skippedReason || "-"}`;
    console.log(`${pass ? "ok  " : "FAIL"} expected=${expected} got=${parsed.ok} [${detail}] ${line ?? "(absent)"}`);
  }
  if (failed) {
    console.error(`${failed} parser case(s) failed`);
    process.exit(1);
  }
  console.log("parser self-test passed");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  await probe();
}
