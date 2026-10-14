/**
 * The guard: the protected signing path.
 *
 * Order of operations, and why:
 *   1. Parse and bind the operation. A malformed, unsupported, or
 *      policy-violating authorization never reaches the network.
 *   2. Reject agent attempts to loosen policy.
 *   3. Ask the gate, and validate the answer strictly.
 *   4. Sign only on GO, only when the operation still hashes to the assessed
 *      fingerprint, and exactly once per operation.
 *
 * Idempotency: an identical operation replayed against the same guard returns
 * the recorded signature instead of signing again. Any mutation of a bound
 * field changes the fingerprint and therefore requires a fresh decision.
 */

import { decisionConfidence, fetchDecision } from "./decision.js";
import { OperationError, parseOperation } from "./operation.js";
import { parseOperatorPolicy, tightenWithAgentRequest } from "./policy.js";
import {
  TRANSFER_WITH_AUTHORIZATION,
  type AgentRequest,
  type AuthorizationRequest,
  type GateDecision,
  type GuardOutcome,
  type OperatorPolicy,
  type ParsedOperation,
  type Transport,
  type TypedDataSigner,
} from "./types.js";

export type GuardDeps = {
  /** Protected configuration. An unparseable policy disables signing. */
  policy: unknown;
  signer: TypedDataSigner;
  transport: Transport;
  /** Command id forwarded to the host executor, e.g. `ligis:pay`. */
  commandId?: string;
  now?: () => number;
};

export type PaymentGuard = {
  enforce(
    request: AuthorizationRequest,
    agentRequest?: AgentRequest,
  ): Promise<GuardOutcome>;
  policy(): OperatorPolicy;
};

export function createPaymentGuard(deps: GuardDeps): PaymentGuard {
  const now = deps.now ?? (() => Date.now());
  const commandId = deps.commandId ?? "ligis:pay";

  let policy: OperatorPolicy | null = null;
  let policyError: string | null = null;
  try {
    policy = parseOperatorPolicy(deps.policy);
  } catch (error) {
    policyError = (error as Error).message;
  }

  const signed = new Map<
    string,
    { signature: string; decision: GateDecision }
  >();

  return {
    policy() {
      if (!policy)
        throw new Error(`operator policy is unusable: ${policyError}`);
      return policy;
    },

    async enforce(request, agentRequest) {
      if (!policy) {
        return {
          ok: false,
          code: "policy-missing",
          reason: `operator policy is unusable: ${policyError}`,
        };
      }

      const tightened = tightenWithAgentRequest(policy, agentRequest);
      if (!tightened.ok) {
        return {
          ok: false,
          code: "agent-policy-loosening",
          reason: tightened.reason,
        };
      }
      const effective = tightened.policy;

      let operation: ParsedOperation;
      try {
        operation = parseOperation(request, effective, now());
      } catch (error) {
        return {
          ok: false,
          code:
            error instanceof OperationError
              ? "unsupported-operation"
              : "policy-refused",
          reason: (error as Error).message,
        };
      }

      const replay = signed.get(operation.fingerprint);
      if (replay) {
        return {
          ok: true,
          signature: replay.signature,
          operation,
          decision: replay.decision,
          idempotentReplay: true,
        };
      }

      const result = await fetchDecision(
        operation,
        effective,
        agentRequest?.purpose,
        deps.transport,
      );
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          reason: result.reason,
          operation,
        };
      }
      const decision = result.decision;

      if (decision.verdict !== "GO") {
        return {
          ok: false,
          code: "decision-not-go",
          reason: `gate returned ${decision.verdict}: ${summarize(decision)}`,
          operation,
          decision,
        };
      }
      const confidence = decisionConfidence(decision);
      if (confidence < effective.minGoConfidence) {
        return {
          ok: false,
          code: "decision-not-go",
          reason: `GO confidence ${confidence} is below the operator minimum ${effective.minGoConfidence}`,
          operation,
          decision,
        };
      }

      // Re-derive the operation immediately before signing. Anything that moved
      // between assessment and signing invalidates the approval.
      let current: ParsedOperation;
      try {
        current = parseOperation(request, effective, now());
      } catch (error) {
        return {
          ok: false,
          code: "stale-approval",
          reason: `operation changed after assessment: ${(error as Error).message}`,
        };
      }
      if (current.fingerprint !== operation.fingerprint) {
        return {
          ok: false,
          code: "stale-approval",
          reason:
            "operation fingerprint changed between assessment and signing",
        };
      }

      let signature: string;
      try {
        signature = await deps.signer({
          commandId,
          primaryType: "TransferWithAuthorization",
          domain: request.domain,
          types: TRANSFER_WITH_AUTHORIZATION as unknown as Record<
            string,
            Array<{ name: string; type: string }>
          >,
          message: request.authorization,
        });
      } catch (error) {
        return {
          ok: false,
          code: "signer-failed",
          reason: `signer refused or failed: ${(error as Error).message}`,
          operation,
          decision,
        };
      }

      signed.set(operation.fingerprint, { signature, decision });
      return {
        ok: true,
        signature,
        operation,
        decision,
        idempotentReplay: false,
      };
    },
  };
}

function summarize(decision: GateDecision): string {
  const nonGo = decision.signals.filter(
    (signal) => signal.status !== "GO" && signal.status !== "SKIPPED",
  );
  if (nonGo.length === 0) return "no signal explained the verdict";
  return nonGo
    .map(
      (signal) =>
        `${signal.id}=${signal.status}${signal.reason ? ` (${signal.reason})` : ""}`,
    )
    .join("; ");
}
