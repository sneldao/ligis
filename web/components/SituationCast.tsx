"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Rule } from "@/components/Rule";
import { VerdictMark } from "@/components/VerdictMark";
import {
  DEFAULT_SITUATION_IDS,
  SITUATIONS,
  getSituation,
  type Situation,
} from "@/lib/situations";

/**
 * Moment picker — exclusive accordion with a Blind↔Gated flip inside.
 *
 * By default, only the moments listed in `DEFAULT_SITUATION_IDS`
 * (treasury, merchant) are rendered; the rest stay reachable via
 * `?situation=<id>` (the page passes them through `extraMomentIds`),
 * keeping the landing focused on the wedge while the long tail of
 * moments (escrow, compliance, operator) remains shareable.
 *
 * Keyboard: 1–N selects a moment from the rendered list. On home
 * (`sync`), selection updates the demo.
 */
export function SituationCast({
  chainId,
  activeId,
  extraMomentIds,
  mode = "link",
  onSelect,
}: {
  /** Omit so moment links open the chain-agnostic gate. */
  chainId?: string;
  activeId?: string;
  /** Extra moments to append to the default render (e.g. from `?situation=`). */
  extraMomentIds?: string[];
  mode?: "link" | "sync";
  onSelect?: (situation: Situation) => void;
}) {
  const groupId = useId();

  // Default render = treasury + merchant. Anything passed via `extraMomentIds`
  // is appended (deduped) so a deep-linked `?situation=escrow` still resolves.
  const rendered = useMemo<readonly Situation[]>(() => {
    const seen = new Set<string>();
    const out: Situation[] = [];
    for (const id of DEFAULT_SITUATION_IDS) {
      const s = getSituation(id);
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
    if (extraMomentIds) {
      for (const id of extraMomentIds) {
        if (seen.has(id)) continue;
        const s = getSituation(id);
        if (s) {
          seen.add(s.id);
          out.push(s);
        }
      }
    }
    return out;
  }, [extraMomentIds]);

  const initial =
    activeId && rendered.some((s) => s.id === activeId)
      ? activeId
      : rendered[0]!.id;
  const [openId, setOpenId] = useState(initial);

  function select(s: Situation) {
    setOpenId(s.id);
    onSelect?.(s);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= rendered.length) {
        e.preventDefault();
        const s = rendered[n - 1]!;
        setOpenId(s.id);
        onSelect?.(s);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, rendered]);

  const allDefault = rendered.every((s) =>
    DEFAULT_SITUATION_IDS.includes(
      s.id as (typeof DEFAULT_SITUATION_IDS)[number],
    ),
  );

  return (
    <section id="situations" className="scroll-mt-24" aria-labelledby={groupId}>
      <header className="flex items-baseline justify-between gap-4">
        <p id={groupId} className="eyebrow">
          Your moment
        </p>
        <p className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet sm:block">
          {mode === "sync" ? "1–5 · demo updates" : "1–5 · then gate"}
        </p>
      </header>
      <Rule className="mt-4" />

      {!allDefault ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
          Deep-linked moment ·{" "}
          <Link
            href={chainId ? `/?chain=${chainId}` : "/"}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            ← back to defaults
          </Link>
        </p>
      ) : null}

      <ul className="mt-2" role="list">
        {rendered.map((s, i) => {
          const open = openId === s.id;
          const gateHref = `/gate?${chainId ? `chain=${chainId}&` : ""}situation=${s.id}&capability=${s.capability}`;

          return (
            <li
              key={s.id}
              className={`border-t border-rule first:border-t-0 ${
                open
                  ? "border-l-2 border-l-terra"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`moment-${s.id}`}
                onClick={() => select(s)}
                className="flex w-full items-baseline gap-3 py-4 pl-3 text-left transition-colors sm:gap-5 sm:py-5 sm:pl-4"
              >
                <span
                  className={`shrink-0 font-mono text-xs tabular transition-colors ${
                    open ? "text-terra" : "text-ink-quiet"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                      open ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {s.role}
                  </span>
                  <span
                    className={`mt-1 block font-serif text-sm leading-snug transition-colors sm:text-base ${
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
                className="moment-panel"
                data-open={open ? "true" : "false"}
              >
                <div>
                  <div className="border-t border-rule-soft pb-5 pl-8 sm:pl-12">
                    {open ? (
                      <MomentBody
                        situation={s}
                        gateHref={gateHref}
                        mode={mode}
                      />
                    ) : (
                      <div className="h-0" aria-hidden />
                    )}
                  </div>
                </div>
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
  const [lens, setLens] = useState<"blind" | "gated">("gated");
  const gated = lens === "gated";

  return (
    <div className="animate-fade-in pt-4">
      <p className="max-w-xl font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
        <span className="text-ink-quiet">Moment · </span>
        {s.moment}
      </p>

      <div
        className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2"
        role="tablist"
        aria-label="Blind or gated"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!gated}
          onClick={() => setLens("blind")}
          className={`py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
            !gated
              ? "text-revoke underline decoration-revoke decoration-1 underline-offset-4"
              : "text-ink-quiet hover:text-ink"
          }`}
        >
          Blind
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={gated}
          onClick={() => setLens("gated")}
          className={`py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
            gated
              ? "text-sage underline decoration-sage decoration-1 underline-offset-4"
              : "text-ink-quiet hover:text-ink"
          }`}
        >
          Gated
        </button>
      </div>

      <div
        key={lens}
        className={`animate-fade-in mt-4 border-l-2 pl-4 ${
          gated ? "border-sage" : "border-revoke"
        }`}
        role="tabpanel"
        aria-live="polite"
      >
        <p
          className={`display text-2xl sm:text-3xl ${
            gated ? "text-sage" : "text-revoke"
          }`}
        >
          <VerdictMark ok={gated} /> {gated ? "GO" : "STOP"}
        </p>
        <p className="mt-2 max-w-lg font-serif text-sm leading-relaxed text-ink sm:text-base">
          {gated ? s.withLigis : s.without}
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
              Run the read →
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
