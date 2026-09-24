import { loadLigisAdapter } from "./config.js";
import {
  SERVICE_ID,
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";
import {
  evidenceRequiredRefusal,
  issueCredential,
  verifyExternalAttestation,
  type AttestationDeps,
  type ExternalAttestationRequirement,
  type Provenance,
} from "./credential-ops.js";
import { isSelfIssuable } from "./services.js";

interface IssueRequirements {
  subject: string;
  capability: string;
  /** Expiry in seconds from now. Defaults to 24 hours. */
  expiresInSeconds?: number;
  /** Optional upstream evidence that must pass policy before Ligis issues. */
  externalAttestation?: ExternalAttestationRequirement;
}

interface IssueDeps extends AttestationDeps {
  loadAdapter?: typeof loadLigisAdapter;
}

function isIssueRequirements(req: unknown): req is IssueRequirements {
  const r = req as Record<string, unknown>;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    (r.expiresInSeconds === undefined ||
      typeof r.expiresInSeconds === "number") &&
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
 *
 * Gated by the same trust rule as `ligis.qualify`: a capability is issued only
 * against external evidence that passes policy, or when it is listed in
 * `LIGIS_SELF_ISSUABLE_CAPABILITIES` (empty by default). Both services enforce
 * it so a buyer can't bypass the gate by hiring the cheaper one.
 *
 * A refusal is delivered as a structured payload rather than an error: the
 * buyer already paid, so they get the reason and the exact evidence shape that
 * would unlock the credential instead of an opaque failure.
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

  // Policy gate: evidence, or an explicitly allowlisted capability. Checked
  // before any signing so a refusal costs no gas and moves no key material.
  if (!parsed.externalAttestation && !isSelfIssuable(parsed.capability)) {
    const refusal = evidenceRequiredRefusal(parsed.capability);
    console.log(
      `[ligis-croo] issue refused: ${parsed.capability} (${refusal.reason})`,
    );
    return {
      deliverableType: "text",
      deliverableText: JSON.stringify(
        {
          service: SERVICE_ID.issue,
          subject: parsed.subject,
          capability: parsed.capability,
          issued: false,
          ...refusal,
          /** The exact shape that would satisfy policy on a retry. */
          evidenceShape: {
            externalAttestation: {
              source: "eas",
              uid: "0x…",
              chainId: "<source chain id, optional>",
              schema: "<source schema, optional>",
            },
          },
          note: `Nothing was signed or submitted, so this order cost no gas. Re-hire ${SERVICE_ID.issue} with evidence, or hire ${SERVICE_ID.qualify} to have the check and the issuance handled in one order.`,
        },
        null,
        2,
      ),
    };
  }

  const provenance: Provenance | null = parsed.externalAttestation
    ? await verifyExternalAttestation(
        {
          subject: parsed.subject,
          capability: parsed.capability,
          externalAttestation: parsed.externalAttestation,
        },
        deps,
      )
    : null;

  const issued = await issueCredential({
    adapter,
    subject: parsed.subject,
    capability: parsed.capability,
    expiresInSeconds: parsed.expiresInSeconds ?? 24 * 60 * 60,
    provenance,
  });

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(
      { service: SERVICE_ID.issue, ...issued },
      null,
      2,
    ),
  };
}
