import type { CatalogAgent } from "./agentSeed";

function bytesOf(addr: string): number[] {
  const hex = addr.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const out: number[] = [];
  for (let i = 0; i < 20; i++) out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return out;
}

export type CatalogPosition = {
  pos: [number, number, number];
  bobPhase: number;
  bobAmp: number;
  rotZ: number;
  rotX: number;
};

export type CatalogLayout = {
  width: number;
  height: number;
  depth: number;
  positions: CatalogPosition[];
};

export function layoutCatalog(agents: CatalogAgent[]): CatalogLayout {
  const COLS = 12;
  const ROWS = Math.ceil(agents.length / COLS);
  const X_SPAN = 42;
  const Y_SPAN = 24;
  const Z_RANGE = 14;
  const xCell = X_SPAN / Math.max(COLS - 1, 1);
  const yCell = Y_SPAN / Math.max(ROWS - 1, 1);

  const positions: CatalogPosition[] = agents.map((agent, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const b = bytesOf(agent.address);

    const baseX = col * xCell - X_SPAN / 2;
    const baseY = -row * yCell + Y_SPAN / 2;

    const jx = ((b[10]! - 128) / 255) * xCell * 1.1;
    const jy = ((b[11]! - 128) / 255) * yCell * 1.1;
    const jz = ((b[12]! - 128) / 255) * Z_RANGE;

    const bobPhase = (b[13]! / 255) * Math.PI * 2;
    const bobAmp = 0.06 + (b[14]! / 255) * 0.12;
    const rotZ = ((b[15]! - 128) / 255) * 0.06;
    const rotX = ((b[16]! - 128) / 255) * 0.04;

    return {
      pos: [baseX + jx, baseY + jy, jz],
      bobPhase,
      bobAmp,
      rotZ,
      rotX,
    };
  });

  return {
    width: X_SPAN + xCell * 0.5,
    height: Y_SPAN + yCell * 0.5,
    depth: Z_RANGE,
    positions,
  };
}
