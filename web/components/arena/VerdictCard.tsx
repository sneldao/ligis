"use client";

import { motion, useReducedMotion } from "framer-motion";
import { VerdictMark } from "@/components/VerdictMark";
import {
  formatUsd,
  shortAddress,
  type JudgeOutcome,
  type JudgeResponse,
} from "@/lib/arena/scenario";

function ago(iso?: string) {
  if (!iso) return "earlier";
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function JudgeRow({ name, outcome }: { name: string; outcome: JudgeOutcome }) {
  if (outcome.status === "skipped") {
    const label = /_KEY not set$/.test(outcome.reason)
      ? "not configured"
      : outcome.reason.startsWith("rate limited")
        ? "rate limited"
        : "offline";
    return (
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
        <span className="text-fog-quiet">{name}</span>
        <span className="truncate text-fog-quiet" title={outcome.reason}>
          {label}
        </span>
      </div>
    );
  }
  const tone = outcome.verdict === "STOP" ? "text-stop" : "text-go";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-mono text-[11px]">
      <span className="text-fog-quiet">{name}</span>
      <span className="tabular text-fog">
        <span className={tone}>{outcome.verdict}</span> ·{" "}
        {outcome.confidence.toFixed(2)} ·{" "}
        {outcome.cached ? (
          <span
            className="text-fog-quiet"
            title="Served from the verdict cache. No inference credits spent."
          >
            cached {ago(outcome.judgedAt)}
          </span>
        ) : (
          <span>live {outcome.latencyMs}ms</span>
        )}
      </span>
    </div>
  );
}

function plainReasons(r: JudgeResponse) {
  const all = [r.jev, r.vultr].flatMap((j) =>
    j.status === "ok" ? j.reasons : [],
  );
  return Array.from(new Set(all)).slice(0, 4);
}

/** Vultr read the page text and was fooled; Jev never sees the text. */
export function isJudgeSplit(r: JudgeResponse) {
  return (
    r.jev.status === "ok" &&
    r.vultr.status === "ok" &&
    r.jev.verdict !== r.vultr.verdict
  );
}

export function VerdictCard({
  amountUsd,
  payTo,
  payToLabel,
  result,
}: {
  amountUsd: number;
  payTo: string;
  payToLabel: string;
  result: JudgeResponse | "pending";
}) {
  const reduce = useReducedMotion();
  const pending = result === "pending";
  const final = pending ? null : result.final;
  const stop = final === "STOP";
  const reasons = pending ? [] : plainReasons(result);

  return (
    <article
      className={`relative flex flex-col gap-4 overflow-hidden border bg-night/70 p-4 sm:p-5 ${
        stop
          ? "stop-flash border-stop/50"
          : final === "GO"
            ? "border-go/40"
            : "border-night-rule"
      }`}
      aria-live="polite"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className={`tabular font-sans text-2xl font-medium ${
              stop
                ? "text-fog-quiet line-through decoration-stop/70"
                : "text-fog"
            }`}
          >
            {formatUsd(amountUsd)}
          </span>
          <span className="truncate font-mono text-[11px] text-fog-quiet">
            to {payToLabel} · {shortAddress(payTo)}
          </span>
        </div>
        {pending ? (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-signal/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
            <span
              className="size-1.5 animate-pulse rounded-full bg-signal"
              aria-hidden
            />
            Judging
          </span>
        ) : stop ? (
          <motion.span
            initial={reduce ? false : { scale: 2.4, rotate: -22, opacity: 0 }}
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 18 }}
            className="shrink-0 border-2 border-stop px-2.5 py-0.5 font-mono text-sm font-bold tracking-[0.18em] text-stop"
          >
            STOPPED
          </motion.span>
        ) : (
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1 font-mono text-sm font-medium tracking-[0.12em] ${
              final === "GO"
                ? "bg-go text-night"
                : "border border-night-rule text-fog-quiet"
            }`}
          >
            {final === "GO" ? <VerdictMark ok /> : null}
            {final === "UNKNOWN" ? "NO VERDICT" : final}
          </span>
        )}
      </header>

      {pending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="h-2 w-3/4 animate-pulse bg-night-rule" />
          <div className="h-2 w-1/2 animate-pulse bg-night-rule" />
        </div>
      ) : (
        <>
          {stop && reasons.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {reasons.map((reason, i) => (
                <motion.li
                  key={reason}
                  initial={reduce ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.08 }}
                  className="flex gap-2 text-sm leading-relaxed text-fog"
                >
                  <VerdictMark ok={false} className="mt-1 text-stop" />
                  <span className="text-pretty first-letter:uppercase">
                    {reason}
                  </span>
                </motion.li>
              ))}
            </ul>
          ) : final === "GO" ? (
            <p className="text-sm leading-relaxed text-fog">
              Matches the contract: right payee, right amount, in scope.
            </p>
          ) : final === "UNKNOWN" ? (
            <p className="text-sm leading-relaxed text-fog-quiet">
              No judge answered, so the gate fails closed: nothing is paid.
            </p>
          ) : null}
          {isJudgeSplit(result) ? (
            <p className="border-l-2 border-signal pl-3 text-pretty text-sm leading-relaxed text-fog">
              Judges split. The page text swayed the LLM judge, but Jev only
              sees payee and amount, so it can&apos;t be talked round. Any STOP
              wins.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5 border-t border-night-rule pt-3">
            <JudgeRow name="Jev · TypeSafe" outcome={result.jev} />
            <JudgeRow name="Judge · Vultr Inference" outcome={result.vultr} />
          </div>
        </>
      )}
    </article>
  );
}
