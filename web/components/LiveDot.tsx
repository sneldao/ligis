/** Tiny living pulse for “registry is reachable” chrome. Prefer this over hand-rolled dots. */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span
      className={`live-dot${className ? ` ${className}` : ""}`}
      aria-hidden
    />
  );
}
