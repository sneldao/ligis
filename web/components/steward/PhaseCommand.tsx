export function PhaseCommand({
  index,
  label,
  command,
  note,
}: {
  index: number;
  label: string;
  command: string;
  note: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs tabular text-ink-quiet">
          {String(index).padStart(2, "0")}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
          {label}
        </span>
      </div>
      <pre className="overflow-x-auto bg-paper-deep px-4 py-3 font-mono text-[12px] leading-relaxed tabular text-ink">
        {command}
      </pre>
      <p className="font-serif text-xs italic leading-relaxed text-ink-quiet">
        {note}
      </p>
    </div>
  );
}
