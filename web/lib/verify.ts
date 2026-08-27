import "server-only";

import { getAddress, type Hex } from "viem";
import type { ChainNetwork } from "./network";
import {
  capabilities,
  isCapable,
  readCredential,
  isValidAddress,
  isCasperChain,
} from "./chain-router";

export type VerificationOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      subject: string;
      capabilityId: string;
      capabilityHash: Hex;
      capable: boolean;
      issuer: `0x${string}` | null;
      expiresAt: bigint | null;
      revoked: boolean;
    };

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("verification timed out")), timeoutMs);
    }),
  ]);
}

/** Resolve a capability by id ("kyc.basic") or 0x hash. */
export function resolveCapability(ref: string) {
  return capabilities.find(
    (c) => c.id === ref || c.hash.toLowerCase() === ref.toLowerCase()
  );
}

export function subjectFormatError(chain: ChainNetwork): string {
  return isCasperChain(chain)
    ? "Invalid subject. Expected account-hash-... format for Casper."
    : "Invalid subject address. Expected 0x... format.";
}

/**
 * The one verification path every surface shares — home demo, /gate,
 * and the embed badge. Validates the subject for the active chain,
 * resolves the capability, runs isCapable, and reads the credential
 * details only when held.
 */
export async function verifySubject(
  chain: ChainNetwork,
  subjectRaw: string,
  capabilityRef: string,
  opts?: { timeoutMs?: number }
): Promise<VerificationOutcome> {
  const timeoutMs = opts?.timeoutMs ?? 6_000;

  const trimmed = subjectRaw.trim();
  if (!isValidAddress(chain, trimmed)) {
    return { ok: false, error: subjectFormatError(chain) };
  }
  const subject = isCasperChain(chain) ? trimmed : getAddress(trimmed);

  const cap = resolveCapability(capabilityRef.trim());
  if (!cap) {
    return {
      ok: false,
      error: `Unknown capability "${capabilityRef}". Available: ${capabilities.map((c) => c.id).join(", ")}.`,
    };
  }

  try {
    const capable = await withTimeout(isCapable(chain, subject, cap.hash), timeoutMs);
    if (!capable) {
      return {
        ok: true,
        subject,
        capabilityId: cap.id,
        capabilityHash: cap.hash,
        capable: false,
        issuer: null,
        expiresAt: null,
        revoked: false,
      };
    }
    const view = await withTimeout(
      readCredential(chain, subject, cap.hash),
      timeoutMs
    ).catch(() => null);
    return {
      ok: true,
      subject,
      capabilityId: cap.id,
      capabilityHash: cap.hash,
      capable: true,
      issuer: (view?.issuer as `0x${string}` | undefined) ?? null,
      expiresAt: view?.expiresAt ?? null,
      revoked: view?.revoked ?? false,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${chain.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
