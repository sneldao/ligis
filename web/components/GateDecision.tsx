"use client";

import { useState, useEffect, useRef } from "react";
import { Rule } from "@/components/Rule";
import { SignalStack } from "@/components/SignalStack";
import { decisionToTrustSignals } from "@/lib/decision-receipt";
import type { Decision, PaymentAmount } from "@/lib/decide";

/**
 * GateDecision — client-side decision runner.
 *
 * Calls POST /api/gate with the provided PaymentIntent and renders the result.
 * Used by the plain-language gate flow on /gate and LandingGate.
 *
 * Privacy-light: no payee, amount, or IP is logged beyond the aggregate bucket.
 */
export type GateDecisionResult = Pick<
  Decision,
  "verdict" | "signals" | "latencyMs" | "costUsd"
>;

export type GateMandate = {
  payees?: string[];
  maxUsd?: number;
  /** Contracted price for this job. Used as Jev reference price.
   * When absent, amountUsd is used (compliant payment against cap).
   */
  expectedUsd?: number;
};

export function GateDecision({
  payee,
  amountUsd,
  purpose,
  capability,
  situation,
  mandate,
  payment,
}: {
  payee: string;
  amountUsd: number;
  /** Explicit token leg (ZEC zatoshis / USDC micro-units). When absent the
   *  API treats the intent as USDC derived from `amountUsd`. */
  payment?: PaymentAmount;
  purpose: string;
  capability: string;
  situation?: string;
  mandate?: GateMandate;
}) {
  const [result, setResult] = useState<GateDecisionResult | null>(null);
  const [rawDecision, setRawDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setRawDecision(null);

    void (async () => {
      try {
        const res = await fetch("/api/gate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            payee,
            amountUsd,
            purpose,
            capability,
            mandate,
            ...(payment ?? {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? res.statusText);
        }
        const data = await res.json();
        setResult({
          verdict: data.verdict,
          signals: data.signals,
          latencyMs: data.latencyMs,
          costUsd: data.costUsd,
        });
        // Keep the full decision for the signal-ledger receipt (chain,
        // issuer, latency per signal) — the slimmed shape above drives the
        // verdict display only.
        setRawDecision(data as Decision);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    payee,
    amountUsd,
    purpose,
    capability,
    situation,
    mandate?.payees?.join(","),
    mandate?.maxUsd,
    mandate?.expectedUsd,
    payment?.tokenSymbol,
    payment?.chainId,
    payment?.amountBaseUnits,
  ]);

  if (loading) {
    return (
      <div className="mt-6 flex flex-col gap-4 border-l-2 border-rule pl-6">
        <p className="font-serif text-lg italic text-ink-quiet">
          Reading payment evidence
          <span className="caret" aria-hidden />
        </p>
        <p className="font-mono text-[11px] text-ink-quiet">
          bounded server reads · no payment submitted
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 border-l-2 border-revoke pl-6">
        <p className="font-serif text-base text-revoke">{error}</p>
      </div>
    );
  }

  if (!result) return null;

  const go = result.verdict === "GO";
  const unknown = result.verdict === "UNKNOWN";
  const stopped = result.signals.filter((s) => s.status === "STOP");
  const skipped = result.signals.filter((s) => s.status === "SKIPPED");
  const jevOff =
    skipped.some((s) => s.id === "in-scope") &&
    skipped.every(
      (s) =>
        s.reason === undefined ||
        /no contracted|layer disabled|not configured|skipped/i.test(s.reason),
    );
  const reason = go
    ? "All answered signals passed. The agent may proceed with this counterparty."
    : unknown
      ? "Required checks did not establish a safe answer. UNKNOWN is not approval; the agent must not proceed."
      : stopped.length > 0
        ? `Stopped by: ${stopped.map((s) => s.reason ?? s.id).join(", ")}. The agent must not proceed.`
        : "The trust check did not pass. The agent must not proceed.";

  return (
    <div className="mt-6 space-y-8">
      {/* Main verdict */}
      <div
        className={`border-l-2 pl-6 ${go ? "border-sage" : unknown ? "border-rule" : "border-revoke"}`}
      >
        <p className="eyebrow">gate · pre-payment check</p>
        <p className="mt-3 display text-3xl text-ink-quiet sm:text-4xl">
          <span
            className={
              go ? "text-sage" : unknown ? "text-ink-quiet" : "text-revoke"
            }
          >
            {go ? "GO" : unknown ? "? UNKNOWN" : "STOP"}
          </span>
        </p>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          {reason}
        </p>
        {go && jevOff ? (
          <p className="mt-2 font-serif text-sm italic leading-relaxed text-ink-quiet">
            Intent not judged — the Jev layer is off, so this GO covers the
            credential and contracted terms only, not scope or prompt injection.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-[11px] text-ink-quiet">
          <span>latency {result.latencyMs}ms</span>
          {result.costUsd !== undefined ? (
            <span>cost ${result.costUsd.toFixed(4)}</span>
          ) : null}
          <span>verdict {result.verdict.toLowerCase()}</span>
        </div>
      </div>

      {/* Signal stack */}
      <div>
        <Rule />
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {result.signals.map((s) => (
            <div
              key={s.id}
              className={`border-l-2 pl-4 ${
                s.status === "STOP"
                  ? "border-revoke"
                  : s.status === "GO"
                    ? "border-sage"
                    : "border-rule"
              }`}
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm tabular text-ink">
                  {signalLabel(s.id)}
                </span>
                <span
                  className={`font-mono text-xs uppercase tracking-[0.14em] ${
                    s.status === "STOP"
                      ? "text-revoke"
                      : s.status === "GO"
                        ? "text-sage"
                        : "text-ink-quiet"
                  }`}
                >
                  {s.status}
                </span>
              </div>
              {s.reason ? (
                <p className="mt-1 font-serif text-sm text-ink-soft">
                  {s.reason}
                </p>
              ) : null}
              {s.confidence > 0 ? (
                <p className="mt-1 font-mono text-xs text-ink-quiet">
                  confidence {(s.confidence * 100).toFixed(0)}%
                </p>
              ) : null}
              {s.id === "verified-payee" && s.evidence?.length ? (
                <ul className="mt-3 space-y-3">
                  {s.evidence.map((e, i) => (
                    <li
                      key={`${e.source}:${i}`}
                      className="border-t border-rule pt-3"
                    >
                      <p className="font-mono text-[11px] text-ink-quiet">
                        {e.source} · {e.status} · observed {e.observedAt}
                      </p>
                      <p className="mt-1 font-serif text-sm text-ink-soft">
                        {e.reason}
                      </p>
                      {e.reference ? (
                        <p className="mt-1 break-all font-mono text-[11px] text-ink-quiet">
                          {e.reference}
                        </p>
                      ) : null}
                      {e.limitations.length ? (
                        <p className="mt-1 font-serif text-sm italic text-ink-quiet">
                          Gaps: {e.limitations.join("; ")}.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Share link */}
      <details className="group border-t border-rule pt-4">
        <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
          Share this check →
        </summary>
        <div className="mt-3 font-mono text-xs text-ink-quiet">
          <p>Open this URL to re-run the same decision:</p>
          <code className="mt-2 block break-all rounded bg-paper-deep px-4 py-3 text-[11px] text-ink">
            {typeof window !== "undefined"
              ? `${window.location.origin}/gate?subject=${encodeURIComponent(payee)}&amountUsd=${amountUsd}&purpose=${encodeURIComponent(purpose)}&capability=${encodeURIComponent(capability)}${mandate?.payees?.length ? `&mandatePayees=${encodeURIComponent(mandate.payees.join(","))}` : ""}${mandate?.maxUsd !== undefined ? `&mandateMaxUsd=${mandate.maxUsd}` : ""}${mandate?.expectedUsd !== undefined ? `&mandateExpectedUsd=${mandate.expectedUsd}` : ""}${payment ? `&tokenSymbol=${payment.tokenSymbol}&chainId=${encodeURIComponent(payment.chainId)}&amountBaseUnits=${payment.amountBaseUnits}` : ""}`
              : "Loading…"}
          </code>
        </div>
      </details>
      {/* Signal ledger — the shared trust-signal vocabulary */}
      {rawDecision ? (
        <details className="group border-t border-rule pt-4">
          <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
            Signal ledger →
          </summary>
          <div className="mt-3">
            <SignalStack signals={decisionToTrustSignals(rawDecision)} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function signalLabel(id: string): string {
  switch (id) {
    case "right-payee":
      return "right payee";
    case "right-amount":
      return "right amount";
    case "in-scope":
      return "in scope";
    case "verified-payee":
      return "verified payee";
    default:
      return id;
  }
}
