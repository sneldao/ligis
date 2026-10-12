/**
 * Tests for the decision→receipt mapping (`decision-receipt.ts`).
 *
 * Pure mapping — no chain RPC, no Jev. Verifies the product call:
 * right-payee/right-amount → policy, in-scope → identity,
 * verified-payee → capability, with SKIPPED folded to unknown and kept.
 */
import assert from "node:assert";
import { test } from "node:test";
import { decisionToTrustSignals } from "@/lib/decision-receipt";
import type { Decision } from "@/lib/decide";

function decision(signals: Decision["signals"]): Decision {
  return {
    verdict: "GO",
    signals,
    latencyMs: 10,
    provenance: [],
  };
}

const GO = {
  status: "GO" as const,
  confidence: 0.95,
  reason: "ok",
  latencyMs: 5,
};

test("maps payee+amount to policy, scope to identity, credential to capability", () => {
  const signals = decisionToTrustSignals(
    decision([
      { id: "right-payee", ...GO },
      { id: "right-amount", ...GO },
      { id: "in-scope", ...GO },
      {
        id: "verified-payee",
        ...GO,
        chain: "pharos-atlantic",
        capabilityHash: "0xab",
        issuer: "0xissuer",
        revoked: false,
      },
    ]),
  );
  assert.deepStrictEqual(
    signals.map((s) => s.kind),
    ["policy", "policy", "identity", "capability"],
  );
  assert.ok(signals.every((s) => s.verdict === "go"));
  assert.ok(signals.every((s) => s.confidence === 95));
});

test("folds SKIPPED to unknown and keeps the signal", () => {
  const signals = decisionToTrustSignals(
    decision([
      {
        id: "right-payee",
        status: "SKIPPED",
        confidence: 0,
        reason: "no contracted payee",
      },
      { id: "right-amount", ...GO },
      { id: "in-scope", ...GO },
      { id: "verified-payee", ...GO, chain: "pharos-atlantic" },
    ]),
  );
  assert.strictEqual(signals.length, 4);
  assert.strictEqual(signals[0]!.verdict, "unknown");
  assert.strictEqual(signals[0]!.metadata?.reason, "no contracted payee");
});

test("verified-payee carries chain source and credential metadata", () => {
  const signals = decisionToTrustSignals(
    decision([
      { id: "right-payee", ...GO },
      { id: "right-amount", ...GO },
      { id: "in-scope", ...GO },
      {
        id: "verified-payee",
        ...GO,
        chain: "monad-testnet",
        capabilityHash: "0xcd",
        issuer: "0xabc",
        expiresAt: "2027-01-01T00:00:00.000Z",
        revoked: false,
      },
    ]),
  );
  const cred = signals[3]!;
  assert.strictEqual(cred.source, "monad-testnet");
  assert.strictEqual(cred.metadata?.capability, "0xcd");
  assert.strictEqual(cred.metadata?.issuer, "0xabc");
});
