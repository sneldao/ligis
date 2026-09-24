import { keccak256, toBytes, type Address } from "viem";
import { type CatalogAgent } from "./agentSeed";
import type { CatalogPosition } from "./positions";
import { getFieldLiveAgents } from "./catalogState";

export const CHUNK_SIZE = 16;
export const AGENTS_PER_CHUNK = 6;
export const RENDER_RADIUS = 1;

export type ChunkAgent = {
  agent: CatalogAgent;
  layout: CatalogPosition;
};

function hashBytes(seed: string): number[] {
  const h = keccak256(toBytes(seed));
  const out: number[] = [];
  for (let i = 2; i < h.length; i += 2) {
    out.push(parseInt(h.slice(i, i + 2), 16));
  }
  return out;
}

function addressFromSeed(seed: string): Address {
  return `0x${keccak256(toBytes(seed)).slice(-40)}` as Address;
}

function placeInChunk(
  cx: number,
  cy: number,
  b: number[],
  index: number,
): CatalogPosition {
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  const cellAngle =
    (index / AGENTS_PER_CHUNK) * Math.PI * 2 + ((b[0]! - 128) / 255) * 0.5;
  const cellRadius = (b[1]! / 255) * (CHUNK_SIZE / 2 - 1.5);
  const x = baseX + Math.cos(cellAngle) * cellRadius;
  const y = baseY + Math.sin(cellAngle) * cellRadius;
  const z = ((b[2]! - 128) / 255) * 12;
  const bobPhase = (b[3]! / 255) * Math.PI * 2;
  const bobAmp = 0.06 + (b[4]! / 255) * 0.14;
  const rotZ = ((b[5]! - 128) / 255) * 0.07;
  const rotX = ((b[6]! - 128) / 255) * 0.04;
  return { pos: [x, y, z], bobPhase, bobAmp, rotZ, rotX };
}

/** Deterministic spiral around origin for live agents. */
export function layoutLiveAgent(
  agent: CatalogAgent,
  index: number,
  total: number,
): CatalogPosition {
  const b = hashBytes(`live:${agent.address.toLowerCase()}`);
  const ring = Math.floor(Math.sqrt(index));
  const ringIndex = index - ring * ring;
  const ringCount = Math.max(1, 2 * ring + 1);
  const angle =
    (ringIndex / ringCount) * Math.PI * 2 + ((b[0]! - 128) / 255) * 0.2;
  const radius = ring * 3.4 + (total <= 1 ? 0 : 1.2);
  const x = Math.cos(angle) * radius + ((b[1]! - 128) / 255) * 0.6;
  const y = Math.sin(angle) * radius + ((b[2]! - 128) / 255) * 0.6;
  const z = ((b[3]! - 128) / 255) * 4;
  return {
    pos: [x, y, z],
    bobPhase: (b[4]! / 255) * Math.PI * 2,
    bobAmp: 0.06 + (b[5]! / 255) * 0.1,
    rotZ: ((b[6]! - 128) / 255) * 0.05,
    rotX: ((b[7]! - 128) / 255) * 0.03,
  };
}

export function chunkContents(cx: number, cy: number): ChunkAgent[] {
  const live = getFieldLiveAgents();
  const out: ChunkAgent[] = [];
  const isOrigin = cx === 0 && cy === 0;

  if (isOrigin && live.length > 0) {
    live.forEach((agent, i) => {
      out.push({
        agent,
        layout: layoutLiveAgent(agent, i, live.length),
      });
    });
    return out;
  }

  // Ambient density — phantoms only, never deep-linked as dossiers.
  if (isOrigin && live.length === 0) {
    // Empty registry: one quiet hint marker at origin (still phantom).
    const hintAddr = addressFromSeed("ligis:empty-field-hint");
    out.push({
      agent: { address: hintAddr, origin: "phantom", index: 0 },
      layout: {
        pos: [0, 0, 0],
        bobPhase: 0,
        bobAmp: 0.08,
        rotZ: 0,
        rotX: 0,
      },
    });
  }

  for (let i = 0; i < AGENTS_PER_CHUNK; i++) {
    if (isOrigin && live.length === 0 && i === 0) continue;
    const seed = `ligis:chunk:${cx}:${cy}:agent:${i}`;
    const address = addressFromSeed(seed);
    const bytes = hashBytes(seed);
    out.push({
      agent: { address, origin: "phantom", index: i },
      layout: placeInChunk(cx, cy, bytes, i),
    });
  }

  return out;
}

export function radiusForZoom(cameraZ: number): number {
  if (cameraZ < 20) return RENDER_RADIUS;
  if (cameraZ < 32) return 2;
  return 3;
}

export function visibleChunks(
  centerCx: number,
  centerCy: number,
  radius = RENDER_RADIUS,
): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      out.push({ cx: centerCx + dx, cy: centerCy + dy });
    }
  }
  return out;
}
