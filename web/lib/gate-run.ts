/**
 * Gate decision execution — the part of `POST/GET /api/gate` that tests need.
 *
 * Lives outside `route.ts` because Next's generated route types require every
 * non-route export from that file to satisfy `{ [x: string]: never }` — a
 * constraint `next build` enforces but `tsc --noEmit` does not. The route
 * handler owns the HTTP layer; this module owns decide() + error mapping.
 */
import { decide, type Decision, type PaymentIntent } from "./decide";
import { resolveSubject as resolveSubjectProd } from "./resolve";
import type { SubjectResolution } from "./resolve";

export type GateRunResult =
  | { ok: true; decision: Decision }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function runGateDecision(
  intent: PaymentIntent,
  opts?: {
    resolveSubject?: (payee: string, cap: string) => Promise<SubjectResolution>;
  },
): Promise<GateRunResult> {
  const resolve = opts?.resolveSubject ?? resolveSubjectProd;
  try {
    const decision = await decide(intent, {
      resolveSubject: (payee, capability) => resolve(payee, capability),
    });
    // Privacy-light aggregate counter — verdict only, no payee / amount.
    try {
      const { record } = await import("./counters");
      const bucket =
        decision.verdict === "GO"
          ? "api:go"
          : decision.verdict === "STOP"
            ? "api:stop"
            : "api:unknown";
      record("api_call", bucket);
    } catch {
      // counters must never break the response
    }
    return { ok: true, decision };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return {
        ok: false,
        status: 504,
        body: { error: "jev layer timed out", upstream: "jev" },
      };
    }
    if (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("RPC") ||
      msg.includes("chain")
    ) {
      return {
        ok: false,
        status: 502,
        body: {
          error: "credential read failed",
          upstream: "chain",
          detail: msg.slice(0, 300),
        },
      };
    }
    console.error("[/api/gate] unexpected error:", msg);
    try {
      const { record } = await import("./counters");
      record("api_call", "api:error");
    } catch {
      // ignore
    }
    return { ok: false, status: 500, body: { error: msg.slice(0, 300) } };
  }
}
