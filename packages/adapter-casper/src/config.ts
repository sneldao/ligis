/**
 * Casper network configuration.
 *
 * Default points at Casper Testnet via the public archival node. Override with
 * env vars (LIGIS_CASPER_RPC_URL, LIGIS_CASPER_NETWORK) or by passing
 * `CasperAdapterOptions.config` at construction.
 *
 * For production-grade access (rate limits, low latency, SSE), use CSPR.cloud:
 *   https://node.testnet.cspr.cloud/rpc   (requires CSPR_CLOUD_TOKEN auth header)
 *   https://node.cspr.cloud/rpc           (mainnet)
 */

export interface CasperNetwork {
  /** Casper chain name: "casper-test" (testnet) or "casper" (mainnet). */
  chainName: "casper-test" | "casper";
  /** Human-readable name. */
  displayName: string;
  /** JSON-RPC endpoint URL. */
  rpcUrl: string;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Optional CSPR.cloud auth token (Bearer). */
  authToken?: string;
}

export interface CasperDeployment {
  /** Hex package hash (contract-package-wasm...) of the credential registry. */
  credentialRegistry?: string;
  /** Hex package hash of the agent identity contract. */
  agentId?: string;
  /** Hex package hash of the outcome feed (reputation receipts). */
  outcomeFeed?: string;
  /** Hex package hash of the policy guard (spend enforcement). */
  policyGuard?: string;
  /** CEP-18 token used for x402 payments, if any. */
  x402Token?: string;
  /** Hex account hash of the deployer. */
  deployer?: string;
  /** Unix seconds of deployment, if known. */
  deployedAt?: string;
}

export interface CasperConfig {
  network: CasperNetwork;
  deployment: CasperDeployment;
}

const TESTNET: CasperNetwork = {
  chainName: "casper-test",
  displayName: "Casper Testnet",
  rpcUrl: "https://node.testnet.casper.network/rpc",
  explorerUrl: "https://testnet.cspr.live",
};

const MAINNET: CasperNetwork = {
  chainName: "casper",
  displayName: "Casper Mainnet",
  rpcUrl: "https://node.casper.network/rpc",
  explorerUrl: "https://cspr.live",
};

/**
 * Resolve the Casper config from env. Order of precedence:
 *
 *   LIGIS_CASPER_NETWORK = "testnet" | "mainnet"   (default: testnet)
 *   LIGIS_CASPER_RPC_URL = override RPC
 *   LIGIS_CASPER_AUTH    = CSPR.cloud bearer token
 *   LIGIS_CASPER_CREDENTIAL_REGISTRY = deployed contract package hash
 *   LIGIS_CASPER_AGENT_ID            = deployed contract package hash
 *   LIGIS_CASPER_X402_TOKEN          = CEP-18 token package hash for x402
 */
export function loadCasperConfig(): CasperConfig {
  const which = (process.env.LIGIS_CASPER_NETWORK ?? "testnet").toLowerCase();
  const base = which === "mainnet" ? MAINNET : TESTNET;
  const network: CasperNetwork = {
    ...base,
    rpcUrl: process.env.LIGIS_CASPER_RPC_URL ?? base.rpcUrl,
    authToken: process.env.LIGIS_CASPER_AUTH || undefined,
  };
  const deployment: CasperDeployment = {
    credentialRegistry: process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY,
    agentId: process.env.LIGIS_CASPER_AGENT_ID,
    outcomeFeed: process.env.LIGIS_CASPER_OUTCOME_FEED,
    policyGuard: process.env.LIGIS_CASPER_POLICY_GUARD,
    x402Token: process.env.LIGIS_CASPER_X402_TOKEN,
    deployer: process.env.LIGIS_CASPER_DEPLOYER,
  };
  return { network, deployment };
}
