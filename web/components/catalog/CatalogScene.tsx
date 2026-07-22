"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ChunkedField } from "./ChunkedField";
import { Rig } from "./Rig";
import { CATALOG_CONFIG } from "./catalogState";

export function CatalogScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, CATALOG_CONFIG.zoomOut], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ background: "#F4F1EC", touchAction: "none" }}
    >
      <fog attach="fog" args={["#F4F1EC", CATALOG_CONFIG.fogNear, CATALOG_CONFIG.fogFar]} />

      <ambientLight intensity={0.7} />
      <directionalLight
        position={[6, 9, 8]}
        intensity={1.5}
        color="#fff5e8"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-6, -4, 6]} intensity={0.3} color="#d6e0d2" />

      <Suspense fallback={
        <group>
          {/* Minimal in-scene fallback — the fog + background make this
              nearly invisible, just prevents a blank flash */}
        </group>
      }>
        <ChunkedField />
      </Suspense>

      <Rig />
    </Canvas>
  );
}
