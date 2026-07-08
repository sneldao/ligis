/**
 * @ligis/adapter-casper — ChainAdapter implementation for Casper Network.
 *
 * CasperAdapter satisfies the ChainAdapter contract. Operations talk to
 * the Odra contracts in packages/contracts-casper via casper-js-sdk.
 * Set LIGIS_CASPER_CREDENTIAL_REGISTRY and LIGIS_CASPER_AGENT_ID env vars
 * to the deployed contract package hashes.
 */
export * from "./adapter.js";
export { CasperAdapter, CasperAdapter as default } from "./adapter.js";

export {
  loadCasperConfig,
  type CasperConfig,
  type CasperNetwork,
  type CasperDeployment,
} from "./config.js";

export { buildCasperClient, type CasperClientContext } from "./client.js";

export { loadSigner, callStoredContractViaCli, type Signer } from "./signer.js";

export { getBalance } from "./operations.js";
