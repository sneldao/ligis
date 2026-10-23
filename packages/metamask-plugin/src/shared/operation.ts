/**
 * Build the EIP-3009 `TransferWithAuthorization` request the guard binds to.
 *
 * Validity fields are unix **seconds** — the EIP-3009 on-chain unit the guard
 * binds to (it converts the ms-epoch `now` once). `value` is a base-units
 * decimal string and must be a whole number of the asset's units — the guard
 * converts with `baseUnitsToUsd` and refuses fractional dollars.
 */
import { randomBytes } from "node:crypto";
import type { AuthorizationRequest } from "@ligis/wallet-plugin";

export interface OperationInput {
  from: string;
  payee: string;
  /** Base units, decimal string — e.g. "5000000" for 5 USDC @ 6 decimals. */
  value: string;
  /** EIP-3009 verifying contract (the token). */
  asset: string;
  chainId: number;
  domainName: string;
  domainVersion: string;
  /** Whole seconds the authorization stays valid; defaults to 300. */
  validForSeconds?: number;
  /** 0x-prefixed 32-byte nonce; random when omitted. */
  nonce?: string;
  /** Current time in ms — injectable for tests. */
  now?: number;
}

export function buildAuthorizationRequest(
  input: OperationInput,
): AuthorizationRequest {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const validFor = input.validForSeconds ?? 300;
  return {
    authorization: {
      from: input.from,
      to: input.payee,
      value: input.value,
      validAfter: String(nowSeconds),
      validBefore: String(nowSeconds + validFor),
      nonce: input.nonce ?? `0x${randomBytes(32).toString("hex")}`,
    },
    domain: {
      name: input.domainName,
      version: input.domainVersion,
      chainId: input.chainId,
      verifyingContract: input.asset,
    },
    primaryType: "TransferWithAuthorization",
  };
}
