import { PHASES } from "@/lib/steward-events";
import type { PhaseStatus } from "./state";
import { Rule } from "../Rule";

export function PhaseRow({
  index,
  phase,
  status,
  children,
}: {
  index: number;
  phase: (typeof PHASES)[number];
  status: PhaseStatus;
  children: React.ReactNode;
}) {
  const dotColor =
    status === "running"
      ? "bg-terra animate-pulse"
      : status === "done"
        ? "bg-sage"
        : status === "error"
          ? "bg-revoke"
          : "bg-rule";
  const indexColor = status === "idle" ? "text-ink-quiet" : "text-ink";

  const statusKey = `${index}-${status}`;

  return (
    <div className="grid grid-cols-[3rem_1fr] items-start gap-x-6">
      <div className="flex flex-col items-center gap-3 pt-[6px]">
        <span
          className={`block h-1.5 w-1.5 rounded-full ${dotColor}`}
          aria-hidden
        />
      </div>
      <div className="space-y-3" key={statusKey}>
        <header className="flex items-baseline justify-between">
          <p
            className={`text-[11px] uppercase tracking-[0.16em] ${indexColor}`}
          >
            {String(index).padStart(2, "0")} · {phase.label}
          </p>
          <span className="font-mono text-xs tabular text-ink-quiet">
            {status === "idle" ? "—" : status}
          </span>
        </header>
        <Rule />
        <p
          className={`font-serif text-sm italic transition-colors duration-500 ${status === "running" ? "text-terra" : status === "done" ? "text-sage" : "text-ink-quiet"}`}
        >
          {phase.gloss}.
        </p>
        {status !== "idle" ? (
          <div className="animate-fadeInUp">{children}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
