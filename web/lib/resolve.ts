import "server-only";

import {
  CHAINS,
  MONAD_TESTNET,
  ZCASH_TESTNET,
  type ChainNetwork,
} from "./network";
import { detectSubjectKind } from "./subject-format";
import { readCredential } from "./chain-router";
import { boundedRead, evidenceTimeout } from "./payee-evidence/types";
import {
  resolveCapability,
  verifySubject,
  type VerificationOutcome,
} from "./verify";

export type ChainVerdict = {
  chain: ChainNetwork;
  outcome: VerificationOutcome;
};

export type SubjectResolution =
  | { ok: false; error: string }
  | {
      ok: true;
      subject: string;
      capabilityId: string;
      /** Every chain queried, in display order. */
      verdicts: ChainVerdict[];
      /** True when any live registry holds a valid credential. */
      capable: boolean;
      /** True when the credential's issuer is the same as the subject (self-issued). */
      selfIssued?: boolean;
      /** The verdict to feature — the vouching chain, else most informative. */
      primary: ChainVerdict;
    };

/**
 * The registries a subject can live on, derived from the address format.
 * A 0x address is portable across every EVM deployment; an account-hash
 * exists only on Casper. Monad is ordered first among EVM candidates — it
 * carries the richest provenance (ERC-8004, passkey issuance).
 */
export function candidateChains(subjectRaw: string): ChainNetwork[] {
  const kind = detectSubjectKind(subjectRaw);
  if (kind === "evm") {
    return CHAINS.filter((c) => c.kind === "evm" && c.live).sort((a) =>
      a.id === MONAD_TESTNET.id ? -1 : 1,
    );
  }
  if (kind === "casper") {
    return CHAINS.filter((c) => c.kind === "casper" && c.live);
  }
  if (kind === "zcash") {
    return ZCASH_TESTNET.live ? [ZCASH_TESTNET] : [];
  }
  return [];
}

/**
 * Chain-agnostic gate read: resolve the subject across every registry it
 * could live on, in parallel. Union semantics — a credential recorded on any
 * registry is a valid credential (the capability hash and issuer signature
 * are the claim; the registry is just the ledger). Chains that error are
 * reported in `verdicts` rather than failing the whole read, unless every
 * candidate failed.
 */
export async function resolveSubject(
  subjectRaw: string,
  capabilityRef: string,
  options?: {
    evidenceMode?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    verify?: typeof verifySubject;
    confirmCredential?: typeof readCredential;
  },
): Promise<SubjectResolution> {
  const verify = options?.verify ?? verifySubject;
  const candidates = candidateChains(subjectRaw);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        "Unrecognised subject. Expected an EVM address (0x…), a Casper account-hash-…, or a Zcash shielded address (u1…/utest1…/zs1…).",
    };
  }

  const cap = resolveCapability(capabilityRef.trim());
  if (!cap) {
    // Let verifySubject produce the canonical "unknown capability" message.
    const outcome = await verify(candidates[0]!, subjectRaw, capabilityRef);
    return { ok: false, error: outcome.ok ? "" : outcome.error };
  }

  const verdicts: ChainVerdict[] = await Promise.all(
    candidates.map(async (chain) => {
      const read = async (signal?: AbortSignal): Promise<ChainVerdict> => {
        signal?.throwIfAborted();
        const outcome = await verify(chain, subjectRaw, capabilityRef);
        signal?.throwIfAborted();
        if (
          options?.evidenceMode &&
          outcome.ok &&
          !outcome.revoked &&
          !outcome.selfIssued
        ) {
          // verifySubject intentionally swallows metadata errors in legacy mode.
          // In open-world mode, absence requires a successful credential-view read.
          if (chain.kind === "casper" && !outcome.capable) {
            return {
              chain,
              outcome: {
                ok: false as const,
                error:
                  "Casper adapter cannot distinguish missing credential metadata from unavailable reads",
              },
            };
          }
          try {
            const view = await boundedRead(
              () =>
                (options.confirmCredential ?? readCredential)(
                  chain,
                  outcome.subject,
                  outcome.capabilityHash,
                ),
              4_000,
              signal,
            );
            return {
              chain,
              outcome: {
                ...outcome,
                issuer: view.issuer,
                expiresAt: view.expiresAt,
                revoked: view.revoked,
                selfIssued:
                  outcome.selfIssued ||
                  view.issuer.toLowerCase() === outcome.subject.toLowerCase(),
                capable:
                  outcome.capable &&
                  view.valid &&
                  !view.revoked &&
                  view.issuer.toLowerCase() !== outcome.subject.toLowerCase(),
              },
            };
          } catch {
            return {
              chain,
              outcome: {
                ok: false as const,
                error: "credential metadata read unavailable",
              },
            };
          }
        }
        return { chain, outcome };
      };
      if (!options?.evidenceMode) return read();
      // Per-rail bounds retain early negatives when a different rail stalls.
      try {
        return await boundedRead(
          read,
          Math.max(1, evidenceTimeout(options.timeoutMs) - 50),
          options.signal,
        );
      } catch {
        return {
          chain,
          outcome: {
            ok: false as const,
            error: "credential rail unavailable or timed out",
          },
        };
      }
    }),
  );

  const reads = verdicts.filter((v) => v.outcome.ok);
  if (reads.length === 0) {
    const first = verdicts[0]!.outcome;
    return {
      ok: false,
      error: first.ok ? "" : first.error,
    };
  }

  const okReads = reads.filter(
    (
      v,
    ): v is ChainVerdict & {
      outcome: Extract<VerificationOutcome, { ok: true }>;
    } => v.outcome.ok,
  );
  const primary =
    okReads.find((v) => v.outcome.capable) ??
    okReads.find((v) => v.outcome.revoked) ??
    okReads[0]!;

  // Self-issued check: if issuer === subject, the credential is not trustworthy.
  const normalizedSubject = subjectRaw.toLowerCase();
  const selfIssued =
    primary.outcome.issuer !== null &&
    primary.outcome.issuer.toLowerCase() === normalizedSubject;

  return {
    ok: true,
    subject: primary.outcome.subject,
    capabilityId: cap.id,
    verdicts,
    capable: okReads.some((v) => v.outcome.capable) && !selfIssued,
    selfIssued,
    primary,
  };
}
