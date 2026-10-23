/**
 * `mm ligis pay` — the guarded payment command.
 *
 * The command builds the EIP-3009 authorization, asks the Ligis gate under
 * protected operator policy, and reaches `ctx.walletExecutor` only after a
 * fresh, schema-valid GO bound to that exact operation. Every refusal path
 * returns a structured outcome instead of signing. The command's scope is its
 * own signing path — it does not intercept other wallet commands (the plugin
 * lifecycle is sealed; see docs/wallet-enforcement.md).
 */
import {
  CommandIO,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import {
  createPaymentGuard,
  decisionConfidence,
  type GuardOutcome,
} from "@ligis/wallet-plugin";
import { operationInputs } from "../../shared/inputs.js";
import { loadPolicyInput } from "../../shared/policy.js";
import { resolveOperation } from "../../shared/resolve.js";
import { defaultTransport } from "../../shared/transport.js";
import { executorSigner } from "../../shared/executor-signer.js";

type PayResult =
  | {
      signed: true;
      signature: string;
      idempotentReplay: boolean;
      operation: {
        payee: string;
        valueBaseUnits: string;
        amountUsd: number;
        chainId: number;
        fingerprint: string;
      };
      decision: { verdict: string; confidenceMin: number; latencyMs: number };
    }
  | {
      signed: false;
      refusal: { code: string; reason: string };
      decision?: { verdict: string };
    };

function toResult(outcome: GuardOutcome): PayResult {
  if (!outcome.ok) {
    return {
      signed: false,
      refusal: { code: outcome.code, reason: outcome.reason },
      ...(outcome.decision
        ? { decision: { verdict: outcome.decision.verdict } }
        : {}),
    };
  }
  const confidenceMin = decisionConfidence(outcome.decision);
  return {
    signed: true,
    signature: outcome.signature,
    idempotentReplay: outcome.idempotentReplay,
    operation: {
      payee: outcome.operation.payee,
      valueBaseUnits: outcome.operation.valueBaseUnits,
      amountUsd: outcome.operation.amountUsd,
      chainId: outcome.operation.chainId,
      fingerprint: outcome.operation.fingerprint,
    },
    decision: {
      verdict: outcome.decision.verdict,
      confidenceMin,
      latencyMs: outcome.decision.latencyMs,
    },
  };
}

export default class LigisPay extends PluginCommand<PayResult> {
  static override description =
    "Gate-checked payment: signs an EIP-3009 authorization only after the Ligis gate returns a fresh GO bound to this exact operation.";

  static override flags = schemaToFlags(operationInputs);
  static override args = schemaToArgs(operationInputs);

  protected readonly pluginCommandId = "ligis:pay";

  override async execute(io: CommandIO): Promise<PayResult> {
    const resolved = await io.resolveInputs(operationInputs);
    const { request, agentRequest } = resolveOperation(this.ctx, resolved);
    const policy = await loadPolicyInput(resolved.policy?.trim() || undefined);

    const executor = await this.ctx.walletExecutor(io, this.pluginCommandId);
    const guard = createPaymentGuard({
      policy,
      commandId: this.pluginCommandId,
      transport: defaultTransport,
      signer: executorSigner(executor, {
        intentSummary:
          resolved.purpose?.trim() ||
          `Pay ${resolved.value} base units to ${resolved.payee} via the Ligis gate`,
        signal: io.signal,
      }),
    });

    return toResult(await guard.enforce(request, agentRequest));
  }
}
