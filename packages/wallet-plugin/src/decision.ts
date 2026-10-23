/**
 * Gate client.
 *
 * `POST /api/gate` returns HTTP 200 for GO, STOP and UNKNOWN alike — the
 * verdict is in the body and the `X-Ligis-Gate-Verdict` header. `response.ok`
 * is therefore never sufficient, and this module treats the status code as
 * carrying no verdict information at all: it parses and strictly validates the
 * body, and anything it cannot validate is a refusal.
 */

import type {
  GateDecision,
  GateSignal,
  OperatorPolicy,
  ParsedOperation,
  Transport,
  Verdict,
} from "./types.js";

export type DecisionResult =
  | { ok: true; decision: GateDecision }
  | {
      ok: false;
      code: "decision-unavailable" | "decision-malformed" | "decision-timeout";
      reason: string;
    };

const VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  "GO",
  "STOP",
  "UNKNOWN",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSignal(value: unknown): GateSignal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const signal = value as Record<string, unknown>;
  if (typeof signal.id !== "string" || typeof signal.status !== "string") {
    return null;
  }
  if (
    !isFiniteNumber(signal.confidence) ||
    signal.confidence < 0 ||
    signal.confidence > 1
  ) {
    return null;
  }
  return {
    id: signal.id,
    status: signal.status,
    confidence: signal.confidence,
    ...(typeof signal.reason === "string" ? { reason: signal.reason } : {}),
  };
}

/** Strict schema check. A future verdict string fails closed rather than passing. */
export function parseDecision(payload: unknown): GateDecision | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.verdict !== "string" || !VERDICTS.has(body.verdict)) {
    return null;
  }
  if (!Array.isArray(body.signals)) {
    return null;
  }
  const signals: GateSignal[] = [];
  for (const entry of body.signals) {
    const signal = parseSignal(entry);
    if (!signal) return null;
    signals.push(signal);
  }
  if (!isFiniteNumber(body.latencyMs) || body.latencyMs < 0) return null;
  if (
    body.provenance !== undefined &&
    (!Array.isArray(body.provenance) ||
      body.provenance.some((entry) => typeof entry !== "string"))
  ) {
    return null;
  }
  return {
    verdict: body.verdict as Verdict,
    signals,
    latencyMs: body.latencyMs,
    provenance: Array.isArray(body.provenance)
      ? (body.provenance as string[])
      : [],
  };
}

/**
 * Lowest reported confidence across signals that actually answered. SKIPPED
 * means "layer disabled / didn't evaluate" and carries confidence 0 — counting
 * it would let a disabled layer veto every GO. All-skipped or empty answers 0.
 */
export function decisionConfidence(decision: GateDecision): number {
  const answered = decision.signals.filter(
    (signal) => signal.status !== "SKIPPED",
  );
  if (answered.length === 0) return 0;
  return Math.min(...answered.map((signal) => signal.confidence));
}

export async function fetchDecision(
  operation: ParsedOperation,
  policy: OperatorPolicy,
  purpose: string | undefined,
  transport: Transport,
): Promise<DecisionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.gateTimeoutMs);
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await transport(`${policy.gateEndpoint}/api/gate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        payee: operation.payee,
        amountUsd: operation.amountUsd,
        ...(policy.requiredCapability
          ? { capability: policy.requiredCapability }
          : {}),
        ...(purpose ? { purpose } : {}),
        mandate: {
          payees: [operation.payee],
          maxUsd: operation.amountUsd,
          expectedUsd: operation.amountUsd,
        },
      }),
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      code: aborted ? "decision-timeout" : "decision-unavailable",
      reason: aborted
        ? `gate did not answer within ${policy.gateTimeoutMs}ms`
        : `gate request failed: ${(error as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }

  // The gate answers every decision with HTTP 200 and the verdict in the body
  // (or the X-Ligis-Gate-Verdict header). Any other status is an error, and an
  // error status is never an assessment — even if the body happens to parse as
  // a well-formed decision.
  if (response.status !== 200) {
    return {
      ok: false,
      code: "decision-unavailable",
      reason: `gate returned HTTP ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      code: "decision-malformed",
      reason: "gate returned HTTP 200 with an unreadable body",
    };
  }

  const decision = parseDecision(payload);
  if (!decision) {
    return {
      ok: false,
      code: "decision-malformed",
      reason: "gate response did not match the decision schema",
    };
  }
  return { ok: true, decision };
}
