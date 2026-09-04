import { Rule } from "@/components/Rule";
import { signalCostUsd, type TrustSignal } from "@ligis/core";

/**
 * SignalStack — the trust signal ledger.
 *
 * The provider-agnostic record behind a trust decision: risk, capability,
 * identity, and policy signals as Rule-delimited ledger rows. Presentational
 * only; server-renderable. The verdict vocabulary is the product's one verb —
 * ✓ GO / ✗ STOP — carried by tone, never by chrome.
 */
export function SignalStack({ signals }: { signals: TrustSignal[] }) {
  if (signals.length === 0) {
    return (
      <p className="font-serif text-sm italic leading-relaxed text-ink-quiet">
        No signals recorded.
      </p>
    );
  }

  return (
    <div>
      <Rule />
      {signals.map((signal, i) => {
        const target =
          signal.kind === "capability" &&
          typeof signal.metadata?.capability === "string"
            ? (signal.metadata.capability as string)
            : signal.source;
        const costUsd = signalCostUsd(signal);
        return (
          <div key={`${signal.kind}:${target}:${i}`}>
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 gap-y-1 py-5">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="font-mono text-sm tabular text-ink">
                    {target}
                  </span>
                  <span className="font-serif text-sm italic text-ink-soft">
                    {signal.kind}
                  </span>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
                  {signal.source}
                </span>
              </div>
              <div className="space-y-1.5 text-right">
                {signal.verdict === "go" ? (
                  <span className="font-mono text-sm tabular text-sage">✓ GO</span>
                ) : signal.verdict === "stop" ? (
                  <span className="font-mono text-sm tabular text-revoke">
                    ✗ STOP
                  </span>
                ) : (
                  <span className="font-mono text-sm tabular text-ink-quiet">
                    ? UNKNOWN
                  </span>
                )}
                <div className="font-mono text-[11px] tabular text-ink-quiet">
                  confidence {signal.confidence}
                  {costUsd !== undefined ? ` · $${costUsd}/check` : ""}
                </div>
              </div>
            </div>
            <Rule tone="soft" />
          </div>
        );
      })}
    </div>
  );
}
