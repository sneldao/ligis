import { loadLigisAdapter } from "./config.js";
import {
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";

interface RiskRequirements {
  subject: string;
  /** One or more capabilities to check. */
  capabilities: string[] | string;
  /** Optional trusted issuer address. */
  issuer?: string;
  /** Minimum required credential expiry in seconds. Defaults to 24 hours. */
  minTtlSeconds?: number;
}

interface CapabilityRisk {
  capability: string;
  capable: boolean;
  capabilityHash: string;
  latestCredential: unknown;
  /** Seconds until expiry. -1 if not capable or no expiry. */
  ttlSeconds: number;
  /** "pass" | "warn" | "fail" */
  verdict: string;
}

interface RiskReport {
  service: string;
  subject: string;
  overallVerdict: string;
  /** 0–100; higher is safer. */
  riskScore: number;
  checks: CapabilityRisk[];
  summary: string;
  checkedAt: string;
}

function isRiskRequirements(req: unknown): req is RiskRequirements {
  const r = req as Record<string, unknown>;
  const caps = Array.isArray(r.capabilities)
    ? r.capabilities.length > 0 &&
      r.capabilities.every((c) => typeof c === "string")
    : typeof r.capabilities === "string";
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    caps &&
    (r.issuer === undefined || typeof r.issuer === "string") &&
    (r.minTtlSeconds === undefined || typeof r.minTtlSeconds === "number")
  );
}

function extractTtlSeconds(latest: unknown, minTtl: number): number {
  if (!latest || typeof latest !== "object") return -1;
  const l = latest as Record<string, unknown>;
  const expiresAt = l.expiresAt;
  if (typeof expiresAt !== "number" && typeof expiresAt !== "string") return -1;
  const expiryMs =
    typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt * 1000;
  if (Number.isNaN(expiryMs)) return -1;
  const ttl = Math.floor((expiryMs - Date.now()) / 1000);
  return ttl;
}

/**
 * Return a structured risk report for a counterparty agent.
 *
 * This is the primary CROO service: before one agent pays another, the buyer
 * can hire Ligis to check whether the counterparty holds the credentials
 * required for the job and whether they are close to expiry or revoked.
 */
export async function handleRisk(req: ServiceRequest): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isRiskRequirements(parsed)) {
    throw new Error(
      "ligis.risk requirements must include { subject, capabilities: string[] | string, issuer?, minTtlSeconds? }",
    );
  }

  const capabilities = Array.isArray(parsed.capabilities)
    ? parsed.capabilities
    : [parsed.capabilities];
  const minTtl = parsed.minTtlSeconds ?? 24 * 60 * 60;

  const adapter = await loadLigisAdapter();
  const checks: CapabilityRisk[] = [];

  for (const capability of capabilities) {
    const result = await adapter.verifyCapability({
      subject: parsed.subject,
      capability,
      issuer: parsed.issuer,
    });

    const ttl = result.capable ? extractTtlSeconds(result.latest, minTtl) : -1;
    const ttlOk = result.capable && ttl >= minTtl;
    const verdict = !result.capable ? "fail" : ttlOk ? "pass" : "warn";

    checks.push({
      capability,
      capable: result.capable,
      capabilityHash: result.capabilityHash,
      latestCredential: result.latest,
      ttlSeconds: ttl,
      verdict,
    });
  }

  const failCount = checks.filter((c) => c.verdict === "fail").length;
  const warnCount = checks.filter((c) => c.verdict === "warn").length;
  const passCount = checks.filter((c) => c.verdict === "pass").length;

  let overallVerdict: string;
  let summary: string;
  if (failCount > 0) {
    overallVerdict = "fail";
    summary = `Counterparty missing ${failCount} required credential(s). Do not proceed.`;
  } else if (warnCount > 0) {
    overallVerdict = "warn";
    summary = `Counterparty holds credentials but ${warnCount} expire(s) within the requested TTL.`;
  } else {
    overallVerdict = "pass";
    summary =
      "Counterparty holds all required credentials with healthy expiry.";
  }

  // Simple risk score: base 40, +20 per pass, -30 per fail, +10 per warn.
  const scoreBase = 40;
  const score = Math.min(
    100,
    Math.max(0, scoreBase + passCount * 20 - failCount * 30 + warnCount * 10),
  );

  const report: RiskReport = {
    service: "ligis.risk",
    subject: parsed.subject,
    overallVerdict,
    riskScore: score,
    checks,
    summary,
    checkedAt: new Date().toISOString(),
  };

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(report, null, 2),
  };
}
