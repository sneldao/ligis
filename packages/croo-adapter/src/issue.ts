import { loadLigisAdapter } from "./config.js";
import {
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";

interface IssueRequirements {
  subject: string;
  capability: string;
  /** Expiry in seconds from now. Defaults to 24 hours. */
  expiresInSeconds?: number;
}

function isIssueRequirements(req: unknown): req is IssueRequirements {
  const r = req as Record<string, unknown>;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    (r.expiresInSeconds === undefined || typeof r.expiresInSeconds === "number")
  );
}

/**
 * Issue a Ligis capability credential.
 *
 * This service requires an issuer key to be configured in the environment
 * (LIGIS_CASPER_ISSUER_PRIVATE_KEY or equivalent for the selected chain).
 * It signs an EIP-712 credential and submits it to the on-chain registry.
 */
export async function handleIssue(req: ServiceRequest): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isIssueRequirements(parsed)) {
    throw new Error(
      "ligis.issue requirements must include { subject, capability, expiresInSeconds? }",
    );
  }

  const adapter = await loadLigisAdapter();

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
      },
      null,
      2,
    ),
  };
}
