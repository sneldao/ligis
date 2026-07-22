/**
 * @ligis/adapter-0g — ChainAdapter implementation for 0G Chain.
 *
 * 0G Chain is EVM-compatible, so this package is a thin network-specific
 * wrapper around @ligis/adapter-evm. It pins the active network to one of the
 * 0G networks defined in assets/networks.json and re-exports the EVM operations
 * so callers can use 0G-specific types when needed.
 */
export { ZeroGAdapter, createZeroGAdapter, type ZeroGAdapterOptions } from "./adapter.js";
export { ZeroGAdapter as default } from "./adapter.js";

// Re-export EVM operations and helpers so consumers don't need to depend on
// both @ligis/adapter-evm and @ligis/adapter-0g.
export {
  buildClientContext,
  requireWallet,
  type ClientContext,
  parseAddress,
} from "@ligis/adapter-evm";
