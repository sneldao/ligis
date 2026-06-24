"use client";

import { type Phase } from "@/lib/steward-events";

type PhaseStatus = "idle" | "running" | "done" | "error";

const NODES: { phase: Phase; label: string; desc: string }[] = [
  { phase: "BOOT", label: "boot", desc: "mint agent ID" },
  { phase: "REASON", label: "reason", desc: "0G Compute" },
  { phase: "GATE", label: "gate", desc: "check creds" },
  { phase: "ACT", label: "act", desc: "self-issue" },
  { phase: "RECORD", label: "record", desc: "anchor to 0G" },
];

export function StewardDiagram({
  phaseStatus,
  running,
}: {
  phaseStatus: Record<string, PhaseStatus>;
  running: boolean;
}) {
  const width = 640;
  const height = 180;
  const nodeY = 36;
  const nodeR = 14;
  const labelY = nodeY + nodeR + 18;
  const descY = labelY + 14;
  const barY = 152;
  const barH = 2;
  const spacing = width / NODES.length;

  const color = (phase: string): string => {
    const s = phaseStatus[phase];
    if (s === "running") return "#B85D3E";
    if (s === "done") return "#6f8267";
    if (s === "error") return "#a13a2a";
    return "#d9d3cb";
  };

  const isActive = (phase: string): boolean => phaseStatus[phase] === "running";
  const isDone = (phase: string): boolean => phaseStatus[phase] === "done";
  const isIdle = (phase: string): boolean =>
    !phaseStatus[phase] || phaseStatus[phase] === "idle";

  const showStreamAnimation =
    running || Object.values(phaseStatus).some((s) => s === "done" || s === "running");

  const doneCount = NODES.filter((n) => isDone(n.phase)).length;
  const runningCount = NODES.filter((n) => isActive(n.phase)).length;
  const progress = (doneCount + (runningCount > 0 ? 0.5 : 0)) / NODES.length;
  const currentPhaseIdx = NODES.findIndex((n) => isActive(n.phase));
  const allDone = doneCount === NODES.length;

  return (
    <div className="w-full">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="eyebrow">the loop</p>
        <p className="font-mono text-[11px] tabular text-ink-quiet">
          {allDone ? "✓ complete" : currentPhaseIdx >= 0 ? `phase ${currentPhaseIdx + 1} / ${NODES.length}` : "—"}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        aria-label="Steward loop flow: boot, reason, gate, act, record"
      >
        <defs>
          {NODES.map((n, i) => {
            if (i >= NODES.length - 1) return null;
            const cx = (width / NODES.length) * (i + 0.5);
            const nx = (width / NODES.length) * (i + 1.5);
            return (
              <linearGradient
                key={`g-${i}`}
                id={`flow-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop
                  offset="0%"
                  stopColor={isDone(n.phase) || isActive(n.phase) ? color(n.phase) : "#d9d3cb"}
                />
                <stop
                  offset="100%"
                  stopColor={
                    isDone(NODES[i + 1].phase) || isActive(NODES[i + 1].phase)
                      ? color(NODES[i + 1].phase)
                      : "#d9d3cb"
                  }
                />
              </linearGradient>
            );
          })}

          {showStreamAnimation && (
            <style>
              {`
                @keyframes stream-dash {{
                  to { stroke-dashoffset: -24; }
                }}
                @keyframes node-ping {{
                  0% {{ transform: scale(1); opacity: 0.4; }}
                  100% {{ transform: scale(2.4); opacity: 0; }}
                }}
                @media (prefers-reduced-motion: reduce) {{
                  [data-anim="stream"] {{ animation: none !important; }}
                  [data-anim="ping"] {{ animation: none !important; }}
                }}
              `}
            </style>
          )}
        </defs>

        {NODES.map((n, i) => {
          if (i >= NODES.length - 1) return null;
          const cx = spacing * (i + 0.5);
          const nx = spacing * (i + 1.5);
          const cur = phaseStatus[n.phase] || "idle";
          const next = phaseStatus[NODES[i + 1].phase] || "idle";
          const flowing = cur === "running" || cur === "done" || next === "running" || next === "done";
          return (
            <g key={`l-${i}`}>
              <line
                x1={cx + nodeR + 3}
                y1={nodeY}
                x2={nx - nodeR - 3}
                y2={nodeY}
                stroke={flowing ? `url(#flow-${i})` : "#d9d3cb"}
                strokeWidth={flowing ? 1.5 : 1}
                strokeLinecap="round"
                style={{ transition: "stroke 0.5s ease" }}
              />
              {flowing ? (
                <line
                  x1={cx + nodeR + 3}
                  y1={nodeY}
                  x2={nx - nodeR - 3}
                  y2={nodeY}
                  stroke={color(n.phase)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray="4 8"
                  style={{
                    animation: "stream-dash 0.8s linear infinite",
                    opacity: 0.5,
                  }}
                  data-anim="stream"
                />
              ) : null}
            </g>
          );
        })}

        {NODES.map((n, i) => {
          const cx = spacing * (i + 0.5);
          const c = color(n.phase);
          const active = isActive(n.phase);
          const done = isDone(n.phase);

          return (
            <g key={n.phase}>
              {active ? (
                <>
                  <circle
                    cx={cx}
                    cy={nodeY}
                    r={nodeR + 6}
                    fill="none"
                    stroke={c}
                    strokeWidth={1}
                    opacity={0.3}
                    style={{
                      animation: "node-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                    data-anim="ping"
                  />
                  <circle
                    cx={cx}
                    cy={nodeY}
                    r={nodeR + 4}
                    fill="none"
                    stroke={c}
                    strokeWidth={1}
                    opacity={0.5}
                    style={{
                      animation: "node-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
                      animationDelay: "0.4s",
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                    data-anim="ping"
                  />
                </>
              ) : null}
              <circle
                cx={cx}
                cy={nodeY}
                r={nodeR}
                fill={done || active ? c : "none"}
                stroke={c}
                strokeWidth={isIdle(n.phase) ? 1.5 : 2}
                style={{ transition: "fill 0.4s ease, stroke 0.4s ease" }}
              />
              <text
                x={cx}
                y={nodeY + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={done || active ? "#f4f1ec" : "#6f6a62"}
                fontSize="11"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  transition: "fill 0.4s ease",
                }}
              >
                {i + 1}
              </text>
              <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                fill={isIdle(n.phase) ? "#6f6a62" : "#1c1b1a"}
                fontSize="10"
                fontFamily="Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
                fontWeight="500"
                style={{
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  transition: "fill 0.4s ease",
                }}
              >
                {n.label}
              </text>
              <text
                x={cx}
                y={descY}
                textAnchor="middle"
                fill="#6f6a62"
                fontSize="8.5"
                fontFamily="Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
                style={{
                  transition: "fill 0.4s ease",
                }}
              >
                {n.desc}
              </text>
            </g>
          );
        })}

        {/* Progress bar */}
        <rect
          x={0}
          y={barY}
          width={width}
          height={barH}
          fill="#e7e2d9"
          rx={1}
        />
        <rect
          x={0}
          y={barY}
          width={width * progress}
          height={barH}
          fill={allDone ? "#6f8267" : "#B85D3E"}
          rx={1}
          style={{
            transition: "width 0.6s cubic-bezier(0.215, 0.61, 0.355, 1), fill 0.4s ease",
          }}
        />
      </svg>
    </div>
  );
}
