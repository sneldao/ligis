import { keccak256, toBytes, type Address } from "viem";
import type { CatalogAgent } from "./agentSeed";
import type { CatalogPosition } from "./positions";

export const CHUNK_SIZE = 16;
export const AGENTS_PER_CHUNK = 6;
export const RENDER_RADIUS = 2;

const PINNED_REAL: Address = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

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
  index: number
): CatalogPosition {
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  const cellAngle = (index / AGENTS_PER_CHUNK) * Math.PI * 2 + ((b[0]! - 128) / 255) * 0.5;
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

export function chunkContents(cx: number, cy: number): ChunkAgent[] {
  const out: ChunkAgent[] = [];

  const isOrigin = cx === 0 && cy === 0;
  if (isOrigin) {
    const realBytes = hashBytes(`pin:real:${PINNED_REAL.toLowerCase()}`);
    out.push({
      agent: { address: PINNED_REAL, origin: "deployer", index: 0 },
      layout: {
        pos: [0, 0, 0],
        bobPhase: (realBytes[3]! / 255) * Math.PI * 2,
        bobAmp: 0.08,
        rotZ: 0,
        rotX: 0,
      },
    });
  }

  const startIndex = isOrigin ? 1 : 0;
  for (let i = startIndex; i < AGENTS_PER_CHUNK; i++) {
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

export function visibleChunks(centerCx: number, centerCy: number): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
    for (let dy = -RENDER_RADIUS; dy <= RENDER_RADIUS; dy++) {
      out.push({ cx: centerCx + dx, cy: centerCy + dy });
    }
  }
  return out;
}
