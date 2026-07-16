"use client";

import { useRevealOnView } from "./RevealOnView";

type Panel = {
  roman: string;
  eyebrow: string;
  title: string;
  gloss: string;
  mono: string;
  delayMs: number;
  titleFill: string;
  markFill: string;
  markStroke: number;
};

/**
 * StewardTriptych — the three-act narrative that frames the loop.
 *
 * Maps the 5-phase loop (BOOT → REASON → GATE → ACT → RECORD) into three
 * editorial states, mirroring the hand-typeset idiom of {@link Diagram}
 * (hairlines, Fraunces titles, italic Fraunces glosses, JetBrains Mono
 * detail). Each `<g>` panel reveals on viewport entry via
 * {@link useRevealOnView}, so the cascade only fires when a panel is
 * actually in (or entering) view — no wasted off-screen motion.
 *
 *   I  — genesis    · BOOT
 *   II — synthesis  · REASON · GATE · ACT
 *   III — stasis    · RECORD
 *
 * Stagger opt-in is hoisted to globals.css as `.animate-triptych-reveal`
 * triggered via `data-revealed="true"` (set by useRevealOnView's
 * IntersectionObserver) with per-panel delay via inline CSS variable
 * `--triptych-delay`. The animation runs:
 *
 *   t=0  → data-revealed flips true on the panel whose SVG <g>
 *          entered the viewport first; CSS runs the keyframe over
 *          540ms. Per-panel delay staggered via --triptych-delay.
 *
 * Server-rendered SVG markup with hydrated observer wiring (this is
 * a "use client" component so the hook can attach to refs).
 * prefers-reduced-motion is honoured — see the override in
 * `web/app/globals.css`.
 *
 * Live users of the reveal pattern, in cascade order:
 *   1. this triptych on `/steward`              (genesis · synthesis · stasis)
 *   2. `/capabilities` category sections        (IDENTITY · FINANCE · COMMERCE)
 *   3. `/embed` numbered sections                (01 · URL / 02 · iframe / 03 · Preview)
 */
export function StewardTriptych({
  isCasper = false,
  className = "",
}: {
  isCasper?: boolean;
  className?: string;
}) {
  const mintName = isCasper ? "mint_self" : "mintSelf";
  const anchorName = isCasper ? "set_token_uri" : "setTokenURI";

  // Three panels with fixed delays. Rule of hooks requires we call
  // useRevealOnView the same number of times in the same order on
  // every render — so we open three named refs and key them by index
  // inside the JSX map below.
  const revealI = useRevealOnView<SVGGElement>({ delayMs: 0 });
  const revealII = useRevealOnView<SVGGElement>({ delayMs: 120 });
  const revealIII = useRevealOnView<SVGGElement>({ delayMs: 280 });
  const panelRefs = [revealI.ref, revealII.ref, revealIII.ref];

  const PANELS: readonly Panel[] = [
    {
      roman: "I",
      eyebrow: "BOOT",
      title: "i arrive",
      gloss: "no identity · no proof",
      mono: `${mintName} · walletOfAgent`,
      delayMs: 0,
      titleFill: "#1c1b1a",
      markFill: "#1c1b1a",
      markStroke: 0.5,
    },
    {
      roman: "II",
      eyebrow: "REASON · GATE · ACT",
      title: "i become",
      gloss: "what i need · earned",
      mono: "compute · capabilities",
      delayMs: 120,
      titleFill: "#B85D3E",
      markFill: "#B85D3E",
      markStroke: 0.6,
    },
    {
      roman: "III",
      eyebrow: "RECORD",
      title: "i remain",
      gloss: "anchored · immutable",
      mono: `0G Storage · ${anchorName}`,
      delayMs: 280,
      titleFill: "#6f8267",
      markFill: "#6f8267",
      markStroke: 0.75,
    },
  ];

  const W = 840;
  const H = 280;
  const panelW = 280;
  const top = 80;
  const bottom = 240;

  return (
    <div className="w-full">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="eyebrow">three acts</p>
        <p className="font-mono text-[11px] tabular text-ink-quiet">—</p>
      </header>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full h-auto ${className}`}
        role="img"
        aria-label="The Steward in three acts: i arrive (genesis), i become (synthesis), i remain (stasis)."
      >
        {/* Triptych frame: unified top + bottom hairlines, two inner
            dividers. Hairline stroke weights match Diagram.tsx. */}
        <line
          x1={0}
          y1={top}
          x2={W}
          y2={top}
          stroke="#1c1b1a"
          strokeWidth="0.5"
        />
        <line
          x1={0}
          y1={bottom}
          x2={W}
          y2={bottom}
          stroke="#1c1b1a"
          strokeWidth="0.5"
        />
        <line
          x1={panelW}
          y1={top}
          x2={panelW}
          y2={bottom}
          stroke="#1c1b1a"
          strokeWidth="0.5"
        />
        <line
          x1={panelW * 2}
          y1={top}
          x2={panelW * 2}
          y2={bottom}
          stroke="#1c1b1a"
          strokeWidth="0.5"
        />

        {PANELS.map((p, i) => {
          const cx = panelW * i + panelW / 2;
          return (
            <g
              key={p.roman}
              ref={panelRefs[i]}
              className="animate-triptych-reveal"
              style={{ ["--triptych-delay" as string]: `${p.delayMs}ms` }}
              data-revealed="false"
            >
              {/* eyebrow — Roman numeral + phase name, mono tracked,
                  one shade lighter than ink so the title remains primary */}
              <text
                x={cx}
                y={top - 30}
                fontFamily="JetBrains Mono, monospace"
                fontSize="10"
                letterSpacing="0.18em"
                textAnchor="middle"
                fill="#6f6a62"
              >
                {p.roman} · {p.eyebrow}
              </text>

              {/* mark — a single editorial SVG primitive per panel,
                  coloured by the panel's one dominant tone */}
              {i === 0 ? (
                <g>
                  {/* genesis: crosshair with an empty centre. The agent
                      occupies the dot but is not yet drawn. */}
                  <line
                    x1={cx - 18}
                    y1={top + 36}
                    x2={cx + 18}
                    y2={top + 36}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <line
                    x1={cx}
                    y1={top + 18}
                    x2={cx}
                    y2={top + 54}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <circle
                    cx={cx}
                    cy={top + 36}
                    r={2.5}
                    fill="none"
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                </g>
              ) : null}
              {i === 1 ? (
                <g>
                  {/* synthesis: three convergent hairlines meeting at a
                      central dot, then a single thicker trunk descending.
                      Three streams become one outcome. */}
                  <line
                    x1={cx - 30}
                    y1={top + 18}
                    x2={cx - 3}
                    y2={top + 36}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <line
                    x1={cx}
                    y1={top + 18}
                    x2={cx}
                    y2={top + 36}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <line
                    x1={cx + 30}
                    y1={top + 18}
                    x2={cx + 3}
                    y2={top + 36}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <circle
                    cx={cx}
                    cy={top + 36}
                    r={1.6}
                    fill={p.markFill}
                  />
                  <line
                    x1={cx}
                    y1={top + 37.5}
                    x2={cx}
                    y2={top + 54}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke + 0.25}
                  />
                </g>
              ) : null}
              {i === 2 ? (
                <g>
                  {/* stasis: a long settled baseline with a centred,
                      filled dot at its midpoint. Reads as "the period
                      at the end of the sentence" / a footnote that can
                      never be edited. Avoids the diamond / seal reading
                      the previous outline had at this adjacency to a
                      wallet chip. */}
                  <line
                    x1={cx - 28}
                    y1={top + 36}
                    x2={cx + 28}
                    y2={top + 36}
                    stroke={p.markFill}
                    strokeWidth={p.markStroke}
                  />
                  <circle
                    cx={cx}
                    cy={top + 36}
                    r={2.2}
                    fill={p.markFill}
                  />
                </g>
              ) : null}

              {/* title — Fraunces, the panel's one dominant tone. */}
              <text
                x={cx}
                y={top + 92}
                fontFamily="Fraunces, serif"
                fontSize="26"
                textAnchor="middle"
                fill={p.titleFill}
              >
                {p.title}
              </text>

              {/* gloss — Fraunces italic, ink-soft. Single short clause. */}
              <text
                x={cx}
                y={top + 116}
                fontFamily="Fraunces, serif"
                fontSize="13"
                fontStyle="italic"
                textAnchor="middle"
                fill="#5c5852"
              >
                {p.gloss}
              </text>

              {/* mono detail — JetBrains Mono. Below the gloss, just above
                  the bottom hairline of the frame. */}
              <text
                x={cx}
                y={bottom - 18}
                fontFamily="JetBrains Mono, monospace"
                fontSize="11"
                textAnchor="middle"
                fill="#1c1b1a"
              >
                {p.mono}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
