/**
 * Jev Stress Demo — the gate's reflexes, under load.
 *
 * Fires concurrent payment scenarios at the running Trust Gate and shows the
 * Jev intent layer judging every request in ~100ms for fractions of a cent:
 *
 *   legit        exact price to the gate's advertised payee
 *   underpay     1 mote for a premium feed
 *   overpay      500x the gate price
 *   misdirected  exact price to a fresh, unadvertised account
 *
 * Requirements:
 *   - Gate running with the intent layer on (AI Gateway is the default route
 *     and free through 2026-09-25):
 *       LIGIS_JEV_ENABLED=1 AI_GATEWAY_API_KEY=... pnpm x402:dev
 *     or direct: LIGIS_JEV_ENABLED=1 TYPESAFE_API_KEY=sk-... pnpm x402:dev
 *   - No credential is needed: 401s are expected for subjects without one —
 *     the Jev verdict lands on the 401 regardless, which is the point.
 *
 * Output: per-request verdict table + totals, and a lastrun file at
 * scripts/jev-stress-demo.lastrun.txt.
 */

const GATE_URL = process.env.LIGIS_GATE_URL ?? "http://localhost:4040";
const SUBJECT =
  process.env.LIGIS_CASPER_AGENT_ID ??
  "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1";
const ROUNDS = Number(process.env.JEV_STRESS_ROUNDS ?? "4");
const CONCURRENCY = Number(process.env.JEV_STRESS_CONCURRENCY ?? "4");
const REQUEST_TIMEOUT_MS = 30_000;

interface Scenario {
  id: string;
  amount: string;
  payTo: string | (() => string);
}

function freshPayTo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `0x00${hex}`;
}

/** Minimal x402 payment payload. The intent layer reads it; settlement verifies it. */
function paymentHeader(amount: string, payTo: string): string {
  const payload = {
    x402Version: 2,
    accepted: { scheme: "exact" },
    payload: {
      signature: "00" + "ab".repeat(32),
      publicKey: "02" + "ab".repeat(32),
      authorization: {
        from: "00" + "ab".repeat(32),
        to: payTo,
        value: amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "ab".repeat(32),
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function probeGate(): Promise<{ price: string; payTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${GATE_URL}/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      `✗ gate unreachable at ${GATE_URL} (${err instanceof Error ? err.message : err})`,
    );
    console.error(
      "  start it with:  LIGIS_JEV_ENABLED=1 AI_GATEWAY_API_KEY=... pnpm x402:dev",
    );
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`✗ service info at ${GATE_URL}/ returned ${res.status}`);
    process.exit(1);
  }

  const info = (await res.json()) as {
    price?: { smallestUnit?: string };
    payTo?: string | null;
  };
  if (!info.price?.smallestUnit) {
    console.error("✗ service info missing price.smallestUnit");
    process.exit(1);
  }
  if (!info.payTo) {
    console.error(
      "✗ service info missing payTo — set LIGIS_GATE_PAY_TO on the gate",
    );
    process.exit(1);
  }
  return { price: info.price.smallestUnit, payTo: info.payTo };
}

interface Row {
  scenario: string;
  status: number;
  verdict: string;
  confidence: string;
  flags: string;
  jevMs: number;
  cost: string;
  wallMs: number;
}

async function fire(
  scenario: string,
  amount: string,
  payTo: string,
): Promise<Row> {
  const t0 = Date.now();
  const res = await fetch(`${GATE_URL}/premium`, {
    headers: {
      "x-subject": SUBJECT,
      "x-payment": paymentHeader(amount, payTo),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const wallMs = Date.now() - t0;
  const h = res.headers;
  return {
    scenario,
    status: res.status,
    verdict: h.get("x-jev-verdict") ?? "(no header)",
    confidence: h.get("x-jev-confidence") ?? "—",
    flags: h.get("x-jev-flags") ?? "",
    jevMs: Number(h.get("x-jev-latency-ms") ?? "0"),
    cost: h.get("x-jev-cost-usd") ?? "—",
    wallMs,
  };
}

async function main() {
  console.log(`Jev Stress Demo → ${GATE_URL}`);
  console.log(
    `  subject: ${SUBJECT.slice(0, 22)}… (no credential needed — 401s are expected)`,
  );
  console.log(
    `  rounds:  ${ROUNDS} × 4 scenarios, in waves of ${CONCURRENCY}\n`,
  );

  const { price, payTo } = await probeGate();
  console.log(
    `  gate price: ${price} motes · advertised payee: ${payTo.slice(0, 18)}…\n`,
  );

  const scenarios: Scenario[] = [
    { id: "legit", amount: price, payTo },
    { id: "underpay", amount: "1", payTo },
    { id: "overpay", amount: (BigInt(price) * 500n).toString(), payTo },
    { id: "misdirected", amount: price, payTo: freshPayTo },
  ];

  // Each request does a real on-chain credential read before the Jev call,
  // so fire in waves rather than one unbounded pile — testnet RPCs rate-limit.
  const jobs: (() => Promise<Row>)[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (const s of scenarios) {
      const payToValue = typeof s.payTo === "function" ? s.payTo() : s.payTo;
      jobs.push(() => fire(s.id, s.amount, payToValue));
    }
  }

  const t0 = Date.now();
  const rows: Row[] = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    rows.push(
      ...(await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => j()))),
    );
  }
  const wallMs = Date.now() - t0;

  // A request without X-Jev headers means the intent layer is off.
  if (rows.every((r) => r.verdict === "(no header)")) {
    console.error(
      "✗ no X-Jev-* headers on any response — is LIGIS_JEV_ENABLED=1 set on the gate?",
    );
    process.exit(1);
  }

  const pad = (s: string, n: number) =>
    s.length >= n ? s : s + " ".repeat(n - s.length);
  const padL = (s: string, n: number) =>
    s.length >= n ? s : " ".repeat(n - s.length) + s;

  console.log(
    `${pad("scenario", 12)}${pad("status", 8)}${pad("verdict", 9)}${padL("conf", 6)}  ${pad("flags", 30)}${padL("jev ms", 7)}${padL("cost usd", 12)}`,
  );
  console.log("-".repeat(88));
  for (const r of rows) {
    console.log(
      `${pad(r.scenario, 12)}${pad(String(r.status), 8)}${pad(r.verdict, 9)}${padL(r.confidence, 6)}  ${pad(r.flags || "—", 30)}${padL(String(r.jevMs), 7)}${padL(r.cost, 12)}`,
    );
  }

  const withLatency = rows.filter((r) => r.jevMs > 0);
  const avgJev = withLatency.length
    ? Math.round(
        withLatency.reduce((s, r) => s + r.jevMs, 0) / withLatency.length,
      )
    : 0;
  const stops = rows.filter((r) => r.verdict === "STOP").length;
  const totalCost = rows.reduce((s, r) => {
    const v = Number(r.cost);
    return Number.isFinite(v) ? s + v : s;
  }, 0);

  console.log("-".repeat(88));
  console.log(
    `\n${rows.length} requests · ${wallMs}ms wall · avg intent ${avgJev}ms · ${stops} flagged · intent cost $${totalCost.toFixed(6)}`,
  );
  console.log(
    `\nEvery one of those ${rows.length} payments got a typed intent read — GO or STOP, with confidence — before any money moved.`,
  );
  console.log(`curl -i any gate response to see the verdict headers yourself.`);

  const lastrun = [
    `gate: ${GATE_URL}`,
    `requests: ${rows.length}`,
    `wall_ms: ${wallMs}`,
    `avg_intent_ms: ${avgJev}`,
    `flagged: ${stops}`,
    `intent_cost_usd: ${totalCost.toFixed(6)}`,
    `scenarios: legit,underpay,overpay,misdirected x${ROUNDS}`,
    `date: ${new Date().toISOString()}`,
  ].join("\n");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    new URL("./jev-stress-demo.lastrun.txt", import.meta.url),
    lastrun + "\n",
  );
  console.log(`\nlastrun → scripts/jev-stress-demo.lastrun.txt`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
