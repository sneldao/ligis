import { keccak256, toBytes, type Address } from "viem";

const KNOWN_DEPLOYER: Address = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

export type CatalogAgent = {
  address: Address;
  origin: "deployer" | "phantom";
  index: number;
};

function phantomAt(i: number): Address {
  const hash = keccak256(toBytes(`ligis:phantom:${i.toString().padStart(3, "0")}`));
  return (`0x${hash.slice(-40)}`) as Address;
}

export function seedCatalog(count = 47): CatalogAgent[] {
  const list: CatalogAgent[] = [
    { address: KNOWN_DEPLOYER, origin: "deployer", index: 0 },
  ];
  for (let i = 1; i < count; i++) {
    list.push({ address: phantomAt(i), origin: "phantom", index: i });
  }
  return list;
}
