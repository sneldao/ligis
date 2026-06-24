import { ImageResponse } from "next/og";
import { getAddress } from "viem";
import {
  capabilities as referenceCapabilities,
  network,
  readAgentSnapshot,
} from "@/lib/chain";
import { isAddressLike, truncateAddress } from "@/lib/format";
import { loadFont } from "@/lib/og-fonts";
import { portraitSvgInner } from "@/lib/portrait";

export const alt = "Ligis · agent identity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const display = isAddressLike(raw) ? truncateAddress(getAddress(raw), 6, 4) : "—";
  const normal = isAddressLike(raw) ? getAddress(raw) : "0x0000000000000000000000000000000000000000";

  const snap = await readAgentSnapshot(normal as `0x${string}`).catch(() => ({
    exists: false,
    held: [] as Array<{ capability: (typeof referenceCapabilities)[number] }>,
  }));

  const portraitWidth = 460;
  const portraitHeight = Math.round(portraitWidth * 1.25);
  const svgInner = portraitSvgInner(normal, {
    width: portraitWidth,
    height: portraitHeight,
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${portraitWidth}" height="${portraitHeight}" viewBox="0 0 ${portraitWidth} ${portraitHeight}">${svgInner}</svg>`;
  const portraitDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

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
          background: "#F4F1EC",
          color: "#1C1B1A",
          padding: "60px 72px",
          fontFamily: "Fraunces, serif",
        }}
      >
        <div style={{ display: "flex", width: portraitWidth, flexShrink: 0 }}>
          <img
            src={portraitDataUri}
            width={portraitWidth}
            height={portraitHeight}
            alt=""
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            marginLeft: 56,
            flex: 1,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 14,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "#8A857D",
              }}
            >
              Ligis · agent · {snap.exists ? "in the index" : "not in the index"}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 92,
                lineHeight: 1.02,
                letterSpacing: -2,
                color: "#1C1B1A",
              }}
            >
              {display}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 22,
                lineHeight: 1.4,
                color: "#5C5852",
                fontStyle: "italic",
                maxWidth: 520,
              }}
            >
              {snap.exists
                ? `${snap.held.length} of ${referenceCapabilities.length} reference capabilities held.`
                : "Not minted. The catalog presents what exists."}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 14,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#8A857D",
            }}
          >
            {network.name.toLowerCase()} · chain {network.chainId}
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
