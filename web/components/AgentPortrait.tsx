import { portraitParams } from "@/lib/portrait";

type Props = {
  address: string;
  className?: string;
};

export function AgentPortrait({ address, className = "" }: Props) {
  const p = portraitParams(address);
  const W = 800;
  const H = 1000;

  const px = p.primary.cx * W;
  const py = p.primary.cy * H;
  const pr = p.primary.r * W;
  const gx = px + p.ghost.ox * W;
  const gy = py + p.ghost.oy * H;
  const sx = p.secondary.cx * W;
  const sy = p.secondary.cy * H;
  const sr = p.secondary.r * W;
  const by = p.band.y * H;
  const bh = p.band.h * H;

  const arc = (() => {
    if (p.secondary.shape !== "arc") return null;
    const r = sr * 2.2;
    const a1 = p.arcAngle;
    const a2 = a1 + Math.PI * 1.1;
    const x1 = sx + Math.cos(a1) * r;
    const y1 = sy + Math.sin(a1) * r;
    const x2 = sx + Math.cos(a2) * r;
    const y2 = sy + Math.sin(a2) * r;
    return (
      <path
        d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        stroke={p.deck.secondary}
        strokeWidth={(sr * 0.6).toFixed(1)}
        fill="none"
        strokeLinecap="round"
      />
    );
  })();

  // A printed bar: a laid rectangle, slightly off-square, rotated by the
  // same angle the arc would use. Reads as ink on paper, not as a shape.
  const bar =
    p.secondary.shape === "bar" ? (
      <rect
        x={sx - sr * 1.7}
        y={sy - sr * 0.45}
        width={sr * 3.4}
        height={sr * 0.9}
        fill={p.deck.secondary}
        transform={`rotate(${((p.arcAngle * 180) / Math.PI).toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)})`}
      />
    ) : null;

  const filterId = `grain-${address.slice(2, 10)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Portrait of agent ${address}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id={filterId} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={p.seed} />
          <feColorMatrix
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.08 0"
          />
        </filter>
      </defs>
      <rect width={W} height={H} fill={p.deck.paper} />
      <circle
        cx={gx.toFixed(1)}
        cy={gy.toFixed(1)}
        r={pr.toFixed(1)}
        fill={p.deck.secondary}
        opacity={0.42}
      />
      <circle
        cx={px.toFixed(1)}
        cy={py.toFixed(1)}
        r={pr.toFixed(1)}
        fill={p.deck.primary}
      />
      <rect x={0} y={by.toFixed(1)} width={W} height={bh.toFixed(1)} fill={p.deck.secondary} opacity={0.86} />
      {p.secondary.shape === "circle" ? (
        <circle cx={sx.toFixed(1)} cy={sy.toFixed(1)} r={sr.toFixed(1)} fill={p.deck.secondary} />
      ) : null}
      {arc}
      {bar}
      <rect width={W} height={H} filter={`url(#${filterId})`} />
    </svg>
  );
}
