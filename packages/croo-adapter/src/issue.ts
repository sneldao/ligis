import { loadLigisAdapter } from "./config.js";
import {
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";
import {
  evaluateAttestationPolicy,
  type AttestationTrustPolicy,
  type AttestationVerifier,
} from "@ligis/core";
import { createEasAttestationVerifierFromEnv } from "@ligis/adapter-evm";

interface IssueRequirements {
  subject: string;
  capability: string;
  /** Expiry in seconds from now. Defaults to 24 hours. */
  expiresInSeconds?: number;
  /** Optional upstream evidence that must pass policy before Ligis issues. */
  externalAttestation?: ExternalAttestationRequirement;
}

interface ExternalAttestationRequirement {
  source: "eas";
  uid: string;
  chainId?: string;
  schema?: string;
}

interface IssueDeps {
  loadAdapter?: typeof loadLigisAdapter;
  verifier?: AttestationVerifier;
  policy?: AttestationTrustPolicy;
  now?: () => Date;
}

function isIssueRequirements(req: unknown): req is IssueRequirements {
  const r = req as Record<string, unknown>;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    (r.expiresInSeconds === undefined || typeof r.expiresInSeconds === "number") &&
    (r.externalAttestation === undefined ||
      isExternalAttestationRequirement(r.externalAttestation))
  );
}

function isExternalAttestationRequirement(
  req: unknown,
): req is ExternalAttestationRequirement {
  const r = req as Record<string, unknown>;
  return (
    typeof r === "object" &&
    r !== null &&
    r.source === "eas" &&
    typeof r.uid === "string" &&
    (r.chainId === undefined || typeof r.chainId === "string") &&
    (r.schema === undefined || typeof r.schema === "string")
  );
}

/**
 * Issue a Ligis capability credential.
 *
 * This service requires an issuer key to be configured in the environment
 * (LIGIS_CASPER_ISSUER_PRIVATE_KEY or equivalent for the selected chain).
 * It signs an EIP-712 credential and submits it to the on-chain registry.
 */
export async function handleIssue(
  req: ServiceRequest,
  deps: IssueDeps = {},
): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isIssueRequirements(parsed)) {
    throw new Error(
      "ligis.issue requirements must include { subject, capability, expiresInSeconds?, externalAttestation? }",
    );
  }

  const adapter = await (deps.loadAdapter ?? loadLigisAdapter)();

  const provenance = parsed.externalAttestation
    ? await verifyExternalAttestation(
        { ...parsed, externalAttestation: parsed.externalAttestation },
        deps,
      )
    : null;

  // Cast is safe: adapters share the ChainAdapter contract.
  // Bind methods to preserve `this` context (CasperAdapter methods
  // reference this.ctx internally).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyAdapter = adapter as any;
  const signCredential = anyAdapter.signCredential?.bind(adapter);
  const submitCredential = anyAdapter.submitCredential?.bind(adapter);

  if (
    typeof signCredential !== "function" ||
    typeof submitCredential !== "function"
  ) {
    throw new Error(
      "Selected Ligis adapter does not support credential issuance",
    );
  }

  const issuerKey = process.env.LIGIS_ISSUER_PRIVATE_KEY;
  if (!issuerKey) {
    throw new Error("LIGIS_ISSUER_PRIVATE_KEY is required for ligis.issue");
  }

  const signed = await signCredential({
    issuerKey,
    subject: parsed.subject,
    capability: parsed.capability,
    expiresInSeconds: parsed.expiresInSeconds ?? 24 * 60 * 60,
  });

  const { tx } = await submitCredential(signed);

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(
      {
        service: "ligis.issue",
        subject: signed.subject,
        capability: parsed.capability,
        capabilityHash: signed.capabilityHash,
        issuer: signed.issuer,
        issuedAt: signed.issuedAt,
        expiresAt: signed.expiresAt,
        txHash: tx.hash,
        submittedAt: new Date().toISOString(),
        provenance,
      },
      null,
      2,
    ),
  };
}

async function verifyExternalAttestation(
  req: IssueRequirements & { externalAttestation: ExternalAttestationRequirement },
  deps: IssueDeps,
) {
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
  const decision = evaluateAttestationPolicy(attestation, policy, now.getTime());

  if (!decision.accepted || decision.capability !== req.capability) {
    throw new Error(
      `External attestation rejected: ${decision.reason}`,
    );
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

function loadEasTrustPolicyFromEnv(): AttestationTrustPolicy {
  const trustedAttesters = parseCsvEnv("LIGIS_EAS_TRUSTED_ATTESTERS");
  const capabilityMappings = parseJsonEnv<Record<string, string>>(
    "LIGIS_EAS_SCHEMA_CAPABILITIES",
  );
  const maxAgeSeconds = Number(process.env.LIGIS_EAS_MAX_AGE_SECONDS ?? 300);

  if (trustedAttesters.length === 0) {
    throw new Error("LIGIS_EAS_TRUSTED_ATTESTERS is required for EAS-backed issuance");
  }
  if (Object.keys(capabilityMappings).length === 0) {
    throw new Error("LIGIS_EAS_SCHEMA_CAPABILITIES is required for EAS-backed issuance");
  }

  return {
    acceptedSources: ["eas"],
    trustedAttesters: { eas: trustedAttesters },
    capabilityMappings,
    maxAgeSeconds,
    requireFreshStatus: process.env.LIGIS_EAS_REQUIRE_FRESH_STATUS !== "false",
  };
}

function parseCsvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonEnv<T extends object>(name: string): T {
  const raw = process.env[name];
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}
