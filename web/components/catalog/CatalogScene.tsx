"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { AgentTile } from "./AgentTile";
import { Rig } from "./Rig";
import { CATALOG_CONFIG } from "./catalogState";
import { seedCatalog, type CatalogAgent } from "./agentSeed";
import { layoutCatalog } from "./positions";

export function CatalogScene({ agents }: { agents?: CatalogAgent[] }) {
  const items = useMemo(() => agents ?? seedCatalog(72), [agents]);
  const layout = useMemo(() => layoutCatalog(items), [items]);

  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, CATALOG_CONFIG.zoomOut], fov: 38 }}
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
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-6, -4, 6]} intensity={0.25} color="#d6e0d2" />

      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={0.35} />
      </Suspense>

      <Suspense fallback={null}>
        {items.map((agent, i) => {
          const enterDelay = i * 18 + Math.random() * 60;
          const layoutItem = layout.positions[i]!;
          return (
            <AgentTile
              key={agent.address}
              agent={agent}
              layout={layoutItem}
              enterDelay={enterDelay}
            />
          );
        })}
      </Suspense>

      <ContactShadows
        position={[0, -layout.height / 2 - 1.8, 0]}
        opacity={0.3}
        scale={Math.max(layout.width, layout.height) * 1.2}
        blur={3.6}
        far={6}
        color="#1c1b1a"
      />

      <Rig gridW={layout.width} gridH={layout.height} />
    </Canvas>
  );
}
