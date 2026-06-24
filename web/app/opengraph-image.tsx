import { ImageResponse } from "next/og";
import { keccak256, toBytes } from "viem";
import { loadFont } from "@/lib/og-fonts";
import { network } from "@/lib/chain";
import { portraitSvgInner } from "@/lib/portrait";

export const alt = "Ligis — a trust layer for autonomous agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SAMPLE_SEEDS = [
  "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  ...Array.from({ length: 5 }, (_, i) => {
    const hash = keccak256(toBytes(`ligis:og:${i}`));
    return `0x${hash.slice(-40)}`;
  }),
];

const PORTRAIT_W = 165;
const PORTRAIT_H = Math.round(PORTRAIT_W * 1.25);

function portraitDataUri(address: string): string {
  const inner = portraitSvgInner(address, { width: PORTRAIT_W, height: PORTRAIT_H });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_W}" height="${PORTRAIT_H}" viewBox="0 0 ${PORTRAIT_W} ${PORTRAIT_H}">${inner}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default async function Image() {
  const [serif, mono] = await Promise.all([
    loadFont("Fraunces", 500),
    loadFont("JetBrains Mono", 500),
  ]);
  const fonts: Array<{ name: string; data: ArrayBuffer; weight: 400 | 500 | 600 }> = [];
  if (serif) fonts.push({ name: "Fraunces", data: serif, weight: 500 });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 500 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F4F1EC",
          color: "#1C1B1A",
          padding: "60px 72px",
          fontFamily: "Fraunces, serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 16,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#8A857D",
            }}
          >
            Ligis · idx 00
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 16,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#8A857D",
            }}
          >
            {network.name.toLowerCase()} · chain {network.chainId}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 96,
              lineHeight: 1.04,
              letterSpacing: -2.2,
              color: "#1C1B1A",
              maxWidth: 900,
            }}
          >
            A trust layer for autonomous agents.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 24,
              fontStyle: "italic",
              color: "#5C5852",
              maxWidth: 760,
            }}
          >
            Two contracts. No admin. No upgrade key. One read: isCapable.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 18 }}>
            {SAMPLE_SEEDS.map((addr) => (
              <img
                key={addr}
                src={portraitDataUri(addr)}
                width={PORTRAIT_W}
                height={PORTRAIT_H}
                alt=""
              />
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined,
    }
  );
}
