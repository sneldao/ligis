import { loadLigisAdapter } from "./config.js";
import { capabilityCriticality, capabilityWeight } from "./capability-meta.js";
import {
  SERVICE_ID,
  SERVICE_PRICE_USD,
  isSelfIssuable,
  serviceListingId,
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";
import type { ChainAdapter } from "@ligis/core";

interface RiskRequirements {
  subject: string;
  /** One or more capabilities to check. */
  capabilities: string[] | string;
  /** Optional trusted issuer address. */
  issuer?: string;
  /** Minimum required credential expiry in seconds. Defaults to 24 hours. */
  minTtlSeconds?: number;
}

interface RiskSignal {
  /** Machine-readable signal code, e.g. "ttl-comfortable" or "credential-immature". */
  code: string;
  /** Human-readable explanation. */
  detail: string;
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
  // --- New signals ---
  /** Criticality level assigned to this capability. */
  criticality: string;
  /** Weight (1–4) used in the overall score. */
  weight: number;
  /** Who issued the credential (zero address if none). */
  issuer: string;
  /** Seconds since the credential was issued. -1 if not capable. */
  credentialAgeSeconds: number;
  /** Ratio of actual TTL to requested minimum. 0 if not capable. */
  ttlRatio: number;
  /** Sub-score 0–100 for this individual capability. */
  subScore: number;
  /** Signals contributing to the sub-score. */
  signals: RiskSignal[];
}

interface ScoreBreakdown {
  /** Weighted capability score (0–100). */
  capabilityWeighted: number;
  /** TTL health across all checks (0–100). */
  ttlHealth: number;
  /** Credential tenure/maturity (0–100). */
  tenureMaturity: number;
  /** Issuer diversification (0–100). 100 = all different issuers. */
  issuerDiversity: number;
}

/** A hireable Ligis service: name, CROO listing UUID, and catalog price. */
export interface ServiceRoute {
  service: string;
  /** Null when the listing UUID isn't configured — hire by name on the store. */
  listingId: string | null;
  priceUsd: string;
}

/**
 * Path-to-trust hint — tells the buyer what to do when a capability is missing.
 *
 * Only populated when one or more capabilities failed the check. Turns a
 * dead-end "fail" into a conversion step, and recommends the single-order
 * route (`ligis.qualify`) over the two-order one (`ligis.issue` then re-check).
 */
export interface PathToTrust {
  /** Capability names that were not held. */
  failedCapabilities: string[];
  /**
   * Subset of `failedCapabilities` that cannot be minted from payment alone —
   * `ligis.qualify` will only issue these against external evidence.
   */
  evidenceRequiredFor: string[];
  /** Recommended: one order that issues and re-checks. */
  recommended: ServiceRoute;
  /** Fallback: hire issuance, then re-run the risk check (two orders). */
  fallback: ServiceRoute;
  /** Chain identifier the credential will be issued on (e.g. "casper-testnet"). */
  chain: string;
  /** Human-readable chain name (e.g. "Casper Testnet"). */
  chainName: string;
  /** One-sentence action hint naming the recommended route. */
  hint: string;
}

export interface RiskReport {
  service: string;
  subject: string;
  overallVerdict: string;
  /** 0–100; higher is safer. */
  riskScore: number;
  checks: CapabilityRisk[];
  summary: string;
  checkedAt: string;
  // --- New fields ---
  /** Component scores that feed into the overall risk score. */
  breakdown: ScoreBreakdown;
  /** Cross-cutting signals that affect the overall verdict. */
  signals: RiskSignal[];
  /** Next-step guidance when one or more capabilities are missing. Null when verdict is pass/warn. */
  pathToTrust: PathToTrust | null;
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

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") {
    // Numeric string — could be unix seconds or milliseconds.
    // Heuristic: < 1e12 is seconds, >= 1e12 is milliseconds.
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && asNum > 0) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    // ISO date string fallback
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function extractTtlSeconds(latest: unknown): number {
  if (!latest || typeof latest !== "object") return -1;
  const l = latest as Record<string, unknown>;
  const expiryMs = parseTimestamp(l.expiresAt);
  if (expiryMs === 0) return -1;
  const ttl = Math.floor((expiryMs - Date.now()) / 1000);
  return ttl;
}

function extractAgeSeconds(latest: unknown): number {
  if (!latest || typeof latest !== "object") return -1;
  const l = latest as Record<string, unknown>;
  const issuedMs = parseTimestamp(l.issuedAt);
  if (issuedMs === 0) return -1;
  return Math.floor((Date.now() - issuedMs) / 1000);
}

function extractIssuer(latest: unknown): string {
  if (!latest || typeof latest !== "object") return "";
  const l = latest as Record<string, unknown>;
  return typeof l.issuer === "string" ? l.issuer : "";
}

/**
 * Credential maturity threshold in seconds.
 *
 * A credential held for less than this is considered "immature" — it
 * hasn't been around long enough to establish a track record. 7 days
 * is a reasonable starting point: long enough to filter out flash-mint
 * attacks, short enough not to penalize legitimate new agents.
 */
const MATURITY_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

/**
 * Compute a per-capability sub-score (0–100) from the available signals.
 *
 * The score is built from three components:
 *   1. Capability base (0 or 50) — is the credential held at all?
 *   2. TTL health (0–30) — how much time remains relative to the minimum?
 *   3. Tenure maturity (0–20) — how long has the credential been held?
 *
 * A capable credential with a comfortable TTL and long tenure scores
 * close to 100. A missing credential scores 0. A credential that's
 * capable but expires soon or was just issued gets a partial score.
 */
function computeSubScore(
  capable: boolean,
  ttlSeconds: number,
  minTtl: number,
  ageSeconds: number,
  signals: RiskSignal[],
): number {
  if (!capable) return 0;

  // TTL health: continuous from 0 to 30 based on ratio.
  // ratio >= 3x → full 30 points
  // ratio >= 1x → 15–30 points (meets minimum, scales with buffer)
  // ratio < 1x → 0–15 points (below minimum, still capable but risky)
  const ttlRatio = minTtl > 0 ? ttlSeconds / minTtl : 1;
  let ttlPoints: number;
  if (ttlRatio >= 3) {
    ttlPoints = 30;
    signals.push({
      code: "ttl-comfortable",
      detail: `TTL is ${ttlRatio.toFixed(1)}× the requested minimum.`,
    });
  } else if (ttlRatio >= 1) {
    ttlPoints = 15 + (ttlRatio - 1) * 7.5;
    signals.push({
      code: "ttl-adequate",
      detail: `TTL meets the minimum but only ${ttlRatio.toFixed(1)}× buffer.`,
    });
  } else if (ttlSeconds > 0) {
    ttlPoints = ttlRatio * 15;
    signals.push({
      code: "ttl-below-minimum",
      detail: `TTL is below the requested minimum (${ttlSeconds}s < ${minTtl}s).`,
    });
  } else {
    ttlPoints = 0;
    signals.push({
      code: "ttl-expired-or-none",
      detail: "Credential has no remaining TTL.",
    });
  }

  // Tenure maturity: 0 to 20 based on credential age.
  // Full 20 points after MATURITY_THRESHOLD_SECONDS.
  // Linear ramp from 0 to 20 before that.
  let tenurePoints: number;
  if (ageSeconds < 0) {
    tenurePoints = 0;
  } else if (ageSeconds >= MATURITY_THRESHOLD_SECONDS) {
    tenurePoints = 20;
    signals.push({
      code: "tenure-mature",
      detail: "Credential held for over 7 days.",
    });
  } else {
    tenurePoints = (ageSeconds / MATURITY_THRESHOLD_SECONDS) * 20;
    signals.push({
      code: "credential-immature",
      detail: `Credential issued ${ageSeconds}s ago — below 7-day maturity threshold.`,
    });
  }

  return Math.min(100, Math.max(0, 50 + ttlPoints + tenurePoints));
}

/**
 * Compute issuer diversity score (0–100).
 *
 * 100 = every credential from a different issuer (maximum diversification).
 * Lower = concentration risk from a single issuer.
 *
 * If only one capability is checked, diversity is neutral (50) — we
 * can't penalize for having a single issuer when only one credential
 * was requested.
 */
function computeIssuerDiversity(issuers: string[]): number {
  const valid = issuers.filter((i) => i && i !== "");
  if (valid.length <= 1) return 50;
  const unique = new Set(valid).size;
  return Math.round((unique / valid.length) * 100);
}

/**
 * Compute the overall risk score as a weighted average of per-capability
 * sub-scores, modulated by issuer diversity.
 *
 * The weight of each capability is its criticality weight (1–4). This
 * means a fail on `kyc.basic` (weight 4) drags the score down 4× harder
 * than a fail on `data.premium` (weight 1).
 *
 * Issuer diversity acts as a multiplier: if all credentials come from
 * one issuer, the score is discounted by up to 10% (concentration risk).
 */
function computeOverallScore(
  checks: CapabilityRisk[],
  issuerDiversity: number,
): number {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedSum = checks.reduce((sum, c) => sum + c.subScore * c.weight, 0);
  const capabilityScore = weightedSum / totalWeight;

  // Issuer diversity discount: 100 = no discount, 50 = 5% discount, 0 = 10% discount
  const diversityDiscount = ((100 - issuerDiversity) / 100) * 10;

  return Math.min(
    100,
    Math.max(0, Math.round(capabilityScore - diversityDiscount)),
  );
}

/**
 * Build the path-to-trust pointer for a failed risk check.
 *
 * Every field is derived, never hardcoded: the price comes from the service
 * catalog (the same constant the `ligis.issue` listing is built from), and
 * the chain comes from the adapter that actually performed the check — so a
 * Pharos deployment stops advertising Casper.
 */
function buildPathToTrust(
  failedCapabilities: string[],
  adapter: ChainAdapter,
): PathToTrust {
  const chain = adapter.chainId ?? process.env.LIGIS_CHAIN ?? "casper";
  const chainName = adapter.chainName ?? chain;
  const capabilityList = failedCapabilities.join(" and ");
  const evidenceRequiredFor = failedCapabilities.filter(
    (capability) => !isSelfIssuable(capability),
  );

  const recommended: ServiceRoute = {
    service: SERVICE_ID.qualify,
    listingId: serviceListingId(SERVICE_ID.qualify),
    priceUsd: SERVICE_PRICE_USD[SERVICE_ID.qualify],
  };
  const fallback: ServiceRoute = {
    service: SERVICE_ID.issue,
    listingId: serviceListingId(SERVICE_ID.issue),
    priceUsd: SERVICE_PRICE_USD[SERVICE_ID.issue],
  };

  const evidenceNote =
    evidenceRequiredFor.length > 0
      ? ` Supply evidence for ${evidenceRequiredFor.join(" and ")} — it is issued only if that evidence passes policy.`
      : "";
  const fallbackNote =
    evidenceRequiredFor.length > 0
      ? ` Without evidence, hire ${fallback.service} ($${fallback.priceUsd}) first and re-run ${SERVICE_ID.risk}.`
      : ` Alternatively hire ${fallback.service} ($${fallback.priceUsd}) and re-run ${SERVICE_ID.risk}.`;

  return {
    failedCapabilities,
    evidenceRequiredFor,
    recommended,
    fallback,
    chain,
    chainName,
    hint:
      `Get credentialed for ${capabilityList} in one order: hire ${recommended.service} ` +
      `($${recommended.priceUsd}) and the credential is issued and re-checked in the same call.` +
      evidenceNote +
      fallbackNote +
      ` Credentials land on ${chainName}.`,
  };
}

/**
 * Build the structured risk report for a counterparty agent.
 *
 * Exported so `ligis.qualify` can run the same check before and after
 * credentialing — the report is the product, and there is exactly one
 * implementation of it.
 *
 * The risk score is a weighted average of per-capability sub-scores. Each
 * sub-score reflects three signals:
 *   - Is the credential held at all? (50 points base)
 *   - How much TTL remains relative to the requested minimum? (0–30 points)
 *   - How long has the credential been held? (0–20 points, maturity)
 *
 * Capabilities are weighted by criticality: losing `kyc.basic` (weight 4)
 * impacts the score more than losing `data.premium` (weight 1).
 */
export async function buildRiskReport(
  parsed: RiskRequirements,
  adapter: ChainAdapter,
): Promise<RiskReport> {
  const capabilities = Array.isArray(parsed.capabilities)
    ? parsed.capabilities
    : [parsed.capabilities];
  const minTtl = parsed.minTtlSeconds ?? 24 * 60 * 60;

  const checks: CapabilityRisk[] = [];

  for (const capability of capabilities) {
    const result = await adapter.verifyCapability({
      subject: parsed.subject,
      capability,
      issuer: parsed.issuer,
    });

    const ttl = result.capable ? extractTtlSeconds(result.latest) : -1;
    const age = result.capable ? extractAgeSeconds(result.latest) : -1;
    const issuer = extractIssuer(result.latest);
    const ttlRatio = minTtl > 0 && ttl > 0 ? ttl / minTtl : 0;

    const signals: RiskSignal[] = [];
    const subScore = computeSubScore(result.capable, ttl, minTtl, age, signals);

    // Verdict: fail if not capable, warn if TTL below minimum or immature,
    // pass otherwise. Critical capabilities get a stricter threshold —
    // a warn on a critical capability is downgraded to fail if TTL is
    // below half the minimum.
    const weight = capabilityWeight(capability);
    const criticality = capabilityCriticality(capability);
    const ttlOk = result.capable && ttl >= minTtl;
    const mature = age >= MATURITY_THRESHOLD_SECONDS;

    let verdict: string;
    if (!result.capable) {
      verdict = "fail";
    } else if (!ttlOk) {
      // Critical capabilities with severely low TTL → fail, not warn
      if (weight >= 4 && ttl < minTtl / 2) {
        verdict = "fail";
        signals.push({
          code: "critical-ttl-critical",
          detail: `Critical capability ${capability} has TTL below half the minimum — treated as fail.`,
        });
      } else {
        verdict = "warn";
      }
    } else if (!mature) {
      verdict = "warn";
    } else {
      verdict = "pass";
    }

    checks.push({
      capability,
      capable: result.capable,
      capabilityHash: result.capabilityHash,
      latestCredential: result.latest,
      ttlSeconds: ttl,
      verdict,
      criticality,
      weight,
      issuer,
      credentialAgeSeconds: age,
      ttlRatio: Math.round(ttlRatio * 100) / 100,
      subScore: Math.round(subScore),
      signals,
    });
  }

  // --- Overall verdict ---
  const failCount = checks.filter((c) => c.verdict === "fail").length;
  const warnCount = checks.filter((c) => c.verdict === "warn").length;
  const passCount = checks.filter((c) => c.verdict === "pass").length;

  // Any fail on a critical/high-weight capability → fail overall
  const criticalFail = checks.some(
    (c) => c.verdict === "fail" && c.weight >= 3,
  );

  let overallVerdict: string;
  let summary: string;
  const overallSignals: RiskSignal[] = [];

  if (failCount > 0) {
    if (criticalFail) {
      overallVerdict = "fail";
      const failed = checks
        .filter((c) => c.verdict === "fail" && c.weight >= 3)
        .map((c) => c.capability)
        .join(", ");
      summary = `Counterparty missing critical credential(s): ${failed}. Do not proceed.`;
      overallSignals.push({
        code: "critical-capability-missing",
        detail: `One or more high-criticality capabilities are not held: ${failed}.`,
      });
    } else {
      overallVerdict = "fail";
      summary = `Counterparty missing ${failCount} required credential(s). Do not proceed.`;
    }
  } else if (warnCount > 0) {
    overallVerdict = "warn";
    summary = `Counterparty holds all credentials but ${warnCount} have warnings (TTL or maturity). Proceed with caution.`;
  } else {
    overallVerdict = "pass";
    summary =
      "Counterparty holds all required credentials with healthy TTL and maturity.";
  }

  // --- Issuer diversity ---
  const issuers = checks.map((c) => c.issuer);
  const issuerDiversity = computeIssuerDiversity(issuers);
  if (issuerDiversity <= 50 && checks.length > 1) {
    overallSignals.push({
      code: "single-issuer-concentration",
      detail:
        "All credentials issued by the same issuer. Concentration risk if that issuer is compromised.",
    });
  }

  // --- Component scores for breakdown ---
  const ttlHealth = Math.round(
    checks.reduce((sum, c) => {
      if (!c.capable) return sum + 0;
      if (c.ttlSeconds < 0) return sum + 0;
      const ratio = minTtl > 0 ? Math.min(1, c.ttlSeconds / (minTtl * 3)) : 1;
      return sum + ratio * 100;
    }, 0) / checks.length,
  );

  const tenureMaturity = Math.round(
    checks.reduce((sum, c) => {
      if (!c.capable || c.credentialAgeSeconds < 0) return sum + 0;
      const ratio = Math.min(
        1,
        c.credentialAgeSeconds / MATURITY_THRESHOLD_SECONDS,
      );
      return sum + ratio * 100;
    }, 0) / checks.length,
  );

  const capabilityWeighted = Math.round(
    checks.reduce((sum, c) => sum + c.subScore * c.weight, 0) /
      checks.reduce((sum, c) => sum + c.weight, 0),
  );

  const breakdown: ScoreBreakdown = {
    capabilityWeighted,
    ttlHealth,
    tenureMaturity,
    issuerDiversity,
  };

  // --- Overall score ---
  const riskScore = computeOverallScore(checks, issuerDiversity);

  // Build path-to-trust only when capabilities are missing (verdict=fail).
  // A warn result means credentials exist but are immature/TTL-low — issuing
  // a new one doesn't help; the buyer just needs to wait or accept the risk.
  const failedCaps = checks
    .filter((c) => c.verdict === "fail" && !c.capable)
    .map((c) => c.capability);
  const pathToTrust: PathToTrust | null =
    failedCaps.length > 0 ? buildPathToTrust(failedCaps, adapter) : null;

  return {
    service: SERVICE_ID.risk,
    subject: parsed.subject,
    overallVerdict,
    riskScore,
    checks,
    summary,
    checkedAt: new Date().toISOString(),
    breakdown,
    signals: overallSignals,
    pathToTrust,
  };
}

/**
 * Flatten a risk report into the CROO deliverable shape.
 *
 * CROO's deliverable schema doesn't support arrays of objects, so `checks`,
 * `signals`, `breakdown`, and `pathToTrust` are JSON-encoded strings. Shared
 * with `ligis.qualify`, which embeds both a before and an after report.
 */
export function riskDeliverable(report: RiskReport): Record<string, unknown> {
  return {
    service: report.service,
    subject: report.subject,
    overallVerdict: report.overallVerdict,
    riskScore: report.riskScore,
    summary: report.summary,
    checkedAt: report.checkedAt,
    checks: JSON.stringify(report.checks),
    signals: JSON.stringify(report.signals),
    breakdown: JSON.stringify(report.breakdown),
    ...(report.pathToTrust
      ? { pathToTrust: JSON.stringify(report.pathToTrust) }
      : {}),
  };
}

/**
 * ligis.risk — the counterparty risk check (the primary CROO service).
 *
 * Before one agent pays another, the buyer can hire Ligis to check whether the
 * counterparty holds the credentials required for the job, and whether they are
 * close to expiry or revoked. See `buildRiskReport` for the scoring model.
 */
export async function handleRisk(
  req: ServiceRequest,
  opts?: { adapter?: ChainAdapter },
): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isRiskRequirements(parsed)) {
    throw new Error(
      "ligis.risk requirements must include { subject, capabilities: string[] | string, issuer?, minTtlSeconds? }",
    );
  }

  const adapter = opts?.adapter ?? (await loadLigisAdapter());
  const report = await buildRiskReport(parsed, adapter);

  console.log(
    `[ligis-croo] risk report: verdict=${report.overallVerdict} score=${report.riskScore} checks=${report.checks.length}`,
  );

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(riskDeliverable(report), null, 2),
  };
}
