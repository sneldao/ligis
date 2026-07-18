/**
 * External verification inputs consumed by Ligis.
 *
 * These types deliberately stop at the trust boundary: protocol-specific
 * adapters (EAS, Self, etc.) verify their native proofs and normalize the
 * result here. Ligis can then apply policy and issue its own capability
 * credential without making an external protocol the canonical registry.
 */

/** A protocol that can provide evidence about an agent or its controller. */
export type AttestationSource = "eas" | "self" | (string & {});

/** Normalized lifecycle state after the source protocol has been checked. */
export type AttestationStatus = "valid" | "expired" | "revoked" | "invalid";

/** A privacy-preserving reference to the source data, never raw identity data. */
export interface AttestationEvidenceRef {
  /** Source protocol (for example `eas` or `self`). */
  source: AttestationSource;
  /** Source-native UID, proof identifier, or nullifier reference. */
  uid: string;
  /** Chain on which the source evidence was verified, when applicable. */
  chainId?: string;
  /** Schema or proof type identifier, if the source exposes one. */
  schema?: string;
  /** Content hash for auditability without retaining personal data. */
  dataHash?: string;
}

/**
 * Protocol-neutral attestation returned by an external verifier adapter.
 * `claims` should contain only policy-safe normalized claims (for example
 * `human`, `country`, or `ageOver`) and never passport or document contents.
 */
export interface ExternalAttestation {
  evidence: AttestationEvidenceRef;
  subject: string;
  attester: string;
  status: AttestationStatus;
  issuedAt?: string;
  expiresAt?: string;
  claims: Record<string, string | number | boolean>;
  checkedAt: string;
}

/** A policy decision explaining whether evidence may back a Ligis capability. */
export interface AttestationPolicyDecision {
  accepted: boolean;
  capability: string;
  reason: string;
  /** Stable, machine-readable signals for risk scoring and CROO responses. */
  signals: string[];
}

/** Configuration shared by all external-attestation adapters. */
export interface AttestationTrustPolicy {
  /** Only these source protocols may produce imported credentials. */
  acceptedSources: AttestationSource[];
  /** Optional allowlist of trusted attesters per source. */
  trustedAttesters?: Partial<Record<AttestationSource, string[]>>;
  /** Source schema/proof ID to Ligis capability mappings. */
  capabilityMappings: Record<string, string>;
  /** Maximum age of a source check before it must be refreshed. */
  maxAgeSeconds: number;
  /** Require a source-native revocation/status check at import time. */
  requireFreshStatus: boolean;
}

/** Input accepted by an adapter when verifying an external proof/reference. */
export interface AttestationVerificationRequest {
  source: AttestationSource;
  subject: string;
  reference: AttestationEvidenceRef;
  proof?: string;
  requestedClaims?: string[];
}

/** Boundary implemented by EAS, Self, and future verifier integrations. */
export interface AttestationVerifier {
  readonly source: AttestationSource;
  verify(request: AttestationVerificationRequest): Promise<ExternalAttestation>;
}

/**
 * Apply the shared fail-closed policy to a normalized attestation.
 *
 * Adapters remain responsible for cryptographic verification; this function
 * only decides whether a verified result is eligible to back a capability.
 */
export function evaluateAttestationPolicy(
  attestation: ExternalAttestation,
  policy: AttestationTrustPolicy,
  now = Date.now(),
): AttestationPolicyDecision {
  const fail = (reason: string, signal: string): AttestationPolicyDecision => ({
    accepted: false,
    capability: "",
    reason,
    signals: [signal],
  });

  if (!policy.acceptedSources.includes(attestation.evidence.source)) {
    return fail("Attestation source is not accepted by policy", "source-untrusted");
  }
  if (attestation.status !== "valid") {
    return fail(`Attestation is ${attestation.status}`, `source-${attestation.status}`);
  }

  const trusted = policy.trustedAttesters?.[attestation.evidence.source];
  if (trusted && !trusted.includes(attestation.attester)) {
    return fail("Attester is not trusted by policy", "attester-untrusted");
  }

  const checkedAt = Date.parse(attestation.checkedAt);
  if (!Number.isFinite(checkedAt) || now - checkedAt > policy.maxAgeSeconds * 1000) {
    return fail("Attestation status is stale", "source-stale");
  }

  if (policy.requireFreshStatus && !attestation.expiresAt) {
    return fail("Attestation has no expiry or freshness boundary", "expiry-missing");
  }

  if (attestation.expiresAt && Date.parse(attestation.expiresAt) <= now) {
    return fail("Attestation has expired", "source-expired");
  }

  const schemaKey = attestation.evidence.schema
    ? `${attestation.evidence.source}:${attestation.evidence.schema}`
    : undefined;
  const capability =
    (schemaKey && policy.capabilityMappings[schemaKey]) ||
    (attestation.evidence.schema && policy.capabilityMappings[attestation.evidence.schema]);
  if (!capability) {
    return fail("Attestation schema is not mapped to a capability", "schema-unmapped");
  }

  return {
    accepted: true,
    capability,
    reason: "Attestation satisfies the configured trust policy",
    signals: ["source-verified", "attester-trusted", "schema-mapped"],
  };
}
