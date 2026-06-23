/**
 * Shared utilities for the Pharos Agent Identity Skill.
 * Used by both the CLI (src/cli/index.ts) and the MCP server (src/mcp/server.ts).
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { toBytes, toHex, type Hex } from "viem";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import type { Address } from "./types.js";

/** A regex that matches an EIP-55 checksummed or lowercase 20-byte address. */
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** A regex that matches a 32-byte hex string (0x + 64 hex chars). */
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Validate a string as an Ethereum address, throwing on bad input. */
export function parseAddress(s: string): Address {
  if (!ADDR_RE.test(s)) {
    throw new Error(`Invalid address: ${s}`);
  }
  return s as Address;
}

/** Type guard: is this string a 32-byte hex value? */
export function isHexBytes32(s: string): s is Hex {
  return BYTES32_RE.test(s);
}

/** Compute keccak256 of a string and return as a 0x-prefixed 32-byte hex. */
export function capabilityHash(name: string): Hex {
  return toHex(keccak_256(toBytes(name)));
}

/**
 * Resolve the project root by walking up from the compiled location.
 *
 * The `assets/networks.json` file is the source of truth for the project root.
 * Works whether the caller is the compiled `dist/cli/index.js`,
 * the compiled `dist/lib/util.js`, or the `tsx src/cli/index.ts` dev runner.
 */
export function findProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", ".."), // dist/lib -> project root
    path.resolve(here, ".."), // dist/cli -> project root (when caller is in dist/cli)
    process.cwd(),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "assets", "networks.json"))) {
      return c;
    }
  }
  return candidates[0];
}

/** Load the project root, the resolved network, and the matching deployment. */
export interface LoadedConfig {
  rootDir: string;
  networksFile: import("./types.js").NetworksFile;
  networkName: string;
  network: import("./types.js").Network;
  deployment: import("./types.js").Deployment;
}

export function loadConfig(): LoadedConfig {
  const rootDir = findProjectRoot();
  const networksFile: import("./types.js").NetworksFile = JSON.parse(
    fs.readFileSync(path.join(rootDir, "assets", "networks.json"), "utf-8")
  );
  const networkName = process.env.PHAROS_NETWORK || networksFile.defaultNetwork;
  const network = networksFile.networks[networkName];
  if (!network) {
    throw new Error(`Unknown network: ${networkName}`);
  }
  // Match deployment by chainId (so a custom anvil chain 31337 can be matched).
  let deployment: import("./types.js").Deployment | undefined;
  for (const dep of Object.values(networksFile.deployment)) {
    if (dep.chainId === network.chainId) {
      deployment = dep;
      break;
    }
  }
  if (!deployment) {
    deployment = networksFile.deployment[networkName];
  }
  if (!deployment) {
    throw new Error(
      `No deployment found for chainId ${network.chainId} (network: ${networkName}). ` +
        `Run scripts/deploy.sh first.`
    );
  }
  return { rootDir, networksFile, networkName, network, deployment };
}
