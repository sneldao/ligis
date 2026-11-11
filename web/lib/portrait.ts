export type PortraitDeck = {
  paper: string;
  primary: string;
  secondary: string;
};

export type PortraitParams = {
  deck: PortraitDeck;
  band: { y: number; h: number };
  primary: { cx: number; cy: number; r: number };
  secondary: {
    cx: number;
    cy: number;
    r: number;
    shape: "circle" | "arc" | "bar";
  };
  ghost: { ox: number; oy: number };
  arcAngle: number;
  seed: number;
};

/*
 * Six decks, drawn from the site's own palette — warm paper, terracotta,
 * sage and ink. The risograph target means flat ink, no gradients, and at
 * most three colours per plate. Six is enough variety that a wall of
 * specimens does not read as the same object recoloured; the SHAPE axis
 * (below) supplies the rest.
 */
const DECKS: PortraitDeck[] = [
  { paper: "#ECE7DF", primary: "#B85D3E", secondary: "#5A6D53" },
  { paper: "#F4F1EC", primary: "#1C1B1A", secondary: "#B85D3E" },
  { paper: "#F4F1EC", primary: "#5A6D53", secondary: "#1C1B1A" },
  { paper: "#ECE7DF", primary: "#E8C9BD", secondary: "#1C1B1A" },
  { paper: "#F4F1EC", primary: "#B85D3E", secondary: "#1C1B1A" },
  { paper: "#ECE7DF", primary: "#1C1B1A", secondary: "#5A6D53" },
];

function bytesFromAddress(address: string): number[] {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const out: number[] = [];
  for (let i = 0; i < 20; i++) {
    out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  return out;
}

export function portraitParams(address: string): PortraitParams {
  const b = bytesFromAddress(address);
  const deck = DECKS[b[0] % DECKS.length]!;
  const norm = (i: number) => b[i]! / 255;

  return {
    deck,
    band: {
      y: 0.5 + norm(4) * 0.25,
      h: 0.03 + norm(5) * 0.06,
    },
    primary: {
      cx: 0.18 + norm(1) * 0.5,
      cy: 0.18 + norm(2) * 0.32,
      r: 0.22 + norm(3) * 0.16,
    },
    secondary: {
      cx: 0.15 + norm(6) * 0.7,
      cy: 0.55 + norm(7) * 0.3,
      r: 0.03 + norm(8) * 0.05,
      // Three shapes, not two: a circle, a drawn arc, and a printed bar.
      // The bar is the one that reads as ink-laid rather than drawn, and
      // it keeps a wall of specimens from looking like the same mark
      // recoloured.
      shape: b[11]! % 3 === 0 ? "circle" : b[11]! % 3 === 1 ? "arc" : "bar",
    },
    ghost: {
      ox: (((b[9]! % 9) - 4) / 1000) * 6,
      oy: (((b[10]! % 9) - 4) / 1000) * 6,
    },
    arcAngle: norm(12) * Math.PI * 2,
    seed: b[13]!,
  };
}

export type PortraitSize = { width: number; height: number };

export function portraitSvgInner(
  address: string,
  size: PortraitSize = { width: 800, height: 1000 },
): string {
  const p = portraitParams(address);
  const W = size.width;
  const H = size.height;

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
    if (p.secondary.shape !== "arc") return "";
    const r = sr * 2.2;
    const a1 = p.arcAngle;
    const a2 = a1 + Math.PI * 1.1;
    const x1 = sx + Math.cos(a1) * r;
    const y1 = sy + Math.sin(a1) * r;
    const x2 = sx + Math.cos(a2) * r;
    const y2 = sy + Math.sin(a2) * r;
    return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${p.deck.secondary}" stroke-width="${(sr * 0.6).toFixed(1)}" fill="none" stroke-linecap="round" />`;
  })();

  const dot =
    p.secondary.shape === "circle"
      ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${p.deck.secondary}" />`
      : "";

  // A printed bar: a laid rectangle, slightly off-square, rotated by the
  // same angle the arc would use. Reads as ink on paper, not as a shape.
  const bar = (() => {
    if (p.secondary.shape !== "bar") return "";
    const bw = sr * 3.4;
    const bh2 = sr * 0.9;
    const rot = p.arcAngle * (180 / Math.PI);
    return `<rect x="${(sx - bw / 2).toFixed(1)}" y="${(sy - bh2 / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh2.toFixed(1)}" fill="${p.deck.secondary}" transform="rotate(${rot.toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)})" />`;
  })();

  return `
    <rect width="${W}" height="${H}" fill="${p.deck.paper}" />
    <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${pr.toFixed(1)}" fill="${p.deck.secondary}" opacity="0.42" />
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${pr.toFixed(1)}" fill="${p.deck.primary}" />
    <rect x="0" y="${by.toFixed(1)}" width="${W}" height="${bh.toFixed(1)}" fill="${p.deck.secondary}" opacity="0.86" />
    ${dot}
    ${arc}
    ${bar}
  `.trim();
}

export function portraitDeckFor(address: string): PortraitDeck {
  return portraitParams(address).deck;
}
