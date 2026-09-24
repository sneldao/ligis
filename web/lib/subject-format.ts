/**
 * Detect pasted subject formats that belong on another chain kind.
 * Client-safe — used by /gate, VerifyDemo, and verifySubject.
 */
import { CASPER_TESTNET, PHAROS_ATLANTIC, type ChainNetwork } from "./network";

export type SubjectKind = "evm" | "casper" | "unknown";

export function detectSubjectKind(raw: string): SubjectKind {
  const t = raw.trim();
  if (!t) return "unknown";
  if (/^account-hash-[a-fA-F0-9]{64}$/i.test(t)) return "casper";
  if (/^0[12][a-fA-F0-9]{64}$/i.test(t) || /^0x0[12][a-fA-F0-9]{64}$/i.test(t))
    return "casper";
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return "evm";
  return "unknown";
}

export type SubjectChainMismatch = {
  /** Plain-language explanation. */
  message: string;
  suggestedChainId: string;
  suggestedChainName: string;
};

/**
 * If `subject` looks valid for a different chain kind than `current`, return
 * a switch suggestion. Returns null when the format matches, or is unknown.
 *
 * EVM addresses cannot be attributed to Pharos vs Monad — we suggest Pharos
 * (primary EVM demo) when switching away from Casper.
 */
export function subjectChainMismatch(
  current: ChainNetwork,
  subjectRaw: string,
): SubjectChainMismatch | null {
  const kind = detectSubjectKind(subjectRaw);
  if (kind === "unknown") return null;

  if (kind === "casper" && current.kind === "evm") {
    return {
      message: `That looks like a Casper account hash, not an ${current.shortName} address.`,
      suggestedChainId: CASPER_TESTNET.id,
      suggestedChainName: CASPER_TESTNET.name,
    };
  }

  if (kind === "evm" && current.kind === "casper") {
    return {
      message:
        "That looks like an EVM address (0x…), not a Casper account-hash.",
      suggestedChainId: PHAROS_ATLANTIC.id,
      suggestedChainName: PHAROS_ATLANTIC.name,
    };
  }

  return null;
}

/** Build a same-path href that flips `chain` and keeps subject/capability. */
export function chainSwitchHref(opts: {
  path: string;
  chainId: string;
  subject: string;
  capability?: string;
  situation?: string;
}): string {
  const params = new URLSearchParams();
  params.set("chain", opts.chainId);
  if (opts.subject.trim()) params.set("subject", opts.subject.trim());
  if (opts.capability?.trim()) params.set("capability", opts.capability.trim());
  if (opts.situation?.trim()) params.set("situation", opts.situation.trim());
  const q = params.toString();
  return q ? `${opts.path}?${q}` : opts.path;
}
