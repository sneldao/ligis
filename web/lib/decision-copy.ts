/**
 * Plain-language copy for gate decisions and zk credential results.
 *
 * The API speaks in signals, nullifiers, and registry roots; a person
 * deciding whether to let an agent pay needs three things: the answer, why,
 * and what to do next. Pure (no React) so it is unit-tested and shared by
 * `/gate`, `/zcash`, and embeds.
 */
import type { Decision, Signal, ZkCredentialResult } from "./decide";

export type Verdict = Decision["verdict"];

export const SIGNAL_COPY: Record<
  Signal["id"],
  { label: string; question: string }
> = {
  "right-payee": {
    label: "Right payee",
    question: "Is this the payee the agent was contracted to pay?",
  },
  "right-amount": {
    label: "Right amount",
    question: "Is the amount within the agreed terms?",
  },
  "in-scope": {
    label: "In scope",
    question: "Does the payment match the job the agent was hired for?",
  },
  "verified-payee": {
    label: "Verified payee",
    question: "Does the payee hold a valid, unrevoked credential?",
  },
};

export const STATUS_COPY: Record<Signal["status"], string> = {
  GO: "passed",
  STOP: "failed",
  UNKNOWN: "couldn't be answered",
  SKIPPED: "not checked",
};

export type DecisionCopy = {
  headline: string;
  meaning: string;
  next: string;
};

export function explainDecision(
  d: Pick<Decision, "verdict" | "signals">,
): DecisionCopy {
  const stopped = d.signals.filter((s) => s.status === "STOP");
  const unknown = d.signals.filter((s) => s.status === "UNKNOWN");
  const skipped = d.signals.filter((s) => s.status === "SKIPPED");
  const list = (ss: Signal[]) =>
    ss.map((s) => SIGNAL_COPY[s.id].label.toLowerCase()).join(", ");
  if (d.verdict === "GO") {
    return {
      headline: "Safe to pay",
      meaning: skipped.length
        ? `Every check that ran passed. Not checked: ${list(skipped)}.`
        : "Every check passed.",
      next: "The agent may release this payment.",
    };
  }
  if (d.verdict === "STOP") {
    return {
      headline: "Don't pay",
      meaning: stopped.length
        ? `Failed: ${list(stopped)}.`
        : "The trust check did not pass.",
      next: "Do not send funds. Fix the failing check, or walk away from this payee.",
    };
  }
  return {
    headline: "Not enough to say yes",
    meaning: unknown.length
      ? `Couldn't answer: ${list(unknown)}. Unknown is never approval.`
      : "A required check didn't answer. Unknown is never approval.",
    next: "Hold the payment until the missing check can answer.",
  };
}

export type ZkCopy = {
  /** Short state, e.g. "Proof accepted". */
  title: string;
  /** What happened, in plain words. */
  plain: string;
  /** What the user should do. */
  next: string;
};

/** Map a zk result (and its technical reason) to plain language. */
export function explainZk(zk: ZkCredentialResult): ZkCopy {
  const r = zk.reason;
  if (zk.status === "GO") {
    return {
      title: "Proof accepted",
      plain:
        "The payee proved it holds a valid credential from a trusted issuer for this payment, without revealing who it is, who issued it, or which credential.",
      next: "This check passes. The proof is now used up for this payment.",
    };
  }
  if (zk.status === "UNKNOWN") {
    if (/stale/i.test(r)) {
      return {
        title: "Registry snapshot out of date",
        plain:
          "The gate's copy of the credential registry is too old to trust, so recent revocations might be missing. The proof was not counted.",
        next: "Republish the registry root, then retry.",
      };
    }
    if (/no trusted registry roots|not configured|manifest unusable/i.test(r)) {
      return {
        title: "This gate can't check private proofs",
        plain:
          "No trusted credential registry is configured here, so the proof was not counted.",
        next: "Use a gate configured with a published registry root.",
      };
    }
    return {
      title: "Proof not checked",
      plain:
        "This server couldn't run the proof verifier, so the proof was not counted. Unknown is not approval.",
      next: "Treat the payee as unverified, or retry on a gate with the verifier installed.",
    };
  }
  if (/replay|already used/i.test(r)) {
    return {
      title: "Replay blocked",
      plain:
        "This exact proof was already used. Each proof works once per payment, so a copied or replayed proof is refused.",
      next: "Don't pay on this proof. Ask the payee for a fresh one.",
    };
  }
  if (/not a trusted/i.test(r)) {
    return {
      title: "Revoked or unknown registry",
      plain:
        "The proof is mathematically valid, but against a registry snapshot the gate no longer trusts. That is what happens after a credential is revoked: it drops out of the published registry.",
      next: "Don't pay. The payee needs a credential in the current registry.",
    };
  }
  if (/different payee|not bound to this payee/i.test(r)) {
    return {
      title: "Proof belongs to someone else",
      plain:
        "This proof was made for a different payee address. A proof can't be moved to another recipient.",
      next: "Don't pay. Request a proof from the payee you are actually paying.",
    };
  }
  if (/different capability/i.test(r)) {
    return {
      title: "Wrong kind of credential",
      plain: "The proof is for a different permission than this payment needs.",
      next: "Ask for a proof for the permission this payment requires.",
    };
  }
  if (/older than|in the future/i.test(r)) {
    return {
      title: "Proof expired",
      plain:
        "Proofs are only good for a few minutes. This one is too old (or dated in the future).",
      next: "Ask the payee for a fresh proof.",
    };
  }
  if (/failed verification/i.test(r)) {
    return {
      title: "Proof is invalid",
      plain:
        "The proof doesn't check out mathematically. It was altered or forged.",
      next: "Don't pay.",
    };
  }
  return {
    title: "Proof rejected",
    plain: r,
    next: "Don't pay on this proof.",
  };
}

/** `0x1234…abcd` → `0x1234··abcd` (DESIGN.md mid-glyph). */
export function shortHash(h: string | undefined, head = 8, tail = 6): string {
  if (!h) return "—";
  return h.length <= head + tail + 2
    ? h
    : `${h.slice(0, head)}··${h.slice(-tail)}`;
}

/** Shorten long addresses inside free-text reasons (shielded ones are 70+ chars). */
export function compactAddresses(text: string): string {
  return text.replace(
    /\b(?:utest1|u1|zs1|ztestsapling1)[0-9a-z]{30,}\b|\b0x[0-9a-fA-F]{40,}\b/g,
    (m) => shortHash(m, 12, 6),
  );
}
