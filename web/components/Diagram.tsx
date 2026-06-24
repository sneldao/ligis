"use client";

export function Diagram({ className = "" }: { className?: string }) {
  const W = 920;
  const H = 360;
  const leftX = 110;
  const rightX = 540;
  const boxW = 270;
  const boxH = 180;
  const top = 80;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label="Two contracts compose. CredentialRegistry never depends on PharosAgentID."
    >
      <style>
        {`
          @keyframes diagram-flow {
            to { stroke-dashoffset: -20; }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-anim="diagram-flow"] {
              animation: none !important;
            }
          }
        `}
      </style>
      <line x1={leftX} y1={top} x2={leftX + boxW} y2={top} stroke="#1C1B1A" strokeWidth="0.5" />
      <line
        x1={leftX}
        y1={top + boxH}
        x2={leftX + boxW}
        y2={top + boxH}
        stroke="#1C1B1A"
        strokeWidth="0.5"
      />
      <line x1={rightX} y1={top} x2={rightX + boxW} y2={top} stroke="#1C1B1A" strokeWidth="0.5" />
      <line
        x1={rightX}
        y1={top + boxH}
        x2={rightX + boxW}
        y2={top + boxH}
        stroke="#1C1B1A"
        strokeWidth="0.5"
      />

      <text
        x={leftX}
        y={top - 28}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        letterSpacing="2"
        fill="#6f6a62"
      >
        01 · IDENTITY
      </text>
      <text
        x={leftX}
        y={top + 30}
        fontFamily="Fraunces, serif"
        fontSize="24"
        fill="#1C1B1A"
      >
        PharosAgentID
      </text>
      <text
        x={leftX}
        y={top + 60}
        fontFamily="Fraunces, serif"
        fontSize="13"
        fontStyle="italic"
        fill="#5C5852"
      >
        ERC-721, one per agent.
      </text>
      <text
        x={leftX}
        y={top + 100}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        fill="#1C1B1A"
      >
        mint · rotate · revoke
      </text>
      <text
        x={leftX}
        y={top + 122}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        fill="#1C1B1A"
      >
        walletOfAgent
      </text>

      <text
        x={rightX}
        y={top - 28}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        letterSpacing="2"
        fill="#6f6a62"
      >
        02 · CREDENTIALS
      </text>
      <text
        x={rightX}
        y={top + 30}
        fontFamily="Fraunces, serif"
        fontSize="24"
        fill="#1C1B1A"
      >
        CredentialRegistry
      </text>
      <text
        x={rightX}
        y={top + 60}
        fontFamily="Fraunces, serif"
        fontSize="13"
        fontStyle="italic"
        fill="#5C5852"
      >
        EIP-712, signed by issuers.
      </text>
      <text
        x={rightX}
        y={top + 100}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        fill="#1C1B1A"
      >
        issue · revoke
      </text>
      <text
        x={rightX}
        y={top + 122}
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        fill="#1C1B1A"
      >
        isCapable · latestCredential
      </text>

      <path
        d={`M ${leftX + boxW + 10} ${top + 100} Q ${(leftX + boxW + rightX) / 2} ${top + 70} ${rightX - 10} ${top + 100}`}
        stroke="#B85D3E"
        strokeWidth="0.75"
        fill="none"
      />
      <path
        d={`M ${leftX + boxW + 10} ${top + 100} Q ${(leftX + boxW + rightX) / 2} ${top + 70} ${rightX - 10} ${top + 100}`}
        stroke="#B85D3E"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 6"
        style={{
          animation: "diagram-flow 1.2s linear infinite",
          opacity: 0.5,
        }}
        data-anim="diagram-flow"
      />
      <text
        x={(leftX + boxW + rightX) / 2}
        y={top + 62}
        fontFamily="Fraunces, serif"
        fontSize="13"
        fontStyle="italic"
        fill="#B85D3E"
        textAnchor="middle"
      >
        composes
      </text>

      <text
        x={leftX}
        y={top + boxH + 50}
        fontFamily="Fraunces, serif"
        fontSize="14"
        fontStyle="italic"
        fill="#5C5852"
      >
        Two contracts. No admin. The credentials side never depends on the identity side.
      </text>
    </svg>
  );
}
