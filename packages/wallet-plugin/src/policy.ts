/**
 * Operator policy: the protected half of the decision.
 *
 * Policy is parsed strictly and fails closed — a malformed or incomplete policy
 * disables signing rather than degrading to a permissive default. Agent input
 * is merged afterwards through `tightenWithAgentRequest`, which can only narrow.
 */

import type { AgentRequest, OperatorPolicy } from "./types.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HTTPS = /^https:\/\/[^\s]+$/;
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PolicyError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PolicyError(`${what} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInt(value: unknown, what: string, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new PolicyError(`${what} must be an integer in 1..${max}`);
  }
  return value;
}

function boundedNumber(
  value: unknown,
  what: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new PolicyError(`${what} must be a finite number in ${min}..${max}`);
  }
  return value;
}

function addressList(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new PolicyError(`${what} must be an array of at most 256 addresses`);
  }
  return value.map((entry, index) => {
    const addr = str(entry, `${what}[${index}]`);
    if (!ADDRESS.test(addr)) {
      throw new PolicyError(`${what}[${index}] is not an EVM address`);
    }
    return addr.toLowerCase();
  });
}

export function parseOperatorPolicy(input: unknown): OperatorPolicy {
  const raw = record(input, "operator policy");

  const endpoint = str(raw.gateEndpoint, "gateEndpoint");
  if (!HTTPS.test(endpoint)) {
    throw new PolicyError("gateEndpoint must be an https URL");
  }
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new PolicyError("gateEndpoint is not a valid URL");
  }
  if (endpointUrl.username || endpointUrl.password) {
    throw new PolicyError("gateEndpoint must not embed credentials");
  }

  if (!Array.isArray(raw.assets) || raw.assets.length === 0) {
    throw new PolicyError("assets must list at least one accepted asset");
  }
  const assets = raw.assets.map((entry, index) => {
    const asset = record(entry, `assets[${index}]`);
    const address = str(asset.address, `assets[${index}].address`);
    if (!ADDRESS.test(address)) {
      throw new PolicyError(`assets[${index}].address is not an EVM address`);
    }
    const peg = asset.usdPeg;
    if (peg !== 1) {
      throw new PolicyError(
        `assets[${index}].usdPeg must be 1; a non-peg asset needs a priced source, not a guess`,
      );
    }
    return {
      address: address.toLowerCase(),
      chainId: positiveInt(
        asset.chainId,
        `assets[${index}].chainId`,
        2 ** 31 - 1,
      ),
      decimals: positiveInt(asset.decimals, `assets[${index}].decimals`, 36),
      usdPeg: 1 as const,
      symbol: str(asset.symbol, `assets[${index}].symbol`),
    };
  });

  if (!Array.isArray(raw.chains) || raw.chains.length === 0) {
    throw new PolicyError("chains must list at least one chain id");
  }
  const chains = raw.chains.map((entry, index) =>
    positiveInt(entry, `chains[${index}]`, 2 ** 31 - 1),
  );

  const requiredCapability =
    raw.requiredCapability === undefined || raw.requiredCapability === null
      ? null
      : (() => {
          const cap = str(raw.requiredCapability, "requiredCapability");
          if (!CAPABILITY.test(cap)) {
            throw new PolicyError(
              "requiredCapability is not a capability name",
            );
          }
          return cap;
        })();

  return {
    gateEndpoint: endpointUrl.origin,
    assets,
    chains,
    payees: addressList(raw.payees, "payees"),
    maxUsd: boundedNumber(raw.maxUsd, "maxUsd", 0, 1_000_000),
    maxValiditySeconds: positiveInt(
      raw.maxValiditySeconds,
      "maxValiditySeconds",
      86_400,
    ),
    requiredCapability,
    gateTimeoutMs: positiveInt(raw.gateTimeoutMs, "gateTimeoutMs", 60_000),
    minGoConfidence: boundedNumber(
      raw.minGoConfidence,
      "minGoConfidence",
      0,
      1,
    ),
  };
}

/**
 * Merge untrusted agent input into protected policy.
 *
 * Only narrowing is accepted. A mandate that raises the cap, extends the
 * validity window, or contradicts the required capability is refused outright
 * rather than silently ignored, so a caller cannot believe it relaxed policy.
 */
export function tightenWithAgentRequest(
  policy: OperatorPolicy,
  request: AgentRequest | undefined,
): { ok: true; policy: OperatorPolicy } | { ok: false; reason: string } {
  const mandate = request?.mandate;
  if (!mandate) return { ok: true, policy };

  if (mandate.maxUsd !== undefined) {
    if (!Number.isFinite(mandate.maxUsd) || mandate.maxUsd > policy.maxUsd) {
      return {
        ok: false,
        reason: `agent mandate maxUsd ${mandate.maxUsd} exceeds the operator cap ${policy.maxUsd}`,
      };
    }
  }
  if (
    mandate.maxValiditySeconds !== undefined &&
    mandate.maxValiditySeconds > policy.maxValiditySeconds
  ) {
    return {
      ok: false,
      reason: `agent mandate window ${mandate.maxValiditySeconds}s exceeds the operator limit ${policy.maxValiditySeconds}s`,
    };
  }
  if (
    mandate.requiredCapability !== undefined &&
    policy.requiredCapability !== null &&
    mandate.requiredCapability !== policy.requiredCapability
  ) {
    return {
      ok: false,
      reason: `agent mandate requires capability ${mandate.requiredCapability}, which the operator policy does not require`,
    };
  }

  return {
    ok: true,
    policy: {
      ...policy,
      ...(mandate.maxUsd !== undefined ? { maxUsd: mandate.maxUsd } : {}),
      ...(mandate.maxValiditySeconds !== undefined
        ? { maxValiditySeconds: mandate.maxValiditySeconds }
        : {}),
      ...(mandate.requiredCapability !== undefined
        ? { requiredCapability: mandate.requiredCapability }
        : {}),
    },
  };
}
