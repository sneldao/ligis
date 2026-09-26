/**
 * Check / cross drawn as SVG. Fraunces and most mobile fallback stacks have no
 * ✓/✗ glyphs, which rendered as tofu boxes next to GO/STOP.
 */
export function VerdictMark({
  ok,
  className = "",
}: {
  ok: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      width="0.78em"
      height="0.78em"
      style={{ width: "0.78em", height: "0.78em", verticalAlign: "-0.06em" }}
      className={`inline-block shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ok ? (
        <path d="M2.5 8.5l3.5 3.5 7.5-8" />
      ) : (
        <path d="M3.5 3.5l9 9m0-9l-9 9" />
      )}
    </svg>
  );
}
