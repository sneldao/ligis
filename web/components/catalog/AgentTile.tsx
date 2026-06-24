"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Material, Mesh } from "three";
import { easing } from "maath";
import { Text } from "@react-three/drei";
import { useRouter } from "next/navigation";
import { portraitParams } from "@/lib/portrait";
import {
  CATALOG_CONFIG,
  rigState,
  setActiveId,
  setHoveredId,
} from "./catalogState";
import type { CatalogAgent } from "./agentSeed";
import type { CatalogPosition } from "./positions";

const PORTRAIT_W = 2.6;
const PORTRAIT_H = 3.25;
const TILE_DEPTH = 0.18;

const FADE_START = 18;
const FADE_END = 38;

type Props = {
  agent: CatalogAgent;
  layout: CatalogPosition;
  enterDelay: number;
};

export function AgentTile({ agent, layout, enterDelay }: Props) {
  const router = useRouter();
  const group = useRef<Group>(null);
  const baseMesh = useRef<Mesh>(null);
  const startTime = useRef(performance.now());

  const params = useMemo(() => portraitParams(agent.address), [agent.address]);
  const id = agent.address;

  useFrame((state, delta) => {
    if (!group.current) return;
    const elapsed = performance.now() - startTime.current - enterDelay;
    const reveal = Math.max(0, Math.min(1, elapsed / 800));
    const isActive = rigState.activeId === id;
    const isAnyActive = rigState.activeId !== null;

    const targetScale = isActive
      ? CATALOG_CONFIG.focusScale
      : isAnyActive
        ? CATALOG_CONFIG.dimScale
        : 1;
    const eased = reveal * targetScale;
    easing.damp3(group.current.scale, [eased, eased, eased], 0.22, delta);

    const focusBoost = isActive ? 1.2 : 0;
    const liftIn = (1 - reveal) * -1.6;
    const bob =
      Math.sin(state.clock.elapsedTime * 0.55 + layout.bobPhase) * layout.bobAmp;

    easing.damp(group.current.position, "x", layout.pos[0], 0.28, delta);
    easing.damp(group.current.position, "y", layout.pos[1] + bob + liftIn, 0.22, delta);
    easing.damp(group.current.position, "z", layout.pos[2] + focusBoost, 0.28, delta);

    easing.damp(group.current.rotation, "z", layout.rotZ, 0.4, delta);
    easing.damp(group.current.rotation, "x", layout.rotX, 0.4, delta);

    const dist = state.camera.position.distanceTo(group.current.position);
    const fade =
      dist <= FADE_START
        ? 1
        : dist >= FADE_END
          ? 0
          : 1 - (dist - FADE_START) / (FADE_END - FADE_START);
    const opacity = Math.max(0, Math.min(1, fade)) * reveal;
    group.current.visible = opacity > 0.02;

    group.current.traverse((obj) => {
      const mat = (obj as Mesh).material as Material | Material[] | undefined;
      if (!mat) return;
      const apply = (m: Material) => {
        if ("opacity" in m) {
          m.transparent = true;
          (m as Material & { opacity: number }).opacity =
            (m.userData?.baseOpacity ?? 1) * opacity;
        }
      };
      if (Array.isArray(mat)) mat.forEach(apply);
      else apply(mat);
    });
  });

  const px = (params.primary.cx - 0.5) * PORTRAIT_W;
  const py = (0.5 - params.primary.cy) * PORTRAIT_H;
  const pr = params.primary.r * PORTRAIT_W;
  const gx = px + params.ghost.ox * PORTRAIT_W * 10;
  const gy = py - params.ghost.oy * PORTRAIT_H * 10;
  const sx = (params.secondary.cx - 0.5) * PORTRAIT_W;
  const sy = (0.5 - params.secondary.cy) * PORTRAIT_H;
  const sr = params.secondary.r * PORTRAIT_W;
  const bandY = (0.5 - params.band.y) * PORTRAIT_H - (params.band.h * PORTRAIT_H) / 2;
  const bandH = params.band.h * PORTRAIT_H;

  return (
    <group
      ref={group}
      position={[layout.pos[0], layout.pos[1] - 2, layout.pos[2]]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHoveredId(id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHoveredId(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (rigState.isDragging) return;
        if (rigState.activeId === id) {
          router.push(`/agent/${agent.address}`);
        } else {
          setActiveId(id);
          rigState.target.set(layout.pos[0], layout.pos[1], 0);
          rigState.zoom = CATALOG_CONFIG.zoomIn;
        }
      }}
    >
      <mesh
        ref={baseMesh}
        castShadow
        receiveShadow
        position={[0, 0, -TILE_DEPTH / 2]}
        userData={{ baseOpacity: 1 }}
      >
        <boxGeometry args={[PORTRAIT_W, PORTRAIT_H, TILE_DEPTH]} />
        <meshStandardMaterial color={params.deck.paper} roughness={0.92} metalness={0} />
      </mesh>

      <mesh position={[gx, gy, 0.002]} userData={{ baseOpacity: 0.42 }}>
        <circleGeometry args={[pr, 64]} />
        <meshStandardMaterial
          color={params.deck.secondary}
          transparent
          opacity={0.42}
          roughness={1}
        />
      </mesh>

      <mesh position={[px, py, 0.004]} userData={{ baseOpacity: 1 }}>
        <circleGeometry args={[pr, 64]} />
        <meshStandardMaterial color={params.deck.primary} roughness={0.85} />
      </mesh>

      <mesh position={[0, bandY, 0.006]} userData={{ baseOpacity: 0.88 }}>
        <planeGeometry args={[PORTRAIT_W, bandH]} />
        <meshStandardMaterial
          color={params.deck.secondary}
          transparent
          opacity={0.88}
          roughness={0.9}
        />
      </mesh>

      <mesh position={[sx, sy, 0.008]} userData={{ baseOpacity: 1 }}>
        <circleGeometry args={[sr, 32]} />
        <meshStandardMaterial color={params.deck.secondary} roughness={0.85} />
      </mesh>

      <Text
        position={[0, -PORTRAIT_H / 2 - 0.28, 0.01]}
        fontSize={0.14}
        color="#1C1B1A"
        anchorX="center"
        anchorY="top"
        letterSpacing={0.04}
      >
        {`${agent.address.slice(0, 6)}··${agent.address.slice(-4)}`}
      </Text>
    </group>
  );
}
