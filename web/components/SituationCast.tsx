"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Rule } from "@/components/Rule";
import { SITUATIONS, type Situation } from "@/lib/situations";

/**
 * Moment picker — exclusive accordion (radio pattern).
 * Closed rows are role + check only. One open shows the instant and
 * without→with contrast. On home, selection syncs the live gate below.
 */
export function SituationCast({
  chainId,
  activeId,
  mode = "link",
  onSelect,
}: {
  chainId: string;
  /** Prefill / highlight (e.g. from /gate?situation=) */
  activeId?: string;
  /**
   * `link` — each moment deep-links to /gate (default on /gate).
   * `sync` — selecting updates the live demo on the same page (home).
   */
  mode?: "link" | "sync";
  onSelect?: (situation: Situation) => void;
}) {
  const groupId = useId();
  const initial =
    activeId && SITUATIONS.some((s) => s.id === activeId)
      ? activeId
      : SITUATIONS[0]!.id;
  const [openId, setOpenId] = useState(initial);

  function select(s: Situation) {
    setOpenId(s.id);
    onSelect?.(s);
  }

  return (
    <section id="situations" className="scroll-mt-24" aria-labelledby={groupId}>
      <header className="flex items-baseline justify-between gap-4">
        <p id={groupId} className="eyebrow">
          Your moment
        </p>
        <p className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet sm:block">
          {mode === "sync" ? "pick · demo updates" : "pick · then gate"}
        </p>
      </header>
      <Rule className="mt-4" />

      <ul className="mt-2" role="list">
        {SITUATIONS.map((s, i) => {
          const open = openId === s.id;
          const gateHref = `/gate?chain=${chainId}&situation=${s.id}&capability=${s.capability}`;

          return (
            <li key={s.id} className="border-t border-rule first:border-t-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`moment-${s.id}`}
                onClick={() => select(s)}
                className="flex w-full items-baseline gap-3 py-4 text-left transition-colors sm:gap-5 sm:py-5"
              >
                <span
                  className={`shrink-0 font-mono text-xs tabular ${
                    open ? "text-terra" : "text-ink-quiet"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block font-mono text-[11px] uppercase tracking-[0.12em] ${
                      open ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {s.role}
                  </span>
                  <span
                    className={`mt-1 block font-serif text-sm leading-snug sm:text-base ${
                      open ? "text-ink" : "text-ink-quiet"
                    }`}
                  >
                    {s.check}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 font-mono text-[11px] transition-colors ${
                    open ? "text-terra" : "text-ink-quiet"
                  }`}
                >
                  {open ? "−" : "+"}
                </span>
              </button>

              <div
                id={`moment-${s.id}`}
                role="region"
                hidden={!open}
                className={
                  open
                    ? "animate-fade-in border-t border-rule-soft pb-5 pl-8 sm:pl-12"
                    : undefined
                }
              >
                {open ? (
                  <MomentBody situation={s} gateHref={gateHref} mode={mode} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MomentBody({
  situation: s,
  gateHref,
  mode,
}: {
  situation: Situation;
  gateHref: string;
  mode: "link" | "sync";
}) {
  return (
    <div className="pt-4">
      <p className="max-w-xl font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
        <span className="text-ink-quiet">Moment · </span>
        {s.moment}
      </p>

      <div className="mt-4 grid max-w-2xl gap-3 border-l-2 border-rule pl-4 sm:grid-cols-2 sm:gap-6">
        <p className="font-serif text-sm leading-relaxed text-ink-soft">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-revoke">
            Blind
          </span>
          <span className="mt-1 block">{s.without}</span>
        </p>
        <p className="font-serif text-sm leading-relaxed text-ink-soft">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-sage">
            Gated
          </span>
          <span className="mt-1 block">{s.withLigis}</span>
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <code className="font-mono text-[11px] text-ink-quiet">
          {s.capability}
        </code>
        {mode === "sync" ? (
          <>
            <a
              href="#verify"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-terra underline decoration-terra/40 decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Run below →
            </a>
            <Link
              href={gateHref}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Full gate →
            </Link>
          </>
        ) : (
          <Link
            href={gateHref}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-terra underline decoration-terra/40 decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Open gate →
          </Link>
        )}
      </div>
    </div>
  );
}
