/**
 * @ligis/adapter-evm — ChainAdapter implementation for EVM-compatible chains.
 *
 * Primary export: {@link EvmAdapter} (and the {@link createEvmAdapter} factory).
 *
 * The raw viem-based operations (issueId, verify, signCredential, ...) are
 * also re-exported for the few call sites — CLI dry-run paths, tests — that
 * still need direct, EVM-typed access. Prefer the adapter for new code.
 */
export * from "./adapter.js";
export { EvmAdapter, EvmAdapter as default } from "./adapter.js";

// EVM-typed operations (use when chain-neutral ChainAdapter shape is insufficient)
export * from "./operations.js";

// ABIs (for callers like web/ that read directly via viem)
export * from "./abi.js";

// Client bootstrap (for callers that still want the raw viem ClientContext)
export {
  buildClientContext,
  requireWallet,
  type ClientContext,
} from "./client.js";

// EVM-only helpers
export { parseAddress } from "./address.js";

// External attestation sources
export * from "./eas.js";
