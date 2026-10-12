"use client";

import { useState, useEffect, useRef } from "react";
import { Rule } from "@/components/Rule";
import { GateVerdict } from "@/components/GateVerdict";
import type { GateVerdictInput } from "@/components/GateVerdict";
import { SubjectSpecimen } from "@/components/SubjectSpecimen";

/**
 * GateDecision — client-side decision runner.
 *
 * Calls POST /api/gate with the provided PaymentIntent and renders the result.
 * Used by the plain-language gate flow on /gate and LandingGate.
 *
 * Privacy-light: no payee, amount, or IP is logged beyond the aggregate bucket.
 */
export type GateDecisionResult = {
  verdict: "GO" | "STOP" | "UNKNOWN";
  signals: Array<{
    id: string;
    status: "GO" | "STOP" | "SKIPPED";
    confidence: number;
    reason?: string;
  }>;
  latencyMs: number;
  costUsd?: number;
};

export function GateDecision({
  payee,
  amountUsd,
  purpose,
  capability,
  situation,
}: {
  payee: string;
  amountUsd: number;
  purpose: string;
  capability: string;
  situation?: string;
}) {
  const [result, setResult] = useState<GateDecisionResult | null>(null);
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

    void (async () => {
      try {
        const res = await fetch("/api/gate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payee, amountUsd, purpose, capability }),
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
  }, [payee, amountUsd, purpose, capability, situation]);

  if (loading) {
    return (
      <div className="mt-6 flex flex-col gap-4 border-l-2 border-rule pl-6">
        <p className="font-serif text-lg italic text-ink-quiet">
          Reading registry
          <span className="caret" aria-hidden />
        </p>
        <p className="font-mono text-[11px] text-ink-quiet">
          one on-chain read · not a Ligis server
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
  const stopped = result.signals.filter((s) => s.status === "STOP");
  const reason = go
    ? "All signals passed. The agent may proceed with this counterparty."
    : stopped.length > 0
      ? `Stopped by: ${stopped.map((s) => s.reason ?? s.id).join(", ")}. The agent must not proceed.`
      : "The trust check did not pass. The agent must not proceed.";

  // Build GateVerdictInput from the Decision result
  const payeeSignal = result.signals.find((s) => s.id === "right-payee");
  const amountSignal = result.signals.find((s) => s.id === "right-amount");
  const scopeSignal = result.signals.find((s) => s.id === "in-scope");
  const credSignal = result.signals.find((s) => s.id === "verified-payee");

  const hasCredential = credSignal?.status === "GO";
  const credentialSubject = typeof payee === "string" ? payee : "";

  const gateVerdict: GateVerdictInput = {
    capable: hasCredential,
    subject: credentialSubject,
    capabilityId: capability,
    issuer: null,
    expiresAt: null,
    revoked: false,
  };

  return (
    <div className="mt-6 space-y-8">
      {/* Main verdict */}
      <div
        className={`border-l-2 pl-6 ${go ? "border-sage" : "border-revoke"}`}
      >
        <p className="eyebrow">gate · pre-payment check</p>
        <p className="mt-3 display text-3xl text-ink-quiet sm:text-4xl">
          <span className={go ? "text-sage" : "text-revoke"}>
            {go ? "✓ GO" : "✗ STOP"}
          </span>
        </p>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          {reason}
        </p>
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
              ? `${window.location.origin}/gate?subject=${encodeURIComponent(payee)}&amountUsd=${amountUsd}&purpose=${encodeURIComponent(purpose)}&capability=${encodeURIComponent(capability)}`
              : "Loading…"}
          </code>
        </div>
      </details>
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
