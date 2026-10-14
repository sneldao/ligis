/**
 * Public types for the guarded payment adapter.
 *
 * The adapter enforces one rule: an EIP-3009 authorization reaches the signer
 * only after a fresh, schema-valid GO for that exact operation, assessed under
 * protected operator policy. Every other outcome refuses.
 *
 * Nothing here trusts the caller. `AgentRequest` fields may tighten policy and
 * never loosen it, and the gate endpoint is never caller-selectable.
 */

export type Verdict = "GO" | "STOP" | "UNKNOWN";

/** A dollar-denominated asset the operator accepts, with its integer base units. */
export type ApprovedAsset = {
  /** ERC-20 contract address, lowercase-comparable. */
  address: string;
  /** Chain id the asset is accepted on. */
  chainId: number;
  /** Base units per token, from the token contract — never guessed. */
  decimals: number;
  /** Documented USD value of one whole token. Only 1 is supported today. */
  usdPeg: 1;
  symbol: string;
};

export type OperatorPolicy = {
  /** HTTPS origin of the gate, e.g. `https://gate.example`. */
  gateEndpoint: string;
  /** Accepted assets. An authorization for anything else is refused locally. */
  assets: ApprovedAsset[];
  /** Chain ids the operator permits. */
  chains: number[];
  /** Payees the operator permits. Empty means "no payee allowlist". */
  payees: string[];
  /** Hard ceiling for a single payment, in whole USD. */
  maxUsd: number;
  /** Longest validity window the operator will sign for, in seconds. */
  maxValiditySeconds: number;
  /** Capability the payee must hold. Null means "risk decision only". */
  requiredCapability: string | null;
  /** Milliseconds the guard waits for the gate before refusing. */
  gateTimeoutMs: number;
  /** Minimum confidence the gate must report on a GO. Bounded 0..1. */
  minGoConfidence: number;
};

export type AgentRequest = {
  /** Untrusted. Agent's stated reason for the payment. */
  purpose?: string;
  /**
   * Untrusted. May only tighten the operator policy: a lower cap, a longer
   * window, or an extra required capability. A request that tries to raise a
   * cap, widen the window, or drop a capability requirement is rejected.
   */
  mandate?: {
    maxUsd?: number;
    maxValiditySeconds?: number;
    requiredCapability?: string;
  };
};

export type AuthorizationRequest = {
  /** EIP-3009 `TransferWithAuthorization` fields, as the signer receives them. */
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType?: "TransferWithAuthorization";
};

export type ParsedOperation = {
  from: string;
  /** Normalized lowercase payee. */
  payee: string;
  /** Asset address, lowercase. */
  asset: string;
  chainId: number;
  /** Integer base units, as a decimal string. */
  valueBaseUnits: string;
  /** Whole-USD value derived from the configured decimals and peg. */
  amountUsd: number;
  validAfter: number;
  validBefore: number;
  /** 32-byte nonce, lowercase hex. */
  nonce: string;
  domainName: string;
  domainVersion: string;
  verifyingContract: string;
  /** Stable hash over every bound field above. */
  fingerprint: string;
};

export type GateSignal = {
  id: string;
  status: string;
  confidence: number;
  reason?: string;
};

export type GateDecision = {
  verdict: Verdict;
  signals: GateSignal[];
  latencyMs: number;
  provenance: string[];
};

export type RefusalCode =
  | "policy-missing"
  | "agent-policy-loosening"
  | "unsupported-operation"
  | "policy-refused"
  | "decision-unavailable"
  | "decision-malformed"
  | "decision-timeout"
  | "decision-not-go"
  | "stale-approval"
  | "signer-failed";

export type GuardOutcome =
  | {
      ok: true;
      signature: string;
      operation: ParsedOperation;
      decision: GateDecision;
      /** True when an identical operation was already signed by this guard. */
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      code: RefusalCode;
      reason: string;
      operation?: ParsedOperation;
      decision?: GateDecision;
    };

/**
 * The signing surface the guard calls. Structurally compatible with the
 * MetaMask Agent Wallet `walletExecutor` typed-data request
 * (`ctx.walletExecutor(io, commandId)` under the `wallet-submit` capability),
 * so the same guard fronts either an injected test signer or the host executor.
 */
export type TypedDataSigner = (request: {
  commandId: string;
  primaryType: "TransferWithAuthorization";
  domain: AuthorizationRequest["domain"];
  types: Record<string, Array<{ name: string; type: string }>>;
  message: AuthorizationRequest["authorization"];
}) => Promise<string>;

/** Minimal fetch shape, injectable so tests never open a socket. */
export type Transport = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "manual";
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
