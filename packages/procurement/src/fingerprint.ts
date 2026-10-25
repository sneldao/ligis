import { createHash } from "node:crypto";

export interface DestinationParts {
  country: string;
  currency: string;
  accountNumber?: string;
  routingNumber?: string;
  iban?: string;
  swift?: string;
}

function norm(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Deterministic fingerprint of a payout destination. Normalizes (trim,
 * uppercase, strip whitespace) each field and hashes the joined parts, so the
 * same bank account fingerprints identically regardless of formatting.
 */
export function destinationFingerprint(parts: DestinationParts): string {
  const joined = [
    norm(parts.country),
    norm(parts.currency),
    norm(parts.accountNumber),
    norm(parts.routingNumber),
    norm(parts.iban),
    norm(parts.swift),
  ].join("|");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}
