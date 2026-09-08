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
  fieldChainId,
  rigState,
  setHoveredId,
} from "./catalogState";
import type { CatalogAgent } from "./agentSeed";
import type { CatalogPosition } from "./positions";

const PORTRAIT_W = 2.6;
const PORTRAIT_H = 3.25;
const TILE_DEPTH = 0.18;
const MARKER_R = 0.22;

type Props = {
  agent: CatalogAgent;
  layout: CatalogPosition;
  enterDelay: number;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function AgentTile({ agent, layout, enterDelay }: Props) {
  const router = useRouter();
  const group = useRef<Group>(null);
  const specimen = useRef<Group>(null);
  const marker = useRef<Mesh>(null);
  const label = useRef<Group>(null);
  const startTime = useRef(performance.now());
  const lastKeys = useRef({ tile: -1, mark: -1 });

  const params = useMemo(() => portraitParams(agent.address), [agent.address]);
  const id = agent.address;

  useFrame((state, delta) => {
    if (!group.current) return;
    const elapsed = performance.now() - startTime.current - enterDelay;
    const reveal = clamp01(elapsed / 800);

    easing.damp3(group.current.scale, [reveal, reveal, reveal], 0.22, delta);

    const liftIn = (1 - reveal) * -1.6;
    const bob =
      Math.sin(state.clock.elapsedTime * 0.55 + layout.bobPhase) *
      layout.bobAmp;

    easing.damp(group.current.position, "x", layout.pos[0], 0.28, delta);
    easing.damp(
      group.current.position,
      "y",
      layout.pos[1] + bob + liftIn,
      0.22,
      delta,
    );
    easing.damp(group.current.position, "z", layout.pos[2], 0.28, delta);
    easing.damp(group.current.rotation, "z", layout.rotZ, 0.4, delta);
    easing.damp(group.current.rotation, "x", layout.rotX, 0.4, delta);

    const camZ = state.camera.position.z;
    const { lodSpecimen, lodMarker, planarFadeStart, planarFadeEnd } =
      CATALOG_CONFIG;
    const lod = clamp01(
      (camZ - lodSpecimen) / Math.max(lodMarker - lodSpecimen, 0.0001),
    );
    const dx = state.camera.position.x - group.current.position.x;
    const dy = state.camera.position.y - group.current.position.y;
    const planar = Math.hypot(dx, dy);
    const planarFade =
      planar <= planarFadeStart
        ? 1
        : planar >= planarFadeEnd
          ? 0
          : 1 - (planar - planarFadeStart) / (planarFadeEnd - planarFadeStart);

    // Specimens only when close in Z *and* near the look point.
    // Markers take over otherwise — the field never goes blank.
    const tileOpacity = (1 - lod) * planarFade * reveal;
    const markerOpacity = Math.max(lod, 1 - planarFade) * reveal;
    const showTile = tileOpacity > 0.04;
    const showMark = markerOpacity > 0.04;

    group.current.visible = showTile || showMark;

    if (specimen.current) specimen.current.visible = showTile;
    if (marker.current) {
      marker.current.visible = showMark;
      const markScale = 0.7 + lod * 1.4 + (1 - planarFade) * 0.35;
      marker.current.scale.setScalar(markScale);
    }
    if (label.current) label.current.visible = showTile && tileOpacity > 0.35;

    const tileKey = Math.round(tileOpacity * 100);
    if (specimen.current && tileKey !== lastKeys.current.tile) {
      lastKeys.current.tile = tileKey;
      applyOpacity(specimen.current, tileOpacity);
    }
    const markKey = Math.round(markerOpacity * 100);
    if (marker.current && markKey !== lastKeys.current.mark) {
      lastKeys.current.mark = markKey;
      applyOpacity(marker.current, markerOpacity);
    }
  });

  const px = (params.primary.cx - 0.5) * PORTRAIT_W;
  const py = (0.5 - params.primary.cy) * PORTRAIT_H;
  const pr = params.primary.r * PORTRAIT_W;
  const gx = px + params.ghost.ox * PORTRAIT_W * 10;
  const gy = py - params.ghost.oy * PORTRAIT_H * 10;
  const sx = (params.secondary.cx - 0.5) * PORTRAIT_W;
  const sy = (0.5 - params.secondary.cy) * PORTRAIT_H;
  const sr = params.secondary.r * PORTRAIT_W;
  const bandY =
    (0.5 - params.band.y) * PORTRAIT_H - (params.band.h * PORTRAIT_H) / 2;
  const bandH = params.band.h * PORTRAIT_H;
  const markerColor =
    agent.origin === "deployer" ? "#B85D3E" : params.deck.primary;

  function openAgent() {
    if (rigState.isDragging) return;
    const qs = fieldChainId ? `?chain=${encodeURIComponent(fieldChainId)}` : "";
    router.push(`/agent/${agent.address}${qs}`);
  }

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
        openAgent();
      }}
    >
      <mesh ref={marker} position={[0, 0, 0.04]} userData={{ baseOpacity: 1 }}>
        <circleGeometry args={[MARKER_R, 20]} />
        <meshBasicMaterial color={markerColor} transparent depthWrite={false} />
      </mesh>

      <group ref={specimen}>
        {agent.origin === "deployer" ? (
          <>
            <mesh
              position={[0, 0, -TILE_DEPTH - 0.02]}
              userData={{ baseOpacity: 0.9 }}
            >
              <ringGeometry args={[PORTRAIT_W * 0.62, PORTRAIT_W * 0.66, 96]} />
              <meshBasicMaterial color="#B85D3E" transparent opacity={0.9} />
            </mesh>
            <Text
              position={[0, PORTRAIT_H / 2 + 0.32, 0.01]}
              fontSize={0.11}
              color="#B85D3E"
              anchorX="center"
              anchorY="bottom"
              letterSpacing={0.18}
            >
              LIVE · DEPLOYER
            </Text>
          </>
        ) : null}

        <mesh
          castShadow
          receiveShadow
          position={[0, 0, -TILE_DEPTH / 2]}
          userData={{ baseOpacity: 1 }}
        >
          <boxGeometry args={[PORTRAIT_W, PORTRAIT_H, TILE_DEPTH]} />
          <meshStandardMaterial
            color={params.deck.paper}
            roughness={0.92}
            metalness={0}
          />
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
          <meshStandardMaterial
            color={params.deck.secondary}
            roughness={0.85}
          />
        </mesh>

        <group ref={label}>
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
      </group>
    </group>
  );
}

function applyOpacity(root: Group | Mesh, opacity: number) {
  root.traverse((obj) => {
    const mat = (obj as Mesh).material as Material | Material[] | undefined;
    if (!mat) return;
    const apply = (m: Material) => {
      if ("opacity" in m) {
        m.transparent = true;
        (m as Material & { opacity: number }).opacity =
          (m.userData?.baseOpacity ?? 1) * opacity;
        m.depthWrite = opacity > 0.92;
      }
    };
    if (Array.isArray(mat)) mat.forEach(apply);
    else apply(mat);
  });
}
