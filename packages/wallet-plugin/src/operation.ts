/**
 * Operation parsing and binding.
 *
 * The decision is bound to one immutable operation. Everything the signer will
 * act on — domain, chain, verifying contract, recipient, integer amount,
 * nonce, validity window — is derived here, hashed into a fingerprint, and
 * re-checked immediately before signing. Mutating any bound field changes the
 * fingerprint, which invalidates the approval.
 */

import { createHash } from "node:crypto";
import type {
  ApprovedAsset,
  AuthorizationRequest,
  OperatorPolicy,
  ParsedOperation,
} from "./types.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT256 = /^(0|[1-9][0-9]{0,77})$/;

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

function requireAddress(value: unknown, what: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new OperationError(`${what} is not an EVM address`);
  }
  return value.toLowerCase();
}

function requireUint(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !UINT256.test(value)) {
    throw new OperationError(`${what} must be an integer decimal string`);
  }
  return BigInt(value);
}

function requireBytes32(value: unknown, what: string): string {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    throw new OperationError(`${what} must be a 32-byte hex string`);
  }
  return value.toLowerCase();
}

function requireVersion(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new OperationError(`${what} must be a numeric string`);
  }
  return value;
}

function assetFor(
  policy: OperatorPolicy,
  chainId: number,
  verifyingContract: string,
): ApprovedAsset | undefined {
  return policy.assets.find(
    (asset) =>
      asset.chainId === chainId &&
      asset.address === verifyingContract.toLowerCase(),
  );
}

/** Base units → whole USD. Integer math only; no float accumulation. */
export function baseUnitsToUsd(asset: ApprovedAsset, value: bigint): number {
  const scale = 10n ** BigInt(asset.decimals);
  const whole = value / scale;
  const remainder = value % scale;
  if (remainder !== 0n) {
    throw new OperationError(
      `amount ${value} is not a whole number of ${asset.symbol}`,
    );
  }
  const usd = whole * BigInt(asset.usdPeg);
  if (usd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OperationError("amount exceeds the representable USD range");
  }
  return Number(usd);
}

export function fingerprintOf(fields: Record<string, string | number>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${String(fields[key])}`)
    .join("&");
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

export function parseOperation(
  request: AuthorizationRequest,
  policy: OperatorPolicy,
  now: number,
): ParsedOperation {
  if (request.primaryType !== undefined) {
    if (request.primaryType !== "TransferWithAuthorization") {
      throw new OperationError(
        `unsupported primaryType ${request.primaryType}; batched or opaque calls cannot use the guarded path`,
      );
    }
  }

  const domain = request.domain;
  if (typeof domain !== "object" || domain === null) {
    throw new OperationError("domain is required");
  }
  const chainId = domain.chainId;
  if (
    typeof chainId !== "number" ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0
  ) {
    throw new OperationError("domain.chainId must be a positive integer");
  }
  const domainName = str(domain.name, "domain.name");
  const domainVersion = requireVersion(domain.version, "domain.version");
  const verifyingContract = requireAddress(
    domain.verifyingContract,
    "domain.verifyingContract",
  );

  if (!policy.chains.includes(chainId)) {
    throw new OperationError(
      `chain ${chainId} is not permitted by operator policy`,
    );
  }
  const asset = assetFor(policy, chainId, verifyingContract);
  if (!asset) {
    throw new OperationError(
      `verifying contract ${verifyingContract} is not an approved asset on chain ${chainId}`,
    );
  }

  const auth = request.authorization;
  if (typeof auth !== "object" || auth === null) {
    throw new OperationError("authorization is required");
  }
  const from = requireAddress(auth.from, "authorization.from");
  const payee = requireAddress(auth.to, "authorization.to");
  const value = requireUint(auth.value, "authorization.value");
  const validAfter = requireUint(auth.validAfter, "authorization.validAfter");
  const validBefore = requireUint(
    auth.validBefore,
    "authorization.validBefore",
  );
  const nonce = requireBytes32(auth.nonce, "authorization.nonce");

  if (value <= 0n) {
    throw new OperationError("authorization.value must be positive");
  }
  if (from === payee) {
    throw new OperationError("authorization recipient equals the payer");
  }
  if (validBefore <= validAfter) {
    throw new OperationError("authorization validity window is empty");
  }
  if (validBefore <= BigInt(now)) {
    throw new OperationError("authorization has already expired");
  }
  if (validAfter > BigInt(now)) {
    throw new OperationError("authorization is not yet valid");
  }
  const windowSeconds = Number((validBefore - validAfter) / 1000n);
  if (windowSeconds > policy.maxValiditySeconds) {
    throw new OperationError(
      `authorization window ${windowSeconds}s exceeds the operator limit ${policy.maxValiditySeconds}s`,
    );
  }
  if (policy.payees.length > 0 && !policy.payees.includes(payee)) {
    throw new OperationError(`payee ${payee} is not on the operator allowlist`);
  }

  const amountUsd = baseUnitsToUsd(asset, value);
  if (amountUsd <= 0) {
    throw new OperationError("authorization is worth less than one USD");
  }
  if (amountUsd > policy.maxUsd) {
    throw new OperationError(
      `payment $${amountUsd} exceeds the operator cap $${policy.maxUsd}`,
    );
  }

  return {
    from,
    payee,
    asset: asset.address,
    chainId,
    valueBaseUnits: value.toString(),
    amountUsd,
    validAfter: Number(validAfter),
    validBefore: Number(validBefore),
    nonce,
    domainName,
    domainVersion,
    verifyingContract,
    fingerprint: fingerprintOf({
      asset: asset.address,
      chainId,
      domainName,
      domainVersion,
      from,
      nonce,
      payee,
      validAfter: Number(validAfter),
      validBefore: Number(validBefore),
      valueBaseUnits: value.toString(),
      verifyingContract,
    }),
  };
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperationError(`${what} is required`);
  }
  return value.trim();
}
