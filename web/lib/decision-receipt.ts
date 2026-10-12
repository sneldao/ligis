/**
 * Decision receipt — maps a `decide()` result onto the shared trust-signal
 * vocabulary so `SignalStack` / `TrustReceipt` can render it.
 *
 * Mapping (the product call — see AGENTS.md):
 * - right-payee    → policy   (the operator's allowlist is a policy check)
 * - right-amount   → policy   (cap + contracted price are policy checks)
 * - in-scope       → identity (scope is about *what the agent is*, not money)
 * - verified-payee → capability (the on-chain credential read)
 *
 * Verdict folding: GO → go, STOP → stop, SKIPPED → unknown. Skipped signals
 * are kept (not dropped) so the receipt shows what *didn't* answer — the
 * honest-skip rule made visible.
 *
 * Confidence: decide() reports 0..1; TrustSignal wants 0..100. Scaled.
 */
import type { TrustSignal } from "@ligis/core";
import type { Decision, Signal } from "./decide";

export function decisionToTrustSignals(decision: Decision): TrustSignal[] {
  return decision.signals.map((s) => toTrustSignal(s));
}

function toTrustSignal(s: Signal): TrustSignal {
  return {
    kind: signalKind(s.id),
    source: signalSource(s),
    verdict:
      s.status === "GO" ? "go" : s.status === "STOP" ? "stop" : "unknown",
    confidence: Math.round(s.confidence * 100),
    metadata: {
      signal: s.id,
      ...(s.reason ? { reason: s.reason } : {}),
      ...(s.latencyMs !== undefined ? { latencyMs: s.latencyMs } : {}),
      ...signalMetadata(s),
    },
  };
}

function signalKind(id: Signal["id"]): TrustSignal["kind"] {
  switch (id) {
    case "right-payee":
      return "policy";
    case "right-amount":
      return "policy";
    case "in-scope":
      return "identity";
    case "verified-payee":
      return "capability";
  }
}

function signalSource(s: Signal): string {
  if (s.id === "verified-payee") {
    return s.chain ?? "credential-registry";
  }
  if (s.id === "in-scope") {
    return "jev-intent";
  }
  return "operator-mandate";
}

function signalMetadata(s: Signal): Record<string, unknown> {
  if (s.id !== "verified-payee") return {};
  const v = s as Extract<Signal, { id: "verified-payee" }>;
  return {
    ...(v.capabilityHash ? { capability: v.capabilityHash } : {}),
    ...(v.issuer ? { issuer: v.issuer } : {}),
    ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
    ...(v.revoked !== undefined ? { revoked: v.revoked } : {}),
  };
}
