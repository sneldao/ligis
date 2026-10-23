/**
 * Turn resolved command inputs into the guard's request pair:
 * the EIP-3009 `AuthorizationRequest` it binds to, and the untrusted
 * `AgentRequest` that may only tighten the operator policy.
 */
import {
  CommandError,
  type PluginCommandContext,
} from "@metamask/agent-wallet/plugin";
import type { AgentRequest } from "@ligis/wallet-plugin";
import { buildAuthorizationRequest } from "./operation.js";
import { selectedEvmAddress } from "./wallet.js";
import type { operationInputs } from "./inputs.js";

type Resolved = Record<keyof typeof operationInputs, string | undefined>;

function requireText(value: string | undefined, flag: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError(
      "MISSING_INPUT",
      `missing --${flag}`,
      `Pass --${flag} or answer the interactive prompt.`,
    );
  }
  return value.trim();
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new CommandError(
      "INVALID_INPUT",
      `--${flag} must be a positive integer`,
      `Got ${JSON.stringify(value)}.`,
    );
  }
  return Number.parseInt(value.trim(), 10);
}

export function resolveOperation(
  ctx: PluginCommandContext,
  resolved: Resolved,
): {
  request: ReturnType<typeof buildAuthorizationRequest>;
  agentRequest: AgentRequest;
  purpose?: string;
} {
  const chainId = parsePositiveInt(resolved.chainId, "chain-id");
  const from = (resolved.from?.trim() ?? "") || selectedEvmAddress(ctx) || "";
  if (!from) {
    throw new CommandError(
      "MISSING_INPUT",
      "no payer address",
      "Pass --from 0x… or select an EVM account in the wallet.",
    );
  }

  const request = buildAuthorizationRequest({
    from,
    payee: requireText(resolved.payee, "payee"),
    value: requireText(resolved.value, "value"),
    asset: requireText(resolved.asset, "asset"),
    chainId,
    domainName: resolved.domainName?.trim() || "USD Coin",
    domainVersion: resolved.domainVersion?.trim() || "2",
    ...(resolved.validFor !== undefined
      ? { validForSeconds: parsePositiveInt(resolved.validFor, "valid-for") }
      : {}),
    ...(resolved.nonce ? { nonce: resolved.nonce.trim() } : {}),
  });

  const purpose = resolved.purpose?.trim() || undefined;
  const mandate: NonNullable<AgentRequest["mandate"]> = {};
  if (resolved.mandateMaxUsd !== undefined) {
    mandate.maxUsd = parsePositiveInt(
      resolved.mandateMaxUsd,
      "mandate-max-usd",
    );
  }
  if (resolved.mandateMaxSeconds !== undefined) {
    mandate.maxValiditySeconds = parsePositiveInt(
      resolved.mandateMaxSeconds,
      "mandate-max-seconds",
    );
  }
  if (resolved.mandateCapability !== undefined) {
    mandate.requiredCapability = resolved.mandateCapability.trim();
  }
  const agentRequest: AgentRequest = {
    ...(purpose ? { purpose } : {}),
    ...(Object.keys(mandate).length > 0 ? { mandate } : {}),
  };

  return purpose !== undefined
    ? { request, agentRequest, purpose }
    : { request, agentRequest };
}
