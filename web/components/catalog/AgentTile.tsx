"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
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

const PORTRAIT_W = 2.6;
const PORTRAIT_H = 3.25;
const TILE_DEPTH = 0.18;

function bytes(addr: string): number[] {
  const hex = addr.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const out: number[] = [];
  for (let i = 0; i < 20; i++) out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return out;
}

export function AgentTile({
  agent,
  position,
  enterDelay,
}: {
  agent: CatalogAgent;
  position: [number, number, number];
  enterDelay: number;
}) {
  const router = useRouter();
  const group = useRef<Group>(null);
  const baseMesh = useRef<Mesh>(null);
  const startTime = useRef(performance.now());

  const params = useMemo(() => portraitParams(agent.address), [agent.address]);
  const jitter = useMemo(() => {
    const b = bytes(agent.address);
    return {
      zOffset: ((b[14]! % 32) - 16) / 200,
      rotZ: ((b[15]! % 32) - 16) / 600,
      rotX: ((b[16]! % 16) - 8) / 800,
    };
  }, [agent.address]);

  const id = agent.address;

  useFrame((_state, delta) => {
    if (!group.current) return;
    const elapsed = performance.now() - startTime.current - enterDelay;
    const reveal = Math.max(0, Math.min(1, elapsed / 700));
    const isActive = rigState.activeId === id;
    const isAnyActive = rigState.activeId !== null;

    const targetScale = isActive
      ? CATALOG_CONFIG.focusScale
      : isAnyActive
        ? CATALOG_CONFIG.dimScale
        : 1;
    const eased = reveal * targetScale;
    easing.damp3(group.current.scale, [eased, eased, eased], 0.22, delta);

    const focusZ = isActive ? 1.6 : 0;
    const distFromCenter = Math.sqrt(position[0] ** 2 + position[1] ** 2);
    const curveBack = distFromCenter * CATALOG_CONFIG.curvatureStrength;
    const targetZ = position[2] + focusZ + jitter.zOffset - curveBack;
    easing.damp(group.current.position, "z", targetZ, 0.28, delta);

    const liftIn = (1 - reveal) * -2;
    easing.damp(group.current.position, "y", position[1] + liftIn, 0.22, delta);

    easing.damp(group.current.rotation, "z", jitter.rotZ, 0.4, delta);
    easing.damp(group.current.rotation, "x", jitter.rotX, 0.4, delta);
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
      position={[position[0], position[1] - 2, position[2]]}
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
      <mesh ref={baseMesh} castShadow receiveShadow position={[0, 0, -TILE_DEPTH / 2]}>
        <boxGeometry args={[PORTRAIT_W, PORTRAIT_H, TILE_DEPTH]} />
        <meshStandardMaterial
          color={params.deck.paper}
          roughness={0.92}
          metalness={0.0}
        />
      </mesh>

      <mesh position={[gx, gy, 0.002]}>
        <circleGeometry args={[pr, 64]} />
        <meshStandardMaterial
          color={params.deck.secondary}
          transparent
          opacity={0.42}
          roughness={1}
        />
      </mesh>

      <mesh position={[px, py, 0.004]}>
        <circleGeometry args={[pr, 64]} />
        <meshStandardMaterial color={params.deck.primary} roughness={0.85} />
      </mesh>

      <mesh position={[0, bandY, 0.006]}>
        <planeGeometry args={[PORTRAIT_W, bandH]} />
        <meshStandardMaterial
          color={params.deck.secondary}
          transparent
          opacity={0.88}
          roughness={0.9}
        />
      </mesh>

      <mesh position={[sx, sy, 0.008]}>
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
