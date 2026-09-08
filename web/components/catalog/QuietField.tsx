/** Static specimen texture — landing invite and reduced-motion field fallback. */

export function QuietField() {
  const marks = Array.from({ length: 48 }, (_, index) => ({
    x: 4 + ((index * 37) % 92),
    y: 6 + ((index * 23) % 88),
    r: index % 7 === 0 ? 1.5 : 0.8,
    opacity: 0.12 + (index % 4) * 0.05,
  }));

  return (
    <svg
      aria-hidden
      className="h-full w-full text-ink"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <line
        x1="0"
        y1="18"
        x2="100"
        y2="18"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="0.2"
      />
      <line
        x1="0"
        y1="82"
        x2="100"
        y2="82"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="0.2"
      />
      {marks.map((mark, index) => (
        <circle
          key={index}
          cx={mark.x}
          cy={mark.y}
          r={mark.r}
          fill="currentColor"
          fillOpacity={mark.opacity}
        />
      ))}
    </svg>
  );
}
