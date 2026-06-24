"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AgentTile } from "./AgentTile";
import { CHUNK_SIZE, chunkContents, visibleChunks } from "./chunks";

export function ChunkedField() {
  const { camera } = useThree();
  const [center, setCenter] = useState({ cx: 0, cy: 0 });
  const lastCheck = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastCheck.current < 250) return;
    lastCheck.current = now;
    const cx = Math.round(camera.position.x / CHUNK_SIZE);
    const cy = Math.round(camera.position.y / CHUNK_SIZE);
    if (cx !== center.cx || cy !== center.cy) {
      setCenter({ cx, cy });
    }
  });

  const chunks = useMemo(() => visibleChunks(center.cx, center.cy), [center]);

  return (
    <>
      {chunks.map((c) => (
        <Chunk key={`${c.cx},${c.cy}`} cx={c.cx} cy={c.cy} />
      ))}
    </>
  );
}

function Chunk({ cx, cy }: { cx: number; cy: number }) {
  const items = useMemo(() => chunkContents(cx, cy), [cx, cy]);
  return (
    <>
      {items.map(({ agent, layout }, i) => (
        <AgentTile
          key={agent.address}
          agent={agent}
          layout={layout}
          enterDelay={i * 32 + (Math.abs(cx) + Math.abs(cy)) * 50}
        />
      ))}
    </>
  );
}
