import { type Hex } from "viem";
import type { Address } from "./types.js";
/** Validate a string as an Ethereum address, throwing on bad input. */
export declare function parseAddress(s: string): Address;
/** Type guard: is this string a 32-byte hex value? */
export declare function isHexBytes32(s: string): s is Hex;
/** Compute keccak256 of a string and return as a 0x-prefixed 32-byte hex. */
export declare function capabilityHash(name: string): Hex;
/**
 * Resolve the project root by walking up from the compiled location.
 *
 * The `assets/networks.json` file is the source of truth for the project root.
 * Works whether the caller is the compiled `dist/cli/index.js`,
 * the compiled `dist/lib/util.js`, or the `tsx src/cli/index.ts` dev runner.
 */
export declare function findProjectRoot(): string;
/** Load the project root, the resolved network, and the matching deployment. */
export interface LoadedConfig {
    rootDir: string;
    networksFile: import("./types.js").NetworksFile;
    networkName: string;
    network: import("./types.js").Network;
    deployment: import("./types.js").Deployment;
}
export declare function loadConfig(): LoadedConfig;
