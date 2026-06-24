"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
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
      shadows
      camera={{ position: [0, 0, CATALOG_CONFIG.zoomOut], fov: 35 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ background: "#F4F1EC", touchAction: "none" }}
    >
      <fog attach="fog" args={["#F4F1EC", CATALOG_CONFIG.fogNear, CATALOG_CONFIG.fogFar]} />

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[6, 9, 8]}
        intensity={1.35}
        color="#fff5e8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <directionalLight position={[-6, -4, 6]} intensity={0.25} color="#d6e0d2" />

      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={0.35} />
      </Suspense>

      <Suspense fallback={null}>
        {items.map((agent, i) => {
          const enterDelay = i * 22 + (Math.random() * 80);
          return (
            <AgentTile
              key={agent.address}
              agent={agent}
              position={positions[i]!}
              enterDelay={enterDelay}
            />
          );
        })}
      </Suspense>

      <ContactShadows
        position={[0, -height / 2 - 1.6, 0]}
        opacity={0.32}
        scale={Math.max(width, height) * 1.2}
        blur={3.4}
        far={6}
        color="#1c1b1a"
      />

      <Rig gridW={width} gridH={height} />
    </Canvas>
  );
}
