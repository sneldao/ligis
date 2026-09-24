export type GateReasonKind = "go" | "revoked" | "expired" | "none";

/**
 * The plain-language reason behind a gate verdict. Revoked wins over expired
 * so an explicitly invalidated credential is never described as merely stale.
 */
export function gateReason(
  v: { capable: boolean; revoked: boolean; expiresAt: bigint | null },
  nowSec: bigint,
): { kind: GateReasonKind; text: string } {
  if (v.capable) {
    return {
      kind: "go",
      text: "Authorized on-chain. Your agent may proceed with this counterparty.",
    };
  }
  if (v.revoked) {
    return {
      kind: "revoked",
      text: "Authorization was revoked by its issuer. Do not proceed — the credential is explicitly invalidated.",
    };
  }
  if (v.expiresAt != null && v.expiresAt > 0n && v.expiresAt <= nowSec) {
    return {
      kind: "expired",
      text: "A credential exists but it has expired. Do not proceed until the issuer renews it.",
    };
  }
  return {
    kind: "none",
    text: "No verifiable authorization found on-chain. Your agent should not proceed.",
  };
}
