/**
 * ligis.qualify — one order from "not credentialed" to "credentialed".
 *
 * The funnel collapse: instead of buying `ligis.risk` ($0.75), discovering the
 * capability is missing, then buying `ligis.issue` ($2.00) and re-running the
 * check, the buyer makes one call that answers the same question end to end —
 * check → mint what policy allows → re-check — and returns both verdicts.
 *
 * Non-negotiable rule: **payment alone never mints trust.** A capability is
 * issued only when
 *
 *   1. the request carries external evidence for it and that evidence passes
 *      the shared attestation policy (`LIGIS_EAS_*`), or
 *   2. the capability is explicitly allowlisted as self-issuable
 *      (`LIGIS_SELF_ISSUABLE_CAPABILITIES`, empty by default).
 *
 * `ligis.issue` enforces the identical rule, so this is a funnel collapse and
 * not a bypass.
 *
 * Anything else is refused with the evidence that would unlock it. Without this
 * rule a paid "make me pass" service turns `ligis.risk` into a purchase link
 * and hollows out the credential — `kyc.basic` is a weight-4 critical
 * capability precisely because it is not supposed to be buyable.
 *
 * Two honesty constraints shape the deliverable:
 *   - A freshly issued credential is immature (the risk model has a 7-day
 *     maturity threshold), so a successful run lands on `warn`, not `pass`.
 *   - A submitted credential may not be readable immediately, so the re-check
 *     retries briefly and, if the read still lags, says so with the tx hash
 *     instead of reporting a failure the buyer didn't cause.
 */
import { loadLigisAdapter } from "./config.js";
import {
  SERVICE_ID,
  type ServiceRequest,
  type ServiceResult,
  isSelfIssuable,
  parseServiceRequirements,
} from "./services.js";
import {
  evidenceRequiredRefusal,
  issueCredential,
  verifyExternalAttestation,
  type AttestationDeps,
  type ExternalAttestationRequirement,
  type IssueResult,
  type Provenance,
} from "./credential-ops.js";
import { buildRiskReport, type PathToTrust, type RiskReport } from "./risk.js";
import type { ChainAdapter } from "@ligis/core";

/**
 * Re-read budget after issuance, so a lagging RPC doesn't read as a failure.
 *
 * Deliberately small: the provider kills a handler at 30s, and a Casper
 * issuance alone can take ~10s. Worst case here is roughly
 * entry check + issue + (attempts - 1) x (delay + re-read).
 */
const DEFAULT_SETTLE_ATTEMPTS = 2;
const DEFAULT_SETTLE_DELAY_MS = 1_500;

interface QualifyEvidence {
  capability: string;
  externalAttestation: ExternalAttestationRequirement;
}

interface QualifyRequirements {
  subject: string;
  /** One or more capabilities the counterparty must hold. */
  capabilities: string[] | string;
  /** Optional trusted issuer address. */
  issuer?: string;
  /** Minimum required credential expiry in seconds. Defaults to 24 hours. */
  minTtlSeconds?: number;
  /** Lifetime for any credential issued during this call. Defaults to 24 hours. */
  expiresInSeconds?: number;
  /** Evidence for capabilities that policy will not self-issue. */
  evidence?: QualifyEvidence[];
}

interface QualifyDeps extends AttestationDeps {
  loadAdapter?: typeof loadLigisAdapter;
  /** How many times to re-read the chain after issuing. */
  settleAttempts?: number;
  /** Delay between re-reads, in ms. */
  settleDelayMs?: number;
}

/** Why a missing capability was not minted. */
interface SkippedCapability {
  capability: string;
  reason: "evidence-required" | "evidence-rejected" | "issuance-failed";
  detail: string;
}

function isExternalAttestation(
  value: unknown,
): value is ExternalAttestationRequirement {
  const v = value as Record<string, unknown>;
  return (
    typeof v === "object" &&
    v !== null &&
    v.source === "eas" &&
    typeof v.uid === "string" &&
    (v.chainId === undefined || typeof v.chainId === "string") &&
    (v.schema === undefined || typeof v.schema === "string")
  );
}

function isQualifyEvidence(value: unknown): value is QualifyEvidence {
  const v = value as Record<string, unknown>;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.capability === "string" &&
    isExternalAttestation(v.externalAttestation)
  );
}

function isQualifyRequirements(req: unknown): req is QualifyRequirements {
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
    (r.minTtlSeconds === undefined || typeof r.minTtlSeconds === "number") &&
    (r.expiresInSeconds === undefined ||
      typeof r.expiresInSeconds === "number") &&
    (r.evidence === undefined ||
      (Array.isArray(r.evidence) && r.evidence.every(isQualifyEvidence)))
  );
}

function capabilityList(requirements: QualifyRequirements): string[] {
  return Array.isArray(requirements.capabilities)
    ? requirements.capabilities
    : [requirements.capabilities];
}

function failingCapabilities(report: RiskReport): string[] {
  return report.checks
    .filter((check) => check.verdict === "fail")
    .map((check) => check.capability);
}

/**
 * Check, mint what policy allows, and re-check — in one order.
 */
export async function handleQualify(
  req: ServiceRequest,
  deps: QualifyDeps = {},
): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isQualifyRequirements(parsed)) {
    throw new Error(
      "ligis.qualify requirements must include { subject, capabilities: string[] | string, issuer?, minTtlSeconds?, expiresInSeconds?, evidence? }",
    );
  }

  const adapter = await (deps.loadAdapter ?? loadLigisAdapter)();
  const capabilities = capabilityList(parsed);
  const settleAttempts = deps.settleAttempts ?? DEFAULT_SETTLE_ATTEMPTS;
  const settleDelayMs = deps.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;

  // --- 1. Entry check: what does the buyer actually need? ---
  const entry = await buildRiskReport(parsed, adapter);
  const missing = failingCapabilities(entry);

  const issued: IssueResult[] = [];
  const skipped: SkippedCapability[] = [];

  // --- 2. Mint only what policy allows ---
  for (const capability of missing) {
    const evidence = parsed.evidence?.find((e) => e.capability === capability);

    let provenance: Provenance | null = null;
    if (evidence) {
      try {
        provenance = await verifyExternalAttestation(
          {
            subject: parsed.subject,
            capability,
            externalAttestation: evidence.externalAttestation,
          },
          deps,
        );
      } catch (err) {
        // Fail closed: rejected evidence never mints. It also doesn't fail the
        // whole order — the buyer still gets the check they paid for.
        skipped.push({
          capability,
          reason: "evidence-rejected",
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    } else if (!isSelfIssuable(capability)) {
      // Same refusal `ligis.issue` returns — one rule, one wording.
      skipped.push({ capability, ...evidenceRequiredRefusal(capability) });
      continue;
    }

    try {
      issued.push(
        await issueCredential({
          adapter,
          subject: parsed.subject,
          capability,
          expiresInSeconds: parsed.expiresInSeconds ?? 24 * 60 * 60,
          provenance,
        }),
      );
    } catch (err) {
      skipped.push({
        capability,
        reason: "issuance-failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- 3. Re-check (with a bounded settle budget) ---
  const { report: final, pending } = await settleAndRecheck({
    adapter,
    parsed,
    entry,
    issuedCapabilities: issued.map((i) => i.capability),
    attempts: settleAttempts,
    delayMs: settleDelayMs,
  });

  const stillFailing = failingCapabilities(final);
  const route = final.pathToTrust ?? entry.pathToTrust;

  const deliverable = {
    service: SERVICE_ID.qualify,
    subject: parsed.subject,
    capabilities: JSON.stringify(capabilities),
    issuedCount: issued.length,
    issued: JSON.stringify(issued),
    issuedCapabilities: JSON.stringify(issued.map((i) => i.capability)),
    skipped: JSON.stringify(skipped),
    /** Verdict before this call — the state the buyer paid to fix. */
    entryVerdict: entry.overallVerdict,
    entryRiskScore: entry.riskScore,
    /** Verdict after issuance. A fresh credential is immature → usually `warn`. */
    finalVerdict: final.overallVerdict,
    finalRiskScore: final.riskScore,
    /**
     * True when the counterparty no longer fails the check. `warn` counts as
     * qualified: the credential exists and matures into `pass`.
     */
    qualified: final.overallVerdict !== "fail",
    /**
     * Capabilities submitted on-chain that did not read back as held in time.
     * Present only when the read lagged — the credential exists (see `issued`
     * tx hashes), the registry just hadn't caught up.
     */
    verificationPending: JSON.stringify(pending),
    verdictNote:
      issued.length > 0 && pending.length === 0
        ? `Issued ${issued.length} credential(s); the check moved ${entry.overallVerdict} → ${final.overallVerdict}. Newly issued credentials mature to pass after 7 days.`
        : issued.length > 0
          ? `Issued ${issued.length} credential(s) on-chain (see tx hashes), but the registry had not caught up within ${settleAttempts} reads. Re-run ${SERVICE_ID.risk} shortly to confirm.`
          : `Nothing issued; the counterparty still fails ${stillFailing.join(" and ")}.`,
    checks: JSON.stringify(final.checks),
    signals: JSON.stringify(final.signals),
    breakdown: JSON.stringify(final.breakdown),
    ...(stillFailing.length > 0 && final.pathToTrust
      ? { pathToTrust: JSON.stringify(final.pathToTrust) }
      : {}),
    ...(route
      ? { pathToTrustRoute: JSON.stringify(describeRoute(route)) }
      : {}),
    checkedAt: new Date().toISOString(),
  };

  console.log(
    `[ligis-croo] qualify: ${capabilities.join(",")} — ` +
      `${entry.overallVerdict} → ${final.overallVerdict} ` +
      `(issued=${issued.length} skipped=${skipped.length} pending=${pending.length})`,
  );

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(deliverable, null, 2),
  };
}

/**
 * Re-read the check after issuance, retrying briefly so a lagging RPC read
 * isn't reported as a failure. Returns the last report either way, plus the
 * capabilities that were minted in this call but still don't read as held.
 */
async function settleAndRecheck(opts: {
  adapter: ChainAdapter;
  parsed: QualifyRequirements;
  entry: RiskReport;
  issuedCapabilities: string[];
  attempts: number;
  delayMs: number;
}): Promise<{ report: RiskReport; pending: string[] }> {
  if (opts.issuedCapabilities.length === 0) {
    return { report: opts.entry, pending: [] };
  }

  let report = await buildRiskReport(opts.parsed, opts.adapter);
  let pending = pendingOf(report, opts.issuedCapabilities);

  for (
    let attempt = 1;
    pending.length > 0 && attempt < opts.attempts;
    attempt++
  ) {
    await sleep(opts.delayMs);
    report = await buildRiskReport(opts.parsed, opts.adapter);
    pending = pendingOf(report, opts.issuedCapabilities);
  }

  return { report, pending };
}

function pendingOf(report: RiskReport, issuedCapabilities: string[]): string[] {
  const held = new Set(
    report.checks
      .filter((check) => check.capable)
      .map((check) => check.capability),
  );
  return issuedCapabilities.filter((capability) => !held.has(capability));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Only the routes a buyer can act on belong in a deliverable. */
function describeRoute(path: PathToTrust) {
  return {
    recommended: path.recommended,
    fallback: path.fallback,
    evidenceRequiredFor: path.evidenceRequiredFor,
    chain: path.chain,
    chainName: path.chainName,
    hint: path.hint,
  };
}
