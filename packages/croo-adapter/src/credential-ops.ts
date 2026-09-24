/**
 * Shared credential operations for the CROO services.
 *
 * `ligis.issue` and `ligis.qualify` both need to (a) verify an external
 * attestation against policy and (b) sign + submit a credential. Keeping that
 * in one place means a capability can only be minted one way, and the policy
 * boundary can't drift between services.
 */
import {
  evaluateAttestationPolicy,
  type AttestationTrustPolicy,
  type AttestationVerifier,
  type ChainAdapter,
} from "@ligis/core";
import { createEasAttestationVerifierFromEnv } from "@ligis/adapter-evm";
import { SELF_ISSUABLE_ENV } from "./services.js";

/** A reference to upstream evidence supplied with an issuance request. */
export interface ExternalAttestationRequirement {
  source: "eas";
  uid: string;
  chainId?: string;
  schema?: string;
}

export interface AttestationDeps {
  verifier?: AttestationVerifier;
  policy?: AttestationTrustPolicy;
  now?: () => Date;
}

/** Normalized provenance recorded on the issued credential. */
export interface Provenance {
  source: string;
  uid: string;
  chainId?: string;
  schema?: string;
  attester: string;
  checkedAt: string;
  expiresAt?: string;
  capability: string;
  signals: string[];
}

/**
 * Verify an external attestation and apply the fail-closed trust policy.
 *
 * Throws when the evidence is untrusted, stale, revoked, or maps to a
 * different capability than the one being issued — callers must not mint on a
 * decision that was merely "not rejected".
 */
export async function verifyExternalAttestation(
  req: {
    subject: string;
    capability: string;
    externalAttestation: ExternalAttestationRequirement;
  },
  deps: AttestationDeps = {},
): Promise<Provenance> {
  const verifier =
    deps.verifier ?? createEasAttestationVerifierFromEnv(process.env);
  const policy = deps.policy ?? loadEasTrustPolicyFromEnv();
  const now = deps.now?.() ?? new Date();
  const attestation = await verifier.verify({
    source: req.externalAttestation.source,
    subject: req.subject,
    reference: {
      source: req.externalAttestation.source,
      uid: req.externalAttestation.uid,
      chainId: req.externalAttestation.chainId,
      schema: req.externalAttestation.schema,
    },
  });
  const decision = evaluateAttestationPolicy(
    attestation,
    policy,
    now.getTime(),
  );

  if (!decision.accepted || decision.capability !== req.capability) {
    throw new Error(`External attestation rejected: ${decision.reason}`);
  }

  return {
    source: attestation.evidence.source,
    uid: attestation.evidence.uid,
    chainId: attestation.evidence.chainId,
    schema: attestation.evidence.schema,
    attester: attestation.attester,
    checkedAt: attestation.checkedAt,
    expiresAt: attestation.expiresAt,
    capability: decision.capability,
    signals: decision.signals,
  };
}

/** The signed credential as returned by the adapter's signing operation. */
export interface SignedCredential {
  subject: string;
  capability: string;
  capabilityHash: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
}

/** A credential as submitted on-chain. */
export interface IssueResult {
  subject: string;
  capability: string;
  capabilityHash: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  txHash: string;
  submittedAt: string;
  provenance: Provenance | null;
}

/**
 * Sign and submit a capability credential, returning the on-chain result.
 *
 * This is the only mint path: it is a real write (gas + issuer key custody),
 * so callers are expected to have satisfied their own policy before arriving
 * here — `ligis.qualify` checks evidence or the self-issuable allowlist first.
 */
export async function issueCredential(opts: {
  adapter: ChainAdapter;
  subject: string;
  capability: string;
  expiresInSeconds: number;
  provenance?: Provenance | null;
}): Promise<IssueResult> {
  const issuerKey = process.env.LIGIS_ISSUER_PRIVATE_KEY;
  if (!issuerKey) {
    throw new Error(
      "LIGIS_ISSUER_PRIVATE_KEY is required to issue credentials",
    );
  }

  // Cast is safe: adapters share the ChainAdapter contract, but the issuance
  // operations live outside it (only Casper/Pharos implement them).
  // Bind methods to preserve `this` context (CasperAdapter methods reference
  // this.ctx internally).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyAdapter = opts.adapter as any;
  const signCredential = anyAdapter.signCredential?.bind(opts.adapter);
  const submitCredential = anyAdapter.submitCredential?.bind(opts.adapter);

  if (
    typeof signCredential !== "function" ||
    typeof submitCredential !== "function"
  ) {
    throw new Error(
      "Selected Ligis adapter does not support credential issuance",
    );
  }

  const signed = (await signCredential({
    issuerKey,
    subject: opts.subject,
    capability: opts.capability,
    expiresInSeconds: opts.expiresInSeconds,
  })) as SignedCredential;

  const { tx } = await submitCredential(signed);

  return {
    subject: signed.subject,
    capability: opts.capability,
    capabilityHash: signed.capabilityHash,
    issuer: signed.issuer,
    issuedAt: signed.issuedAt,
    expiresAt: signed.expiresAt,
    txHash: tx.hash,
    submittedAt: new Date().toISOString(),
    provenance: opts.provenance ?? null,
  };
}

/**
 * The canonical explanation for a policy refusal, shared by every mint path so
 * `ligis.issue` and `ligis.qualify` refuse in the same words.
 */
export function evidenceRequiredRefusal(capability: string): {
  reason: "evidence-required";
  detail: string;
} {
  return {
    reason: "evidence-required",
    detail:
      `Policy does not allow ${capability} to be issued from payment alone. ` +
      `Supply externalAttestation evidence for it, or ask the operator to list it in ${SELF_ISSUABLE_ENV}.`,
  };
}

/** Build the EAS trust policy from the environment, failing closed when unset. */
export function loadEasTrustPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AttestationTrustPolicy {
  const trustedAttesters = (env.LIGIS_EAS_TRUSTED_ATTESTERS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const capabilityMappings = parseJsonEnv<Record<string, string>>(
    env.LIGIS_EAS_SCHEMA_CAPABILITIES,
  );
  const maxAgeSeconds = Number(env.LIGIS_EAS_MAX_AGE_SECONDS ?? 300);

  if (trustedAttesters.length === 0) {
    throw new Error(
      "LIGIS_EAS_TRUSTED_ATTESTERS is required for EAS-backed issuance",
    );
  }
  if (Object.keys(capabilityMappings).length === 0) {
    throw new Error(
      "LIGIS_EAS_SCHEMA_CAPABILITIES is required for EAS-backed issuance",
    );
  }

  return {
    acceptedSources: ["eas"],
    trustedAttesters: { eas: trustedAttesters },
    capabilityMappings,
    maxAgeSeconds,
    requireFreshStatus: env.LIGIS_EAS_REQUIRE_FRESH_STATUS !== "false",
  };
}

function parseJsonEnv<T extends object>(raw: string | undefined): T {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Expected valid JSON, got: ${raw}`);
  }
}
