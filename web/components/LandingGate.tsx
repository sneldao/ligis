"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GateStates } from "@/components/GateStates";
import { Rule } from "@/components/Rule";
import { SituationCast } from "@/components/SituationCast";
import { VerifyDemo } from "@/components/VerifyDemo";
import { getSituation, type Situation } from "@/lib/situations";

/**
 * Home product loop: pick a moment → walk the branch → run the live read.
 * Selection syncs capability and flashes a brief “synced” cue.
 *
 * The cast only renders the default moments by default; deep-linking via
 * `?situation=<id>` (e.g. from a share link) appends that moment so the
 * visitor lands on it without the landing changing for everyone else.
 */
export function LandingGate({
  capabilities,
  defaultSubject,
}: {
  capabilities: { id: string; label: string }[];
  defaultSubject: string;
}) {
  const searchParams = useSearchParams();
  const requestedSituation = searchParams?.get("situation") ?? undefined;
  const extraMomentIds =
    requestedSituation && getSituation(requestedSituation)
      ? [requestedSituation]
      : undefined;

  const initial: Situation =
    (requestedSituation && getSituation(requestedSituation)) ||
    getSituation("treasury")!;

  const [situation, setSituation] = useState<Situation>(initial);
  const [synced, setSynced] = useState(false);

  function onSelect(s: Situation) {
    setSituation(s);
    setSynced(true);
  }

  useEffect(() => {
    if (!synced) return;
    const t = window.setTimeout(() => setSynced(false), 900);
    return () => window.clearTimeout(t);
  }, [synced, situation.id]);

  return (
    <div className="space-y-14 sm:space-y-16">
      <SituationCast
        mode="sync"
        activeId={situation.id}
        extraMomentIds={extraMomentIds}
        onSelect={onSelect}
      />

      <section id="verify" className="scroll-mt-24">
        <header className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">The gate</p>
          <p
            key={synced ? `sync-${situation.id}` : situation.id}
            className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
              synced ? "sync-flash" : "text-ink-quiet"
            }`}
          >
            {synced ? (
              <>
                <span className="text-terra">synced</span>
                <span className="mx-2">·</span>
              </>
            ) : null}
            <span className="text-ink">{situation.role}</span>
            <span className="mx-2">·</span>
            <code className="normal-case tracking-normal">
              {situation.capability}
            </code>
          </p>
        </header>
        <Rule className="mt-4" />

        <div className="mt-8 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,16rem)_1fr]">
          <div>
            <h2 className="display text-2xl text-ink sm:text-3xl">
              Run the read.
            </h2>
            <p className="mt-4 font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
              Same call an agent makes the instant before money moves. Verdict
              from chain — not a Ligis server.
            </p>
            <p className="mt-6 hidden font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet lg:block">
              <a
                href="#situations"
                className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                ← change moment
              </a>
            </p>
          </div>
          <div className="space-y-10">
            <GateStates />
            <VerifyDemo
              key={situation.capability}
              capabilities={capabilities}
              defaultSubject={defaultSubject}
              defaultCapability={situation.capability}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
