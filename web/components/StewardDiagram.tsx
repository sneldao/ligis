"use client";

import { type Phase } from "@/lib/steward-events";

type PhaseStatus = "idle" | "running" | "done" | "skip" | "error";

function nodeColor(status: PhaseStatus): string {
  switch (status) {
    case "running":
      return "#B85D3E";
    case "done":
      return "#6f8267";
    case "error":
      return "#a13a2a";
    default:
      return "#d9d3cb";
  }
}

function nodeFill(status: PhaseStatus): string {
  return status === "running" || status === "done" ? nodeColor(status) : "none";
}

const LABELS = ["boot", "reason", "gate", "act", "record"];

export function StewardDiagram({
  phaseStatus,
}: {
  phaseStatus: Record<string, PhaseStatus>;
  running: boolean;
}) {
  const width = 280;
  const height = 56;
  const nodeY = 22;
  const nodeR = 7;
  const labelY = nodeY + nodeR + 12;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto h-14 w-auto"
        aria-label="Steward loop flow: boot, reason, gate, act, record"
      >
        {LABELS.map((_, i) => {
          const cx = (width / LABELS.length) * (i + 0.5);
          const nextCx =
            i < LABELS.length - 1
              ? (width / LABELS.length) * (i + 1.5)
              : cx + nodeR + 2;
          if (i >= LABELS.length - 1) return null;
          const phase = LABELS[i].toUpperCase() as keyof typeof phaseStatus;
          const nextPhase = LABELS[i + 1].toUpperCase() as keyof typeof phaseStatus;
          const cur = phaseStatus[phase] || "idle";
          const next = phaseStatus[nextPhase] || "idle";
          const highlighted = cur === "done" || cur === "running" || next === "done" || next === "running";
          return (
            <line
              key={`line-${i}`}
              x1={cx + nodeR + 2}
              y1={nodeY}
              x2={nextCx - nodeR - 2}
              y2={nodeY}
              stroke={highlighted ? nodeColor(cur === "idle" ? next : cur) : "#d9d3cb"}
              strokeWidth={highlighted ? 1 : 0.5}
              strokeDasharray={highlighted ? "none" : "2 3"}
              style={{ transition: "stroke 0.5s ease" }}
            />
          );
        })}

        {LABELS.map((label, i) => {
          const phase = label.toUpperCase() as keyof typeof phaseStatus;
          const status = (phaseStatus[phase] || "idle") as PhaseStatus;
          const cx = (width / LABELS.length) * (i + 0.5);
          const color = nodeColor(status);
          const fill = nodeFill(status);
          const isRunning = status === "running";

          return (
            <g key={label}>
              <circle
                cx={cx}
                cy={nodeY}
                r={nodeR}
                fill={fill}
                stroke={color}
                strokeWidth={isRunning || status === "done" || status === "error" ? 1.5 : 1}
                style={{ transition: "fill 0.4s ease, stroke 0.4s ease" }}
              />
              {isRunning ? (
                <circle
                  cx={cx}
                  cy={nodeY}
                  r={nodeR + 3}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.5}
                  opacity={0.35}
                  style={{ animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite" }}
                />
              ) : null}
              <text
                x={cx}
                y={nodeY + 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fill={isRunning || status === "done" ? "#f4f1ec" : "#8a857d"}
                fontSize="7"
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
                fill={status === "idle" ? "#8a857d" : "#1c1b1a"}
                fontSize="6.5"
                fontFamily="Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
                style={{
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  transition: "fill 0.4s ease",
                }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
