/**
 * Gate decision execution — the part of `POST/GET /api/gate` that tests need.
 *
 * Lives outside `route.ts` because Next's generated route types require every
 * non-route export from that file to satisfy `{ [x: string]: never }` — a
 * constraint `next build` enforces but `tsc --noEmit` does not. The route
 * handler owns the HTTP layer; this module owns decide() + error mapping.
 */
import {
  decide,
  type DecideDeps,
  type Decision,
  type PaymentIntent,
} from "./decide";
import { resolveSubject as resolveSubjectProd } from "./resolve";
import type { SubjectResolution } from "./resolve";
import { readPayeeEvidence } from "./payee-evidence";
import { boundedRead, evidenceTimeout } from "./payee-evidence/types";

export type GateRunResult =
  | { ok: true; decision: Decision }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function runGateDecision(
  intent: PaymentIntent,
  opts?: {
    resolveSubject?: (payee: string, cap: string) => Promise<SubjectResolution>;
    env?: NodeJS.ProcessEnv;
    evaluateIntent?: DecideDeps["evaluateIntent"];
    readPayeeEvidence?: DecideDeps["readPayeeEvidence"];
    operatorPolicy?: DecideDeps["operatorPolicy"];
    /** Coordinator/D seam. Not invoked by previews, and never loaded implicitly.
     * The caller must authenticate consent and update privacy docs before opting in.
     */
    recorder?: {
      authenticatedOptIn: boolean;
      record: (decision: Decision) => Promise<void>;
    };
  },
): Promise<GateRunResult> {
  const env = opts?.env ?? process.env;
  const resolve: DecideDeps["resolveSubject"] =
    opts?.resolveSubject ??
    ((payee, cap, context) =>
      resolveSubjectProd(payee, cap, {
        evidenceMode: env.LIGIS_PAYEE_EVIDENCE_ENABLED === "1",
        timeoutMs: context?.timeoutMs,
        signal: context?.signal,
      }));
  try {
    const decision = await decide(intent, {
      resolveSubject: (payee, capability, context) =>
        resolve(payee, capability, context),
      env,
      evaluateIntent: opts?.evaluateIntent,
      readPayeeEvidence: opts?.readPayeeEvidence ?? readPayeeEvidence,
      operatorPolicy: opts?.operatorPolicy,
    });
    // No route supplies this opt-in. Recording failure cannot alter a decision.
    if (opts?.recorder?.authenticatedOptIn) {
      try {
        await boundedRead(
          () => opts.recorder!.record(decision),
          evidenceTimeout(Number(env.LIGIS_PAYEE_EVIDENCE_TIMEOUT_MS)),
        );
      } catch {
        /* retain read result */
      }
    }
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
