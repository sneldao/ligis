/**
 * Project-root config loader.
 *
 * `assets/networks.json` at the project root is the single source of truth
 * for network endpoints and deployment addresses across all chains. Each
 * chain adapter reads its own slice; this module just locates and parses
 * the file.
 */
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import type { Deployment, Network, NetworksFile } from "./types.js";

/**
 * Walk up from this module's compiled location to find the project root.
 * Works whether the caller is in `packages/<core>/dist/...` or run via tsx from src.
 */
export function findProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", ".."), // packages/core/dist/* → root
    path.resolve(here, "..", "..", ".."),       // packages/core/src    → root
    path.resolve(here, "..", ".."),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "assets", "networks.json"))) return c;
  }
  return process.cwd();
}

export interface LoadedConfig {
  rootDir: string;
  networksFile: NetworksFile;
  networkName: string;
  network: Network;
  deployment: Deployment;
}

/**
 * Load networks.json and resolve the active network + deployment.
 *
 * The active network is chosen by (in order):
 *   1. `LIGIS_NETWORK` env var (preferred — chain-agnostic)
 *   2. `PHAROS_NETWORK` env var (legacy)
 *   3. `defaultNetwork` field in networks.json
 */
export function loadConfig(): LoadedConfig {
  const rootDir = findProjectRoot();
  const networksFile: NetworksFile = JSON.parse(
    fs.readFileSync(path.join(rootDir, "assets", "networks.json"), "utf-8"),
  );
  const networkName =
    process.env.LIGIS_NETWORK ||
    process.env.PHAROS_NETWORK ||
    networksFile.defaultNetwork;
  const network = networksFile.networks[networkName];
  if (!network) throw new Error(`Unknown network: ${networkName}`);

  // Match deployment by chainId so a custom local chain (e.g. anvil 31337)
  // can be resolved even if the network alias differs from the deployment key.
  let deployment: Deployment | undefined;
  for (const dep of Object.values(networksFile.deployment)) {
    if (dep.chainId === network.chainId) {
      deployment = dep;
      break;
    }
  }
  if (!deployment) deployment = networksFile.deployment[networkName];
  if (!deployment) {
    throw new Error(
      `No deployment found for chainId ${network.chainId} (network: ${networkName}). ` +
        `Run scripts/deploy.sh first.`,
    );
  }
  return { rootDir, networksFile, networkName, network, deployment };
}
