import "server-only";

import { getAddress, type Hex } from "viem";
import type { ChainNetwork } from "./network";
import {
  capabilities,
  isCapable,
  readCredential,
  isValidAddress,
  isCasperChain,
  isZcashChain,
} from "./chain-router";
import {
  subjectChainMismatch,
  type SubjectChainMismatch,
} from "./subject-format";

export type VerificationOutcome =
  | { ok: false; error: string; mismatch?: SubjectChainMismatch }
  | {
      ok: true;
      subject: string;
      capabilityId: string;
      capabilityHash: Hex;
      capable: boolean;
      issuer: `0x${string}` | null;
      expiresAt: bigint | null;
      revoked: boolean;
      /** True when the credential's issuer is the same as the subject (self-issued). */
      selfIssued?: boolean;
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
    (c) => c.id === ref || c.hash.toLowerCase() === ref.toLowerCase(),
  );
}

export function subjectFormatError(chain: ChainNetwork): string {
  if (isCasperChain(chain)) {
    return "Invalid subject. Expected account-hash-... format for Casper.";
  }
  if (isZcashChain(chain)) {
    return "Invalid subject. Expected a Zcash shielded address (u1…, utest1…, zs1…, or ztestsapling1…).";
  }
  return "Invalid subject address. Expected 0x... format.";
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
  opts?: { timeoutMs?: number },
): Promise<VerificationOutcome> {
  const timeoutMs = opts?.timeoutMs ?? 6_000;

  const trimmed = subjectRaw.trim();
  if (!isValidAddress(chain, trimmed)) {
    const mismatch = subjectChainMismatch(chain, trimmed);
    return {
      ok: false,
      error: mismatch ? mismatch.message : subjectFormatError(chain),
      mismatch: mismatch ?? undefined,
    };
  }
  const subject =
    isCasperChain(chain) || isZcashChain(chain) ? trimmed : getAddress(trimmed);

  const cap = resolveCapability(capabilityRef.trim());
  if (!cap) {
    return {
      ok: false,
      error: `Unknown capability "${capabilityRef}". Available: ${capabilities.map((c) => c.id).join(", ")}.`,
    };
  }

  try {
    // Both reads are independent — run them concurrently so a gate verdict
    // costs one RPC round trip, not two. A false isCapable may still mean a
    // credential exists (revoked or expired), so the view read is needed in
    // every branch to name the STOP reason.
    const [capable, view] = await Promise.all([
      withTimeout(isCapable(chain, subject, cap.hash), timeoutMs),
      withTimeout(readCredential(chain, subject, cap.hash), timeoutMs).catch(
        () => null,
      ),
    ]);
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const hasCredential =
      view != null &&
      view.issuer != null &&
      view.issuer.toLowerCase() !== ZERO_ADDRESS;
    const resolvedIssuer = hasCredential
      ? (view!.issuer as `0x${string}`)
      : ((view?.issuer as `0x${string}` | undefined) ?? null);

    // Self-issued check: if issuer === subject (case-insensitive), the
    // credential is not trustworthy regardless of its technical validity.
    // On EVM chains, issuer and subject are both 0x hex addresses.
    // On Casper, the issuer is stored as a 0x hex address (EVM-compatible)
    // while the subject is account-hash-.... We compare by extracting the
    // known deployer/steward identities.
    const isSelfIssuedEvm =
      resolvedIssuer !== null &&
      resolvedIssuer.toLowerCase() === subject.toLowerCase();

    // Casper: subject is an account-hash-..., issuer is stored as 0x...
    // Self-issued means: subject == deployer account hash AND issuer ==
    // deployer's EVM address (same secp256k1 key on both chains).
    const casperDeployerAccountHash =
      process.env.LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH ?? undefined;
    const casperDeployerEvmAddress =
      process.env.LIGIS_CASPER_DEPLOYER_EVM_ADDRESS ?? undefined;
    if (
      isCasperChain(chain) &&
      (!casperDeployerAccountHash || !casperDeployerEvmAddress)
    ) {
      console.warn(
        "[verify] Casper self-issued check skipped: set " +
          "LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH and " +
          "LIGIS_CASPER_DEPLOYER_EVM_ADDRESS (see AGENTS.md Vercel env vars).",
      );
    }
    const isSelfIssuedCasper =
      isCasperChain(chain) &&
      subject.toLowerCase() ===
        (casperDeployerAccountHash ?? "").toLowerCase() &&
      resolvedIssuer !== null &&
      resolvedIssuer.toLowerCase() ===
        (casperDeployerEvmAddress ?? "").toLowerCase();

    const selfIssued = isSelfIssuedEvm || isSelfIssuedCasper;
    if (!capable) {
      return {
        ok: true,
        subject,
        capabilityId: cap.id,
        capabilityHash: cap.hash,
        capable: false,
        issuer: resolvedIssuer,
        expiresAt: hasCredential ? view!.expiresAt : null,
        revoked: hasCredential ? view!.revoked : false,
        selfIssued,
      };
    }
    return {
      ok: true,
      subject,
      capabilityId: cap.id,
      capabilityHash: cap.hash,
      capable: !selfIssued,
      issuer: resolvedIssuer,
      expiresAt: view?.expiresAt ?? null,
      revoked: view?.revoked ?? false,
      selfIssued,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Read failed against ${chain.name}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
