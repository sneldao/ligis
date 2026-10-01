import "server-only";

import { CHAINS, MONAD_TESTNET, type ChainNetwork } from "./network";
import { detectSubjectKind } from "./subject-format";
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
): Promise<SubjectResolution> {
  const candidates = candidateChains(subjectRaw);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        "Unrecognised subject. Expected an EVM address (0x…) or a Casper account-hash-….",
    };
  }

  const cap = resolveCapability(capabilityRef.trim());
  if (!cap) {
    // Let verifySubject produce the canonical "unknown capability" message.
    const outcome = await verifySubject(
      candidates[0]!,
      subjectRaw,
      capabilityRef,
    );
    return { ok: false, error: outcome.ok ? "" : outcome.error };
  }

  const verdicts: ChainVerdict[] = await Promise.all(
    candidates.map(async (chain) => ({
      chain,
      outcome: await verifySubject(chain, subjectRaw, capabilityRef),
    })),
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

  return {
    ok: true,
    subject: primary.outcome.subject,
    capabilityId: cap.id,
    verdicts,
    capable: okReads.some((v) => v.outcome.capable),
    primary,
  };
}
