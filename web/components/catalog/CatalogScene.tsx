"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { AgentTile } from "./AgentTile";
import { Rig } from "./Rig";
import { CATALOG_CONFIG } from "./catalogState";
import { seedCatalog, type CatalogAgent } from "./agentSeed";

function gridPositions(agents: CatalogAgent[]) {
  const cols = CATALOG_CONFIG.gridCols;
  const spacing = CATALOG_CONFIG.itemSize + CATALOG_CONFIG.gap;
  const rows = Math.ceil(agents.length / cols);
  const w = cols * spacing;
  const h = rows * spacing;
  return {
    width: w,
    height: h,
    positions: agents.map((_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return [
        col * spacing - w / 2 + spacing / 2,
        -(row * spacing) + h / 2 - spacing / 2,
        0,
      ] as [number, number, number];
    }),
  };
}

export function CatalogScene({ agents }: { agents?: CatalogAgent[] }) {
  const items = useMemo(() => agents ?? seedCatalog(49), [agents]);
  const { width, height, positions } = useMemo(() => gridPositions(items), [items]);

  return (
    <Canvas
      camera={{ position: [0, 0, CATALOG_CONFIG.zoomOut], fov: 35 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ background: "#F4F1EC", touchAction: "none" }}
    >
      <fog attach="fog" args={["#F4F1EC", CATALOG_CONFIG.fogNear, CATALOG_CONFIG.fogFar]} />
      <Suspense fallback={null}>
        {items.map((agent, i) => (
          <AgentTile key={agent.address} agent={agent} position={positions[i]!} />
        ))}
      </Suspense>
      <Rig gridW={width} gridH={height} />
    </Canvas>
  );
}
