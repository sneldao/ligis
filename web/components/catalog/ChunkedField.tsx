"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AgentTile } from "./AgentTile";
import { useCatalogUi } from "./catalogState";
import {
  CHUNK_SIZE,
  chunkContents,
  radiusForZoom,
  visibleChunks,
} from "./chunks";

export function ChunkedField() {
  const { camera } = useThree();
  const ui = useCatalogUi();
  const [center, setCenter] = useState({ cx: 0, cy: 0, radius: 1 });
  const lastCheck = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastCheck.current < 250) return;
    lastCheck.current = now;
    const cx = Math.round(camera.position.x / CHUNK_SIZE);
    const cy = Math.round(camera.position.y / CHUNK_SIZE);
    const radius = radiusForZoom(camera.position.z);
    if (cx !== center.cx || cy !== center.cy || radius !== center.radius) {
      setCenter({ cx, cy, radius });
    }
  });

  const chunks = useMemo(
    () => visibleChunks(center.cx, center.cy, center.radius),
    [center],
  );

  const far = center.radius > 1;
  const liveKey = ui.liveCount;

  return (
    <>
      {chunks.map((c) => (
        <Chunk
          key={`${c.cx},${c.cy},${liveKey}`}
          cx={c.cx}
          cy={c.cy}
          stagger={!far}
        />
      ))}
    </>
  );
}

function Chunk({
  cx,
  cy,
  stagger,
}: {
  cx: number;
  cy: number;
  stagger: boolean;
}) {
  const items = useMemo(() => chunkContents(cx, cy), [cx, cy]);
  return (
    <>
      {items.map(({ agent, layout }, i) => (
        <AgentTile
          key={agent.address}
          agent={agent}
          layout={layout}
          enterDelay={stagger ? i * 32 + (Math.abs(cx) + Math.abs(cy)) * 50 : 0}
        />
      ))}
    </>
  );
}
