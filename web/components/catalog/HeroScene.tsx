"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import type { Group, Mesh } from "three";
import { easing } from "maath";
import { portraitParams } from "@/lib/portrait";

const TILE_W = 5.4;
const TILE_H = 6.75;
const TILE_DEPTH = 0.32;

function HeroTile({ address }: { address: string }) {
  const group = useRef<Group>(null);
  const params = useMemo(() => portraitParams(address), [address]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const t = state.timer.elapsedTime;
    const bob = Math.sin(t * 0.5) * 0.08;
    easing.damp(group.current.position, "y", bob, 0.25, delta);
    easing.damp(group.current.rotation, "y", Math.sin(t * 0.18) * 0.12, 0.4, delta);
  });

  const px = (params.primary.cx - 0.5) * TILE_W;
  const py = (0.5 - params.primary.cy) * TILE_H;
  const pr = params.primary.r * TILE_W;
  const gx = px + params.ghost.ox * TILE_W * 10;
  const gy = py - params.ghost.oy * TILE_H * 10;
  const sx = (params.secondary.cx - 0.5) * TILE_W;
  const sy = (0.5 - params.secondary.cy) * TILE_H;
  const sr = params.secondary.r * TILE_W;
  const bandY = (0.5 - params.band.y) * TILE_H - (params.band.h * TILE_H) / 2;
  const bandH = params.band.h * TILE_H;

  return (
    <group ref={group}>
      <mesh castShadow receiveShadow position={[0, 0, -TILE_DEPTH / 2]}>
        <boxGeometry args={[TILE_W, TILE_H, TILE_DEPTH]} />
        <meshStandardMaterial color={params.deck.paper} roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[gx, gy, 0.003]}>
        <circleGeometry args={[pr, 96]} />
        <meshStandardMaterial color={params.deck.secondary} transparent opacity={0.42} roughness={1} />
      </mesh>
      <mesh position={[px, py, 0.006]}>
        <circleGeometry args={[pr, 96]} />
        <meshStandardMaterial color={params.deck.primary} roughness={0.85} />
      </mesh>
      <mesh position={[0, bandY, 0.009]}>
        <planeGeometry args={[TILE_W, bandH]} />
        <meshStandardMaterial color={params.deck.secondary} transparent opacity={0.88} roughness={0.9} />
      </mesh>
      <mesh position={[sx, sy, 0.012]}>
        <circleGeometry args={[sr, 48]} />
        <meshStandardMaterial color={params.deck.secondary} roughness={0.85} />
      </mesh>
    </group>
  );
}

function CredentialOrbit({ count }: { count: number }) {
  const group = useRef<Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.z = state.timer.elapsedTime * 0.05;
  });

  if (count <= 0) return null;

  const radius = Math.max(TILE_W, TILE_H) * 0.78;
  const items = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.cos(a) * radius,
      y: Math.sin(a) * radius,
    };
  });

  return (
    <group ref={group} position={[0, 0, 0.3]}>
      {items.map((item, i) => (
        <Marker key={i} x={item.x} y={item.y} index={i} />
      ))}
    </group>
  );
}

function Marker({ x, y, index }: { x: number; y: number; index: number }) {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const pulse = 1 + Math.sin(state.timer.elapsedTime * 1.4 + index) * 0.08;
    ref.current.scale.set(pulse, pulse, 1);
  });
  return (
    <mesh ref={ref} position={[x, y, 0]}>
      <ringGeometry args={[0.18, 0.26, 48]} />
      <meshBasicMaterial color="#6F8267" transparent opacity={0.85} />
    </mesh>
  );
}

export function HeroScene({
  address,
  heldCount,
}: {
  address: string;
  heldCount: number;
}) {
  return (
    <Canvas
      shadows="basic"
      camera={{ position: [0, 0, 11], fov: 38 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ background: "#F4F1EC", touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          console.warn("[HeroScene] WebGL context lost, pausing scene");
        });
      }}
    >
      <fog attach="fog" args={["#F4F1EC", 12, 28]} />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[5, 8, 6]}
        intensity={1.5}
        color="#fff5e8"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-5, -3, 5]} intensity={0.3} color="#d6e0d2" />

      <HeroTile address={address} />
      <CredentialOrbit count={heldCount} />

      <ContactShadows
        position={[0, -TILE_H / 2 - 0.4, 0]}
        opacity={0.4}
        scale={TILE_W * 2.5}
        blur={2.6}
        far={4}
        color="#1c1b1a"
      />
    </Canvas>
  );
}
