"use client";

import { useState, useEffect, useRef } from "react";
import { DecisionVerdict } from "@/components/DecisionVerdict";
import { SignalStack } from "@/components/SignalStack";
import { Term } from "@/components/Term";
import { decisionToTrustSignals } from "@/lib/decision-receipt";
import type { Decision, PaymentAmount } from "@/lib/decide";
import {
  ZkCredentialResultView,
  ZkProofAttach,
} from "@/components/ZkCredential";

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
  shareInline = true,
}: {
  /** Render the "Share this check" disclosure (off when the page has its own). */
  shareInline?: boolean;
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
  const [zkBusy, setZkBusy] = useState(false);

  // One-shot submit with a zk proof. Not an effect: a verified proof burns
  // its nullifier, so a re-render/StrictMode double-run would be a replay.
  async function runWithProof(zkProof: unknown) {
    abortRef.current?.abort();
    setZkBusy(true);
    setError(null);
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
          zkProof,
        }),
      });
      const data = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setResult({
        verdict: data.verdict,
        signals: data.signals,
        latencyMs: data.latencyMs,
        costUsd: data.costUsd,
      });
      setRawDecision(data as Decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setZkBusy(false);
    }
  }

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

  const body = loading ? (
    <div className="flex flex-col gap-4 border-l-2 border-rule pl-6">
      <p className="font-serif text-lg italic text-ink-soft">
        Checking the payment
        <span className="caret" aria-hidden />
      </p>
      <p className="font-mono text-[11px] text-ink-quiet">
        bounded server reads · no payment submitted
      </p>
    </div>
  ) : error ? (
    <div className="border-l-2 border-terra pl-6">
      <p className="eyebrow">the gate couldn&rsquo;t answer</p>
      <p className="mt-2 font-serif text-base text-ink">{error}</p>
      <p className="mt-2 font-serif text-sm text-ink-soft">
        No decision means no approval: the agent should not pay. Check the
        address and amount, then run the gate again.
      </p>
    </div>
  ) : null;

  if (!result) {
    return (
      <div className="mt-6" role="status" aria-live="polite">
        {body}
      </div>
    );
  }

  const skipped = result.signals.filter((s) => s.status === "SKIPPED");
  const jevOff =
    result.verdict === "GO" &&
    skipped.some((s) => s.id === "in-scope") &&
    skipped.every(
      (s) =>
        s.reason === undefined ||
        /no contracted|layer disabled|not configured|skipped/i.test(s.reason),
    );
  const evidence =
    rawDecision?.signals.find((s) => s.id === "verified-payee")?.evidence ?? [];

  return (
    <div className="mt-6 space-y-8">
      <div role="status" aria-live="polite" aria-atomic="true">
        {body ?? (
          <>
            <DecisionVerdict decision={result} />
            {jevOff ? (
              <p className="mt-3 pl-6 font-serif text-sm italic leading-relaxed text-ink-quiet">
                Intent wasn&rsquo;t judged on this server (the{" "}
                <Term term="jev">Jev intent reader</Term> is off), so this GO
                covers the credential and contracted terms, not scope or prompt
                injection.
              </p>
            ) : null}
          </>
        )}
      </div>

      {evidence.length ? (
        <details className="group border-t border-rule pt-4">
          <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
            Payee evidence ({evidence.length}) →
          </summary>
          <ul className="mt-3 space-y-3">
            {evidence.map((e, i) => (
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
        </details>
      ) : null}

      {/* ZK credential presentation (Zecathon Week 2) */}
      {rawDecision?.zkCredential ? (
        <ZkCredentialResultView zk={rawDecision.zkCredential} />
      ) : null}
      <ZkProofAttach onSubmit={runWithProof} busy={zkBusy} />

      {/* Share link */}
      {shareInline ? (
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
      ) : null}
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
