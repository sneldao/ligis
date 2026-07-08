import { loadCasperConfig } from "@ligis/adapter-casper";

/**
 * CROO CAP configuration.
 *
 * Values come from environment variables. Agent creation and service
 * registration happen in the CROO Dashboard (https://agent.croo.network);
 * the SDK only needs the SDK key and API endpoints.
 */
export interface CrooConfig {
  /** CROO API base URL, e.g. https://api.croo.network */
  apiURL: string;
  /** CROO WebSocket URL, e.g. wss://api.croo.network/ws */
  wsURL: string;
  /** CROO SDK key in croo_sk_... format */
  sdkKey: string;
  /** Target service ID when acting as a requester (optional) */
  targetServiceId?: string;
  /** Chain to use for Ligis verification: "casper" | "pharos" */
  ligisChain: "casper" | "pharos";
}

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadCrooConfig(): CrooConfig {
  return {
    apiURL: getEnv("CROO_API_URL", "https://api.croo.network"),
    wsURL: getEnv("CROO_WS_URL", "wss://api.croo.network/ws"),
    sdkKey: getEnv("CROO_SDK_KEY"),
    targetServiceId: process.env.CROO_TARGET_SERVICE_ID,
    ligisChain: (process.env.LIGIS_CHAIN as "casper" | "pharos") ?? "casper",
  };
}

/**
 * Load the Ligis chain adapter for the configured chain.
 *
 * Casper is loaded from environment via loadCasperConfig().
 * Pharos would be loaded similarly from @ligis/adapter-evm.
 */
export async function loadLigisAdapter() {
  const chain = process.env.LIGIS_CHAIN ?? "casper";
  if (chain === "casper") {
    const { CasperAdapter } = await import("@ligis/adapter-casper");
    return new CasperAdapter({ config: loadCasperConfig() });
  }
  if (chain === "pharos") {
    const { EvmAdapter } = await import("@ligis/adapter-evm");
    // TODO: wire pharos env loader when available
    return new EvmAdapter({} as never);
  }
  throw new Error(`Unsupported LIGIS_CHAIN: ${chain}`);
}
