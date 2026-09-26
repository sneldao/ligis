import {
  PAYMENTS,
  formatUsd,
  shortAddress,
  type JudgeOutcome,
  type JudgeResponse,
  type PaymentId,
} from "@/lib/arena/scenario";

function JudgeRow({ name, outcome }: { name: string; outcome: JudgeOutcome }) {
  if (outcome.status === "skipped") {
    return (
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
        <span className="text-fog-quiet">{name}</span>
        <span className="truncate text-fog-quiet" title={outcome.reason}>
          {/_KEY not set$/.test(outcome.reason) ? "not configured" : "offline"}
        </span>
      </div>
    );
  }
  const tone = outcome.verdict === "STOP" ? "text-stop" : "text-go";
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
      <span className="text-fog-quiet">{name}</span>
      <span className="tabular text-fog">
        <span className={tone}>{outcome.verdict}</span> ·{" "}
        {outcome.confidence.toFixed(2)} · {outcome.latencyMs}ms
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

export function VerdictCard({
  paymentId,
  result,
}: {
  paymentId: PaymentId;
  result: JudgeResponse | "pending";
}) {
  const p = PAYMENTS[paymentId];
  const pending = result === "pending";
  const final = pending ? null : result.final;
  const stop = final === "STOP";

  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border bg-night/70 p-4 sm:p-5 ${
        stop
          ? "stop-flash border-stop/50"
          : final === "GO"
            ? "border-go/40"
            : "border-night-rule"
      }`}
      aria-live="polite"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="tabular font-sans text-2xl font-medium text-fog">
            {formatUsd(p.amountUsd)}
          </span>
          <span className="font-mono text-[11px] text-fog-quiet">
            to {p.payToLabel} · {shortAddress(p.payTo)}
          </span>
        </div>
        {pending ? (
          <span className="flex items-center gap-2 rounded-full border border-signal/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
            <span
              className="size-1.5 animate-pulse rounded-full bg-signal"
              aria-hidden
            />
            Judging
          </span>
        ) : (
          <span
            className={`rounded-full px-3.5 py-1 font-mono text-sm font-medium tracking-[0.12em] ${
              stop
                ? "bg-stop text-night"
                : final === "GO"
                  ? "bg-go text-night"
                  : "border border-night-rule text-fog-quiet"
            }`}
          >
            {final === "UNKNOWN" ? "NO VERDICT" : final}
          </span>
        )}
      </header>

      {pending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="h-2 w-3/4 animate-pulse rounded bg-night-rule" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-night-rule" />
        </div>
      ) : (
        <>
          {stop && plainReasons(result).length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {plainReasons(result).map((reason) => (
                <li
                  key={reason}
                  className="flex gap-2 text-sm leading-relaxed text-fog"
                >
                  <span
                    className="mt-2 size-1 shrink-0 rounded-full bg-stop"
                    aria-hidden
                  />
                  <span className="text-pretty first-letter:uppercase">
                    {reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : final === "GO" ? (
            <p className="text-sm leading-relaxed text-fog">
              Matches the contract: right payee, right amount, in scope.
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
