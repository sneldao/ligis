/**
 * `mm ligis assess` — the gate verdict without signing.
 *
 * Runs the same operation binding, mandate tightening, and strict decision
 * parsing as `ligis pay`, but never calls `ctx.walletExecutor`. Useful for
 * "what would the gate say" before consenting to a signature — the pay path
 * still re-assesses against a fresh decision before signing.
 */
import {
  CommandIO,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import {
  decisionConfidence,
  fetchDecision,
  parseOperation,
  parseOperatorPolicy,
  tightenWithAgentRequest,
} from "@ligis/wallet-plugin";
import { operationInputs } from "../../shared/inputs.js";
import { loadPolicyInput } from "../../shared/policy.js";
import { resolveOperation } from "../../shared/resolve.js";
import { defaultTransport } from "../../shared/transport.js";

type AssessResult =
  | {
      assessed: true;
      verdict: string;
      /** True only when a fresh GO ≥ the operator confidence floor — the condition `ligis pay` requires before signing. */
      wouldSign: boolean;
      confidenceMin: number;
      signals: Array<{ id: string; status: string; confidence: number }>;
      operation: {
        payee: string;
        amountUsd: number;
        chainId: number;
        fingerprint: string;
      };
    }
  | { assessed: false; refusal: { code: string; reason: string } };

export default class LigisAssess extends PluginCommand<AssessResult> {
  static override description =
    "Ask the Ligis gate whether this payment would pass, without signing anything.";

  // Assessment never touches the wallet — only the gate and the operator
  // policy. Pass --from explicitly when no wallet is initialized.
  static override requiresAuth = false;
  static override requiresInit = false;

  static override flags = schemaToFlags(operationInputs);
  static override args = schemaToArgs(operationInputs);

  protected readonly pluginCommandId = "ligis:assess";

  override async execute(io: CommandIO): Promise<AssessResult> {
    const resolved = await io.resolveInputs(operationInputs);
    const { request, agentRequest, purpose } = resolveOperation(
      this.ctx,
      resolved,
    );
    const policyInput = await loadPolicyInput(
      resolved.policy?.trim() || undefined,
    );

    let policy;
    try {
      policy = parseOperatorPolicy(policyInput);
    } catch (error) {
      return {
        assessed: false,
        refusal: {
          code: "policy-missing",
          reason: `operator policy is unusable: ${(error as Error).message}`,
        },
      };
    }

    const tightened = tightenWithAgentRequest(policy, agentRequest);
    if (!tightened.ok) {
      return {
        assessed: false,
        refusal: { code: "agent-policy-loosening", reason: tightened.reason },
      };
    }

    let operation;
    try {
      operation = parseOperation(request, tightened.policy, Date.now());
    } catch (error) {
      return {
        assessed: false,
        refusal: {
          code: "unsupported-operation",
          reason: (error as Error).message,
        },
      };
    }

    const result = await fetchDecision(
      operation,
      tightened.policy,
      purpose,
      defaultTransport,
    );
    if (!result.ok) {
      return {
        assessed: false,
        refusal: { code: result.code, reason: result.reason },
      };
    }
    const { decision } = result;
    const confidenceMin = decisionConfidence(decision);
    return {
      assessed: true,
      verdict: decision.verdict,
      wouldSign:
        decision.verdict === "GO" &&
        confidenceMin >= tightened.policy.minGoConfidence,
      confidenceMin,
      signals: decision.signals.map((s) => ({
        id: s.id,
        status: s.status,
        confidence: s.confidence,
      })),
      operation: {
        payee: operation.payee,
        amountUsd: operation.amountUsd,
        chainId: operation.chainId,
        fingerprint: operation.fingerprint,
      },
    };
  }
}
