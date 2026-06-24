"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { easing } from "maath";
import { Text } from "@react-three/drei";
import { useRouter } from "next/navigation";
import { portraitParams } from "@/lib/portrait";
import { CATALOG_CONFIG, rigState, setActiveId, setHoveredId } from "./catalogState";
import type { CatalogAgent } from "./agentSeed";

const PORTRAIT_W = 2.4;
const PORTRAIT_H = 3.0;

export function AgentTile({
  agent,
  position,
}: {
  agent: CatalogAgent;
  position: [number, number, number];
}) {
  const router = useRouter();
  const group = useRef<Group>(null);
  const params = useMemo(() => portraitParams(agent.address), [agent.address]);
  const id = agent.address;

  useFrame((_state, delta) => {
    if (!group.current) return;
    const isActive = rigState.activeId === id;
    const isAnyActive = rigState.activeId !== null;
    const targetScale = isActive
      ? CATALOG_CONFIG.focusScale
      : isAnyActive
        ? CATALOG_CONFIG.dimScale
        : 1;
    easing.damp3(group.current.scale, [targetScale, targetScale, 1], 0.18, delta);

    const targetZ = isActive ? 1.5 : 0;
    easing.damp(group.current.position, "z", position[2] + targetZ, 0.2, delta);

    const curveBack =
      ((position[0] * position[0] + position[1] * position[1]) ** 0.5) *
      CATALOG_CONFIG.curvatureStrength;
    easing.damp(group.current.position, "z", position[2] + targetZ - curveBack, 0.25, delta);
  });

  const px = (params.primary.cx - 0.5) * PORTRAIT_W;
  const py = (0.5 - params.primary.cy) * PORTRAIT_H;
  const pr = params.primary.r * PORTRAIT_W;
  const gx = px + params.ghost.ox * PORTRAIT_W * 8;
  const gy = py - params.ghost.oy * PORTRAIT_H * 8;
  const sx = (params.secondary.cx - 0.5) * PORTRAIT_W;
  const sy = (0.5 - params.secondary.cy) * PORTRAIT_H;
  const sr = params.secondary.r * PORTRAIT_W;
  const bandY = (0.5 - params.band.y) * PORTRAIT_H - (params.band.h * PORTRAIT_H) / 2;
  const bandH = params.band.h * PORTRAIT_H;

  return (
    <group
      ref={group}
      position={position}
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
          rigState.target.set(position[0], position[1], 0);
          rigState.zoom = CATALOG_CONFIG.zoomIn;
        }
      }}
    >
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[PORTRAIT_W, PORTRAIT_H]} />
        <meshBasicMaterial color={params.deck.paper} />
      </mesh>

      <mesh position={[gx, gy, 0.001]}>
        <circleGeometry args={[pr, 48]} />
        <meshBasicMaterial color={params.deck.secondary} transparent opacity={0.42} />
      </mesh>

      <mesh position={[px, py, 0.002]}>
        <circleGeometry args={[pr, 48]} />
        <meshBasicMaterial color={params.deck.primary} />
      </mesh>

      <mesh position={[0, bandY, 0.003]}>
        <planeGeometry args={[PORTRAIT_W, bandH]} />
        <meshBasicMaterial color={params.deck.secondary} transparent opacity={0.86} />
      </mesh>

      <mesh position={[sx, sy, 0.004]}>
        <circleGeometry args={[sr, 32]} />
        <meshBasicMaterial color={params.deck.secondary} />
      </mesh>

      <Text
        position={[0, -PORTRAIT_H / 2 - 0.22, 0.01]}
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
