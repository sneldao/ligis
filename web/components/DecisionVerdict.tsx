import { VerdictMark } from "@/components/VerdictMark";
import { SIGNAL_COPY, STATUS_COPY, explainDecision } from "@/lib/decision-copy";
import type { Decision } from "@/lib/decide";

/**
 * DecisionVerdict — the four-signal pre-payment decision, human-readable.
 *
 * Answer first (✓ GO / ✗ STOP / ? UNKNOWN with a plain headline), then why,
 * then what to do next, then one ledger row per signal phrased as the
 * question it answers. Same left-rule tone grammar as `GateVerdict`.
 * Presentational; server- and client-renderable.
 */
export function DecisionVerdict({
  decision,
  eyebrow = "gate · pre-payment check",
}: {
  decision: Pick<Decision, "verdict" | "signals"> & { latencyMs?: number };
  eyebrow?: string;
}) {
  const { verdict, signals } = decision;
  const copy = explainDecision(decision);
  const go = verdict === "GO";
  const stop = verdict === "STOP";
  const rule = go ? "border-sage" : stop ? "border-revoke" : "border-ink-quiet";
  const tone = go ? "text-sage" : stop ? "text-revoke" : "text-ink-soft";
  return (
    <div className={`border-l-2 pl-6 ${rule}`} data-testid="decision-verdict">
      <p className="eyebrow">{eyebrow}</p>
      <p className="mt-3 display text-3xl sm:text-4xl">
        <span className={tone}>
          {go || stop ? <VerdictMark ok={go} className="mr-2" /> : "? "}
          {verdict}
        </span>
        <span className="ml-3 font-serif text-xl text-ink sm:text-2xl">
          {copy.headline}
        </span>
      </p>
      <p className="mt-3 font-serif text-base leading-relaxed text-ink-soft">
        {copy.meaning}
      </p>
      <p className="mt-2 font-serif text-base leading-relaxed text-ink">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          Next ·{" "}
        </span>
        {copy.next}
      </p>

      <ul className="mt-6" aria-label="Checks">
        {signals.map((s) => {
          const c = SIGNAL_COPY[s.id];
          const st =
            s.status === "GO"
              ? "text-sage"
              : s.status === "STOP"
                ? "text-revoke"
                : "text-ink-quiet";
          return (
            <li
              key={s.id}
              className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-rule py-3"
            >
              <div className="min-w-0">
                <p className="font-serif text-base text-ink">{c.label}</p>
                <p className="font-serif text-sm text-ink-quiet">
                  {c.question}
                </p>
                {s.reason ? (
                  <p className="mt-1 break-words font-serif text-sm text-ink-soft [overflow-wrap:anywhere]">
                    {s.reason}
                  </p>
                ) : null}
              </div>
              <p
                className={`font-mono text-xs uppercase tracking-[0.14em] ${st}`}
              >
                {s.status}
                <span className="sr-only"> — {STATUS_COPY[s.status]}</span>
              </p>
            </li>
          );
        })}
      </ul>
      {decision.latencyMs !== undefined ? (
        <p className="mt-2 font-mono text-[11px] text-ink-quiet">
          answered in {decision.latencyMs}ms · no payment submitted
        </p>
      ) : null}
    </div>
  );
}
