import { loadLigisAdapter } from "./config.js";
import {
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";

interface VerifyRequirements {
  subject: string;
  capability: string;
  issuer?: string;
}

function isVerifyRequirements(req: unknown): req is VerifyRequirements {
  const r = req as Record<string, unknown>;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    (r.issuer === undefined || typeof r.issuer === "string")
  );
}

/**
 * Verify whether a subject holds a valid Ligis credential.
 *
 * Reads from the on-chain CredentialRegistry on the configured chain
 * (Casper or Pharos).
 */
export async function handleVerify(
  req: ServiceRequest,
): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isVerifyRequirements(parsed)) {
    throw new Error(
      "ligis.verify requirements must include { subject, capability, issuer? }",
    );
  }

  const adapter = await loadLigisAdapter();
  const result = await adapter.verifyCapability({
    subject: parsed.subject,
    capability: parsed.capability,
    issuer: parsed.issuer,
  });

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(
      {
        service: "ligis.verify",
        capable: result.capable,
        subject: result.subject,
        capability: result.capability,
        capabilityHash: result.capabilityHash,
        latestCredential: result.latest,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  };
}
