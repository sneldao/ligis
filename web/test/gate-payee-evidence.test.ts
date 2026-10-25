import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, type DecideDeps, type PaymentIntent } from "@/lib/decide";
import { runGateDecision } from "@/lib/gate-run";
import { usdcAmount } from "@/lib/payment-asset";
import { decisionToTrustSignals } from "@/lib/decision-receipt";
import { MONAD_TESTNET, PHAROS_ATLANTIC } from "@/lib/network";
import type { SubjectResolution } from "@/lib/resolve";
import type { PayeeEvidence } from "@/lib/payee-evidence/types";

const PAYEE = "0x1111111111111111111111111111111111111111";
const ISSUER = "0x2222222222222222222222222222222222222222";
const intent: PaymentIntent = {
  payee: PAYEE,
  amountUsd: 10,
  ...usdcAmount(10),
  purpose: "data delivery",
  capability: "data.premium",
  mandate: { payees: [PAYEE], maxUsd: 20, expectedUsd: 10 },
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LIGIS_PAYEE_EVIDENCE_ENABLED: "1",
  LIGIS_JEV_ENABLED: "1",
  AI_GATEWAY_API_KEY: "test-double",
};
function resolution(
  overrides: Record<string, unknown> = {},
): SubjectResolution {
  const outcome = {
    ok: true as const,
    subject: PAYEE,
    capabilityId: "data.premium",
    capabilityHash: `0x${"ab".repeat(32)}` as `0x${string}`,
    capable: false,
    issuer: null,
    expiresAt: null,
    revoked: false,
    ...overrides,
  };
  return {
    ok: true,
    subject: PAYEE,
    capabilityId: "data.premium",
    capable: outcome.capable,
    primary: { chain: MONAD_TESTNET, outcome },
    verdicts: [{ chain: MONAD_TESTNET, outcome }],
  };
}
const evidence = (
  source: PayeeEvidence["source"],
  status: PayeeEvidence["status"],
): PayeeEvidence => ({
  source,
  status,
  reason: `${source} ${status}`,
  observedAt: "2026-10-13T00:00:00Z",
  chainId: 10143,
  reference: `test:${source}`,
  limitations: ["injected, no live proof"],
});
const deps = (extra: Partial<DecideDeps> = {}): DecideDeps => ({
  env,
  resolveSubject: async () => resolution(),
  evaluateIntent: async () => ({
    verdict: "GO",
    confidence: 0.9,
    flags: [],
    latencyMs: 1,
  }),
  readPayeeEvidence: async () => [
    evidence("erc8004", "unknown"),
    evidence("x402-settlement", "unavailable"),
    evidence("nansen", "unavailable"),
  ],
  ...extra,
});

test("flag-on unfamiliar payee is UNKNOWN with successful absence, not STOP or GO", async () => {
  const d = await decide(intent, deps());
  assert.equal(d.verdict, "UNKNOWN");
  const s = d.signals[3];
  assert.equal(s.status, "UNKNOWN");
  assert.equal(s.id, "verified-payee");
  assert.equal(s.evidence?.[0].status, "unknown");
  assert.match(s.evidence![0].reason, /successful credential reads/);
  assert.equal(d.signals.length, 4);
});

test("flag-off preserves missing-credential STOP and never calls external readers", async () => {
  let reads = 0;
  const d = await decide(
    intent,
    deps({
      env: { ...env, LIGIS_PAYEE_EVIDENCE_ENABLED: "0" },
      readPayeeEvidence: async () => {
        reads++;
        return [];
      },
    }),
  );
  assert.equal(d.verdict, "STOP");
  assert.equal(reads, 0);
});

test("operator-required specific capability is resolved instead of caller capability and absence STOPs", async () => {
  let cap = "";
  const d = await decide(
    intent,
    deps({
      operatorPolicy: { requiredCapability: "kyc.basic" },
      resolveSubject: async (_, c) => {
        cap = c;
        return resolution();
      },
      readPayeeEvidence: async () => [evidence("erc8004", "positive")],
    }),
  );
  assert.equal(cap, "kyc.basic");
  assert.equal(d.verdict, "STOP");
  assert.match(d.signals[3].reason!, /specific non-self-issued capability/);
});

test("revoked/self-issued/expired credential negatives cannot be masked by positive independent evidence", async () => {
  for (const changes of [
    { revoked: true },
    { capable: true, issuer: PAYEE },
    { issuer: ISSUER, capable: false, expiresAt: 1n },
  ]) {
    const d = await decide(
      intent,
      deps({
        resolveSubject: async () => resolution(changes),
        readPayeeEvidence: async () => [evidence("erc8004", "positive")],
      }),
    );
    assert.equal(d.verdict, "STOP");
  }
});

test("a relevant negative on another credential rail wins over a primary positive", async () => {
  const r = resolution({ capable: true, issuer: ISSUER });
  assert(r.ok);
  const bad = resolution({ revoked: true });
  assert(bad.ok);
  r.verdicts.push({ chain: PHAROS_ATLANTIC, outcome: bad.primary.outcome });
  assert.equal(
    (await decide(intent, deps({ resolveSubject: async () => r }))).verdict,
    "STOP",
  );
});

test("configured independent evidence can answer GO without claiming a capability", async () => {
  const r = resolution();
  const d = await decide(
    intent,
    deps({
      resolveSubject: async () => r,
      readPayeeEvidence: async () => [evidence("erc8004", "positive")],
    }),
  );
  assert.equal(d.verdict, "GO");
  assert(
    r.ok && !r.capable,
    "reputation must not mutate SubjectResolution.capable",
  );
  const receipt = decisionToTrustSignals(d);
  assert.equal(receipt[3].kind, "risk");
  assert.equal(receipt[3].metadata?.capability, undefined);
  assert.equal(
    receipt[3].metadata?.capabilityRequested,
    `0x${"ab".repeat(32)}`,
  );
});

test("registration/untrusted evidence and history alone cannot generate GO", async () => {
  for (const external of [
    [evidence("erc8004", "unknown")],
    [evidence("x402-settlement", "positive")],
    [evidence("nansen", "positive")],
  ])
    assert.equal(
      (await decide(intent, deps({ readPayeeEvidence: async () => external })))
        .verdict,
      "UNKNOWN",
    );
});

test("missing intent remains UNKNOWN even with positive credential and a valid mandate", async () => {
  const d = await decide(
    intent,
    deps({
      env: { ...env, LIGIS_JEV_ENABLED: "0" },
      resolveSubject: async () => resolution({ capable: true, issuer: ISSUER }),
    }),
  );
  assert.equal(d.verdict, "UNKNOWN");
  assert.equal(d.signals[2].status, "UNKNOWN");
});

test("required UNKNOWN, missing, and unavailable sources never quietly become GO", async () => {
  for (const external of [
    [evidence("nansen", "unknown")],
    [evidence("nansen", "unavailable")],
    [evidence("nansen", "positive"), evidence("nansen", "unknown")],
    [],
  ]) {
    const d = await decide(
      intent,
      deps({
        operatorPolicy: { requiredSources: ["nansen"] },
        resolveSubject: async () =>
          resolution({ capable: true, issuer: ISSUER }),
        readPayeeEvidence: async () => external,
      }),
    );
    assert.equal(d.verdict, "UNKNOWN");
    assert.match(d.signals[3].reason!, /required evidence source nansen/);
  }
});

test("credential outage is unavailable, not successful absence, and blocks alternate positives", async () => {
  for (const resolveSubject of [
    async () => ({ ok: false as const, error: "RPC unavailable" }),
    async () => {
      throw new Error("RPC unavailable");
    },
  ]) {
    const d = await decide(
      intent,
      deps({
        resolveSubject,
        readPayeeEvidence: async () => [evidence("erc8004", "positive")],
      }),
    );
    assert.equal(d.verdict, "UNKNOWN");
    const s = d.signals[3];
    assert(s.id === "verified-payee");
    assert.equal(s.evidence?.[0].status, "unavailable");
  }
});

test("mandate violations always STOP despite positive evidence", async () => {
  for (const input of [
    { ...intent, amountUsd: 900, ...usdcAmount(900) },
    { ...intent, mandate: { ...intent.mandate, payees: [ISSUER] } },
  ]) {
    assert.equal(
      (
        await decide(
          input,
          deps({
            readPayeeEvidence: async () => [evidence("erc8004", "positive")],
          }),
        )
      ).verdict,
      "STOP",
    );
  }
});

test("caller JSON mandate cannot relax protected operator policy", async () => {
  const d = await decide(
    intent,
    deps({
      operatorPolicy: { mandate: { payees: [ISSUER], maxUsd: 1 } },
      readPayeeEvidence: async () => [evidence("erc8004", "positive")],
    }),
  );
  assert.equal(d.verdict, "STOP");
  assert.equal(d.signals[0].status, "STOP");
  assert.equal(d.signals[1].status, "STOP");
  const noSpend = await decide(
    intent,
    deps({ operatorPolicy: { mandate: { maxUsd: 0 } } }),
  );
  assert.equal(noSpend.signals[1].status, "STOP");
});

test("page judge GO cannot hide Jev STOP", async () => {
  const d = await decide(
    { ...intent, pageText: "page" },
    deps({
      evaluateIntent: async () => ({
        verdict: "STOP",
        confidence: 1,
        latencyMs: 1,
        flags: [{ id: "scope-mismatch", label: "bad scope", confidence: 1 }],
      }),
      judgePageText: () => ({ status: "GO", confidence: 1 }),
    }),
  );
  assert.equal(d.signals[2].status, "STOP");
});

test("credential, evidence, and Jev dispatch concurrently", async () => {
  const started: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  const d = decide(
    intent,
    deps({
      evaluateIntent: async () => {
        started.push("jev");
        await ready;
        return { verdict: "GO", confidence: 1, latencyMs: 1, flags: [] };
      },
      resolveSubject: async () => {
        started.push("credential");
        await ready;
        return resolution();
      },
      readPayeeEvidence: async () => {
        started.push("evidence");
        await ready;
        return [];
      },
    }),
  );
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started.sort(), ["credential", "evidence", "jev"]);
  release();
  assert.equal((await d).verdict, "UNKNOWN");
});

test("hung injected readers are bounded and UNKNOWN remains visible in receipt", async () => {
  const d = await decide(
    intent,
    deps({
      env: { ...env, LIGIS_PAYEE_EVIDENCE_TIMEOUT_MS: "10" },
      readPayeeEvidence: async () => new Promise(() => {}),
      operatorPolicy: { requiredSources: ["erc8004"] },
    }),
  );
  assert.equal(d.verdict, "UNKNOWN");
  const s = decisionToTrustSignals(d)[3];
  assert.equal(s.verdict, "unknown");
  assert.equal(s.metadata?.status, "UNKNOWN");
  assert(Array.isArray(s.metadata?.evidence));
});

test("previews never invoke recorder; explicit authenticated opt-in is a separate seam", async () => {
  let writes = 0;
  const options = {
    ...deps(),
    recorder: {
      authenticatedOptIn: false,
      record: async () => {
        writes++;
      },
    },
  };
  const result = await runGateDecision(intent, options);
  assert(result.ok && result.decision.verdict === "UNKNOWN");
  assert.equal(writes, 0);
  await runGateDecision(intent, {
    ...options,
    recorder: { ...options.recorder, authenticatedOptIn: true },
  });
  assert.equal(writes, 1);
});
