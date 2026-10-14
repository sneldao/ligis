/**
 * @ligis/wallet-plugin — guarded payment adapter.
 *
 * Host mapping (MetaMask Agent Wallet, documented 2026-10-14): a plugin
 * command with the `wallet-submit` capability calls
 * `ctx.walletExecutor(io, "<command-id>")` and issues a `typed-data` request.
 * That executor call is the signing boundary this guard fronts — the guard's
 * `signer` dependency is structurally that request.
 *
 * The plugin lifecycle is sealed (`run`, `beforeExecute` and friends throw
 * `PLUGIN_SEALED_OVERRIDE`, and `oclif.hooks` manifests are rejected), so this
 * package cannot install a wallet-wide interceptor. It governs the guarded
 * command's own signing path. See `docs/wallet-enforcement.md`.
 */

export { createPaymentGuard } from "./guard.js";
export type { GuardDeps, PaymentGuard } from "./guard.js";
export { parseDecision, decisionConfidence } from "./decision.js";
export {
  baseUnitsToUsd,
  fingerprintOf,
  OperationError,
  parseOperation,
} from "./operation.js";
export {
  PolicyError,
  parseOperatorPolicy,
  tightenWithAgentRequest,
} from "./policy.js";
export {
  TRANSFER_WITH_AUTHORIZATION,
  type AgentRequest,
  type ApprovedAsset,
  type AuthorizationRequest,
  type GateDecision,
  type GateSignal,
  type GuardOutcome,
  type OperatorPolicy,
  type ParsedOperation,
  type RefusalCode,
  type Transport,
  type TypedDataSigner,
  type Verdict,
} from "./types.js";
