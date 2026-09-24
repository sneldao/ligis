/**
 * CROO service catalog for Ligis.
 *
 * Each entry maps a service ID (registered in the CROO Dashboard) to the
 * input/output schema and the handler that fulfills it.
 */

export interface ServiceRequest {
  serviceId: string;
  /** JSON-encoded requirements from the requester */
  requirements: string;
}

export interface ServiceResult {
  /** DeliverableType.Text or DeliverableType.Schema */
  deliverableType: string;
  /** JSON-encoded result */
  deliverableText: string;
}

export type ServiceHandler = (req: ServiceRequest) => Promise<ServiceResult>;

/** Service metadata used for the Agent Store listing and runtime dispatch. */
export interface ServiceDescriptor {
  id: string;
  name: string;
  description: string;
  priceUsd: string;
  inputSchema: object;
  outputSchema: object;
  handler: ServiceHandler;
}

/**
 * Canonical Ligis service IDs.
 *
 * Single source of truth for the provider descriptors AND for any
 * cross-service pointer (e.g. the `ligis.risk` path-to-trust hint telling a
 * buyer which service to hire next). Never re-type these literals.
 */
export const SERVICE_ID = {
  risk: "ligis.risk",
  verify: "ligis.verify",
  issue: "ligis.issue",
  gate: "ligis.gate",
  qualify: "ligis.qualify",
} as const;

export const SUPPORTED_SERVICES = [
  SERVICE_ID.risk,
  SERVICE_ID.verify,
  SERVICE_ID.issue,
  SERVICE_ID.gate,
  SERVICE_ID.qualify,
] as const;

export type SupportedServiceId = (typeof SUPPORTED_SERVICES)[number];

/**
 * Canonical USD price per service, quoted as a string for CROO.
 *
 * Single source of truth for the Agent Store listings and for any hint that
 * quotes a price to a buyer. When you change a price here you must also
 * change the live CROO Dashboard listing — the Dashboard is what the buyer
 * is actually charged, so a mismatch here is a lie in the deliverable.
 */
export const SERVICE_PRICE_USD: Record<SupportedServiceId, string> = {
  [SERVICE_ID.risk]: "0.75",
  [SERVICE_ID.verify]: "0.50",
  [SERVICE_ID.issue]: "2.00",
  [SERVICE_ID.gate]: "1.00",
  // One order instead of risk ($0.75) + issue ($2.00) = $2.75, so the bundle
  // is visibly cheaper than the two-order path it replaces.
  [SERVICE_ID.qualify]: "2.50",
};

/**
 * Map of CROO listing UUID → Ligis service ID, built from the
 * `CROO_SERVICE_ID_*` environment variables.
 *
 * CROO sends the listing UUID as `service_id`, but Ligis dispatches by
 * service name, so this bridges the two. It also lets a deliverable hand a
 * buyer a listing UUID they can negotiate against directly.
 */
export const SERVICE_LISTING_ENV: Record<SupportedServiceId, string> = {
  [SERVICE_ID.risk]: "CROO_SERVICE_ID_LIGIS_RISK",
  [SERVICE_ID.verify]: "CROO_SERVICE_ID_LIGIS_VERIFY",
  [SERVICE_ID.issue]: "CROO_SERVICE_ID_LIGIS_ISSUE",
  [SERVICE_ID.gate]: "CROO_SERVICE_ID_LIGIS_GATE",
  [SERVICE_ID.qualify]: "CROO_SERVICE_ID_LIGIS_QUALIFY",
};

/**
 * Resolve the CROO listing UUID for a service from the environment.
 *
 * Returns null when unconfigured — callers must treat a missing UUID as
 * "hire by name on the Agent Store" rather than inventing an identifier.
 */
export function serviceListingId(
  service: SupportedServiceId,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[SERVICE_LISTING_ENV[service]]?.trim();
  return value ? value : null;
}

/**
 * Canonical env var listing capabilities that may be minted from payment
 * alone, without external evidence (comma-separated).
 *
 * Governs **every** minting service — `ligis.issue` and `ligis.qualify` apply
 * the same rule, so a buyer cannot bypass the gate by hiring the cheaper one.
 */
export const SELF_ISSUABLE_ENV = "LIGIS_SELF_ISSUABLE_CAPABILITIES";

/**
 * Former name of {@link SELF_ISSUABLE_ENV}, from when only `ligis.qualify`
 * enforced this. Still read so an existing deployment's allowlist keeps
 * working across the upgrade; the canonical var wins when both are set.
 */
export const LEGACY_SELF_ISSUABLE_ENV = "LIGIS_QUALIFY_SELF_ISSUABLE";

/**
 * Capabilities that may be minted without external evidence.
 *
 * Empty by default, and that default is load-bearing: a paid service that
 * mints whatever the buyer asks for turns `ligis.risk` into a purchase link
 * and makes the credential meaningless. Operators opt specific
 * low-criticality capabilities in for demos (e.g. `data.premium`); minting a
 * critical capability like `kyc.basic` without evidence should never be a
 * config away.
 */
export function selfIssuableCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[SELF_ISSUABLE_ENV] ?? env[LEGACY_SELF_ISSUABLE_ENV] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Whether a capability may be minted without evidence. */
export function isSelfIssuable(
  capability: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return selfIssuableCapabilities(env).includes(capability);
}

export function parseServiceRequirements(requirements: string): unknown {
  try {
    const parsed = JSON.parse(requirements);
    // CROO wraps the buyer's requirements in an envelope. The wrapper
    // key varies — we've seen both { text: "..." } and { deliverableText: "..." }.
    // Detect any single-key object whose value is a JSON string and unwrap it.
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      if (keys.length === 1) {
        const val = (parsed as Record<string, unknown>)[keys[0]];
        if (typeof val === "string") {
          try {
            return JSON.parse(val);
          } catch {
            // Inner value wasn't JSON — return as plain string
            return val;
          }
        }
      }
    }
    return parsed;
  } catch {
    throw new Error("Invalid JSON in negotiation requirements");
  }
}
