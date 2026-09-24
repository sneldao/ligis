"use client";

import { useState } from "react";
import { ChainBadge } from "@/components/ChainBadge";
import { GateStates } from "@/components/GateStates";
import { LiveDot } from "@/components/LiveDot";
import { Rule } from "@/components/Rule";
import { SituationCast } from "@/components/SituationCast";
import { PHAROS_ATLANTIC } from "@/lib/network";

/**
 * Interactive styleguide specimens — the delight primitives that page
 * authors must compose from, not reinvent.
 */
export function StyleguideInteractions() {
  const [synced, setSynced] = useState(false);

  return (
    <div className="space-y-20">
      <section className="space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">08 · GateStates</p>
          <span className="font-mono text-xs text-ink-quiet">
            401 · 402 · 200
          </span>
        </header>
        <Rule />
        <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
          The x402 branch walk. Toggle only — colour and underline, never scale.
          Reuse on home and <code className="font-mono text-ink">/gate</code>;
          do not invent a second three-state control.
        </p>
        <GateStates />
      </section>

      <section className="space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">09 · SituationCast</p>
          <span className="font-mono text-xs text-ink-quiet">
            accordion · Blind↔Gated · keys 1–5
          </span>
        </header>
        <Rule />
        <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
          Moment casting. One row open. Inside: Blind↔Gated flip with ✓ GO / ✗
          STOP preview. Mode <code className="font-mono text-ink">link</code>{" "}
          deep-links to the gate;{" "}
          <code className="font-mono text-ink">sync</code> updates a live demo
          on the same page.
        </p>
        <SituationCast chainId={PHAROS_ATLANTIC.id} mode="link" />
      </section>

      <section className="space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">10 · Live chrome</p>
          <span className="font-mono text-xs text-ink-quiet">
            LiveDot · ChainBadge · sync-flash
          </span>
        </header>
        <Rule />
        <div className="space-y-8">
          <div className="space-y-2">
            <p className="eyebrow">LiveDot</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
              <LiveDot className="mr-2" />
              registry reachable
            </p>
          </div>
          <div className="space-y-2">
            <p className="eyebrow">ChainBadge</p>
            <ChainBadge chain={PHAROS_ATLANTIC} live />
            <div className="mt-3">
              <ChainBadge chain={PHAROS_ATLANTIC} live={false} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="eyebrow">sync-flash</p>
            <p className="font-serif text-sm leading-relaxed text-ink-soft">
              When one control updates another (moment → capability), flash
              briefly so the visitor sees the link.
            </p>
            <button
              type="button"
              onClick={() => {
                setSynced(true);
                window.setTimeout(() => setSynced(false), 900);
              }}
              className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-terra underline decoration-terra/40 underline-offset-4 hover:decoration-terra"
            >
              Trigger sync →
            </button>
            <p
              key={synced ? "on" : "off"}
              className={`mt-3 font-mono text-[11px] uppercase tracking-[0.12em] ${
                synced ? "sync-flash" : "text-ink-quiet"
              }`}
            >
              {synced ? (
                <>
                  <span className="text-terra">synced</span>
                  <span className="mx-2">·</span>
                </>
              ) : null}
              <code className="normal-case tracking-normal">kyc.basic</code>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
