/**
 * Capability criticality metadata for risk scoring.
 *
 * Not all capabilities carry the same risk weight. Losing `kyc.basic`
 * is a harder blocker than losing `data.premium`. This module encodes
 * the criticality hierarchy so the risk score reflects real-world
 * impact, not just a count of pass/fail checks.
 *
 * Weights are 1–4:
 *   1 = low      — convenience access, no funds at risk
 *   2 = medium   — operational capability, indirect fund exposure
 *   3 = high     — direct fund handling or identity claim
 *   4 = critical — legal/financial status, irreplaceable without re-verification
 */

export type Criticality = "low" | "medium" | "high" | "critical";

interface CapabilityMeta {
  weight: number;
  criticality: Criticality;
}

/**
 * Explicit per-capability metadata.
 *
 * Capabilities not listed here default to weight 2 (medium) — safe
 * default that doesn't over-penalize unknown capabilities but doesn't
 * treat them as trivial either.
 */
const CAPABILITY_META: Record<string, CapabilityMeta> = {
  // Identity / legal status — hardest to re-earn, highest impact
  "kyc.basic": { weight: 4, criticality: "critical" },
  "rwa.accredited": { weight: 4, criticality: "critical" },

  // Direct fund handling — escrow, swaps, bridges
  "agent.commerce.escrow": { weight: 3, criticality: "high" },
  "agent.commerce.swap": { weight: 3, criticality: "high" },
  "agent.commerce.bridge": { weight: 3, criticality: "high" },

  // Recurring payments, x402 — fund exposure but lower per-tx risk
  "agent.commerce.recurring": { weight: 2, criticality: "medium" },
  "agent.commerce.x402": { weight: 2, criticality: "medium" },

  // Trading — indirect fund exposure via third-party venue
  "trade.cex-retail": { weight: 2, criticality: "medium" },

  // Data access — no direct fund risk
  "data.premium": { weight: 1, criticality: "low" },
};

const DEFAULT_META: CapabilityMeta = { weight: 2, criticality: "medium" };

export function getCapabilityMeta(capability: string): CapabilityMeta {
  return CAPABILITY_META[capability] ?? DEFAULT_META;
}

export function capabilityWeight(capability: string): number {
  return getCapabilityMeta(capability).weight;
}

export function capabilityCriticality(capability: string): Criticality {
  return getCapabilityMeta(capability).criticality;
}
