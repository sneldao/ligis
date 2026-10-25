import "server-only";
import { isZcashShieldedAddress, ZcashChainAdapter } from "@ligis/core";
import {
  capabilities,
  type AgentSnapshot,
  type CapabilityChange,
  type CredentialView,
  type HeldCredential,
  type IssuanceLog,
} from "./chain";
import type { Hex } from "./chain-casper";

let _adapter: ZcashChainAdapter | null = null;

function adapter(): ZcashChainAdapter {
  if (!_adapter) {
    _adapter = new ZcashChainAdapter({ network: "zcash-testnet" });
  }
  return _adapter;
}

export function isZcashAddress(value: string): boolean {
  return isZcashShieldedAddress(value);
}

export async function readAgentId(): Promise<bigint> {
  // Shielded Zcash subjects do not mint enumerable public ERC-721 tokenIds.
  return 0n;
}

export async function readBlockNumber(): Promise<bigint> {
  return 0n;
}

export async function readTotalSupply(): Promise<bigint> {
  return 0n;
}

export async function isCapable(
  subject: string,
  capabilityHash: Hex,
): Promise<boolean> {
  const cap = capabilities.find(
    (c) => c.hash.toLowerCase() === capabilityHash.toLowerCase(),
  );
  const capId = cap?.id ?? capabilityHash;
  const result = await adapter().verifyCapability({
    subject,
    capability: capId,
  });
  return result.capable;
}

export async function isCapableMulti(
  subject: string,
  capabilityHashes: readonly Hex[],
): Promise<boolean[]> {
  return Promise.all(capabilityHashes.map((h) => isCapable(subject, h)));
}

export async function readCredential(
  subject: string,
  capabilityHash: Hex,
): Promise<CredentialView> {
  const cap = capabilities.find(
    (c) => c.hash.toLowerCase() === capabilityHash.toLowerCase(),
  );
  const capId = cap?.id ?? capabilityHash;
  const result = await adapter().verifyCapability({
    subject,
    capability: capId,
  });
  return {
    issuer: result.latest.issuer as Hex,
    issuedAt: BigInt(result.latest.issuedAt),
    expiresAt: BigInt(result.latest.expiresAt),
    revoked: result.latest.revoked,
    valid: result.latest.valid,
  };
}

export async function readAgentSnapshot(
  shieldedAddress: string,
): Promise<AgentSnapshot> {
  const views = await Promise.all(
    capabilities.map((c) =>
      readCredential(shieldedAddress, c.hash).catch(() => null),
    ),
  );
  const held: HeldCredential[] = [];
  capabilities.forEach((cap, i) => {
    const view = views[i];
    if (view && view.valid && !view.revoked) {
      held.push({ capability: cap, view });
    }
  });
  return {
    exists: held.length > 0,
    tokenId: 0n,
    controller: null,
    tokenUri: "",
    held,
  };
}

export async function readIssuerActivity(): Promise<IssuanceLog> {
  return {
    blockRange: { from: 0n, to: 0n },
    truncated: false,
    issuers: [],
    totalIssuances: 0,
    unavailable: false,
    source: "none",
  };
}

export async function readCapabilityHistory(): Promise<CapabilityChange[]> {
  return [];
}
