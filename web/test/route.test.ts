import assert from "node:assert";
import { test } from "node:test";
import { parseMandate } from "@/lib/mandate";
import { bodyToIntent, queryToIntent } from "@/lib/gate-intent";
import { runGateDecision } from "@/lib/gate-run";
import type { SubjectResolution } from "@/lib/resolve";

// NOTE: bodyToIntent / queryToIntent / runGateDecision live in lib/gate-intent
// + lib/gate-run, not route.ts — Next's generated route types require every
// non-route export to satisfy `{ [x: string]: never }`, so exporting helpers
// from route.ts breaks `next build` (a constraint `tsc --noEmit` doesn't
// apply). These tests exercise the exact validation + decision layer the
// route delegates to, with no route import needed.
const PAYEE = "0x89AbCdEf0123456789abcdef0123456789abcdef0" as `0x${string}`;

// Mandate parser tests — these exercise the exact validation logic that
// bodyToIntent delegates to parseMandate(). parseMandate is in
// lib/mandate.ts (pure, no server-only dep). The decide.test.ts tests cover
// the full decision pipeline; these cover the parsing/validation layer.

test("parseMandate parses expectedUsd from mandate", () => {
  const mandateRaw = {
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: 100,
  };
  const result = parseMandate(mandateRaw);
  assert.ok(
    typeof result !== "string",
    `expected mandate object, got: ${result}`,
  );
  const mandate = result as NonNullable<
    Parameters<typeof import("@/lib/decide").decide>[0]["mandate"]
  >;
  assert.strictEqual(mandate.expectedUsd, 100, "expectedUsd should be parsed");
  assert.strictEqual(mandate.payees?.length, 1);
  assert.strictEqual(mandate.maxUsd, 10000);
});

test("parseMandate rejects invalid expectedUsd", () => {
  const result = parseMandate({
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: -5,
  });
  assert.strictEqual(result, "mandate.expectedUsd must be > 0");
});

test("parseMandate rejects non-numeric expectedUsd", () => {
  const result = parseMandate({
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: "not-a-number",
  });
  assert.strictEqual(
    typeof result,
    "string",
    "expected error string for invalid expectedUsd",
  );
});

// ─── intent parsing (same code the route delegates to) ────────────────

test("bodyToIntent builds intent with mandate", () => {
  const intent = bodyToIntent({
    payee: PAYEE,
    amountUsd: 100,
    purpose: "Q4 renewal",
    capability: "agent.commerce.escrow",
    mandate: { payees: [PAYEE], maxUsd: 10000, expectedUsd: 100 },
  });
  assert.ok(typeof intent !== "string", `expected intent, got: ${intent}`);
  const asIntent = intent as { mandate?: { expectedUsd?: number } };
  assert.strictEqual(asIntent.mandate?.expectedUsd, 100);
});

test("bodyToIntent rejects bad payee", () => {
  const out = bodyToIntent({
    payee: "",
    amountUsd: 100,
    purpose: "x",
  });
  assert.ok(
    typeof out === "string" && out.startsWith("__bad_request__:"),
    `expected bad-request marker, got: ${JSON.stringify(out)}`,
  );
});

test("queryToIntent carries mandatePayees/maxUsd/expectedUsd", () => {
  const out = queryToIntent(
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    "100",
    "Q4 renewal",
    "agent.commerce.escrow",
    {
      mandatePayees: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      mandateMaxUsd: "10000",
      mandateExpectedUsd: "100",
    },
  );
  assert.ok(typeof out !== "string", `expected intent, got: ${out}`);
  const intent = out as {
    mandate?: { payees?: string[]; maxUsd?: number; expectedUsd?: number };
  };
  assert.deepStrictEqual(intent.mandate?.payees, [
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  ]);
  assert.strictEqual(intent.mandate?.maxUsd, 10000);
  assert.strictEqual(intent.mandate?.expectedUsd, 100);
});

test("queryToIntent rejects bad mandateMaxUsd", () => {
  const out = queryToIntent(
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    "100",
    "Q4 renewal",
    null,
    {
      mandateMaxUsd: "-5",
    },
  );
  assert.ok(
    typeof out === "string" && out.startsWith("__bad_request__:"),
    `expected bad-request marker, got: ${JSON.stringify(out)}`,
  );
});

// ─── decisions (same code the route delegates to) ─────────────────────

function credentialOkStub(): SubjectResolution {
  return {
    ok: true as const,
    subject: PAYEE,
    capabilityId: "agent.commerce.escrow",
    capable: true,
    verdicts: [],
    primary: {
      chain: {
        id: "pharos-atlantic",
        kind: "evm" as const,
        name: "Pharos Atlantic Testnet",
        explorerUrl: "https://atlantic.pharosscan.xyz",
        live: true,
        shortName: "pharos",
        writeReady: true,
      },
      outcome: {
        ok: true as const,
        subject: PAYEE,
        capabilityId: "agent.commerce.escrow",
        capabilityHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
        capable: true,
        issuer: "0xa1c4e3f0123456789abcdef0123456789abcdef0" as `0x${string}`,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400 * 90),
        revoked: false,
      },
    },
  };
}

test("runGateDecision returns GO over stubbed resolveSubject", async () => {
  const out = await runGateDecision(
    {
      payee: PAYEE,
      amountUsd: 100,
      purpose: "Q4 renewal",
      capability: "agent.commerce.escrow",
      mandate: { payees: [PAYEE], maxUsd: 10000, expectedUsd: 100 },
    },
    { resolveSubject: async () => credentialOkStub() },
  );
  assert.ok(out.ok, `expected decision, got: ${JSON.stringify(out)}`);
  // Mandate pins payee + amount (both GO), credential stub is GO, Jev is off
  // in the test env (SKIPPED, neutral) — composition yields GO.
  assert.strictEqual(out.decision.verdict, "GO");
  assert.strictEqual(out.decision.signals.length, 4);
});

test("runGateDecision with cap-only mandate keeps right-payee SKIPPED", async () => {
  // Regression: the /gate form must never default the allowlist to the payee
  // being checked — a cap/quote alone must leave right-payee skipped, not GO.
  const out = await runGateDecision(
    {
      payee: PAYEE,
      amountUsd: 100,
      purpose: "Q4 renewal",
      capability: "agent.commerce.escrow",
      mandate: { maxUsd: 10000 },
    },
    { resolveSubject: async () => credentialOkStub() },
  );
  assert.ok(out.ok, `expected decision, got: ${JSON.stringify(out)}`);
  const payeeSignal = out.decision.signals.find((s) => s.id === "right-payee")!;
  assert.strictEqual(payeeSignal.status, "SKIPPED");
  assert.ok(payeeSignal.reason?.includes("no contracted payee"));
  assert.strictEqual(out.decision.verdict, "UNKNOWN");
});
