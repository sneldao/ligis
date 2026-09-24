import { keccak256, toBytes, type Address } from "viem";

export type CatalogOrigin = "live" | "phantom" | "deployer";

export type CatalogAgent = {
  address: string;
  origin: CatalogOrigin;
  index: number;
  tokenId?: string;
};

const KNOWN_DEPLOYER: Address = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

function phantomAt(i: number): Address {
  const hash = keccak256(
    toBytes(`ligis:phantom:${i.toString().padStart(3, "0")}`),
  );
  return `0x${hash.slice(-40)}` as Address;
}

/** Offline fallback when the live registry has not loaded yet. */
export function seedCatalog(count = 47): CatalogAgent[] {
  const list: CatalogAgent[] = [
    { address: KNOWN_DEPLOYER, origin: "deployer", index: 0 },
  ];
  for (let i = 1; i < count; i++) {
    list.push({ address: phantomAt(i), origin: "phantom", index: i });
  }
  return list;
}

export function isInteractiveAgent(agent: CatalogAgent): boolean {
  return agent.origin === "live" || agent.origin === "deployer";
}
