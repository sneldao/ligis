/**
 * Unified trust model — provider-agnostic signals, decisions, and receipts.
 *
 * One operational intent: trust a counterparty before a payment is released.
 * Any source of trust (Monid risk runs, on-chain capability reads, identity
 * lookups, policy checks) normalizes into a {@link TrustSignal}; the Steward
 * combines signals into a single {@link TrustDecision} with a GO/STOP verdict
 * and an anchored receipt. New providers plug in via {@link RiskProvider}
 * without touching the decision logic.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import type { EvidenceManifest } from "./evidence.js";

// ---------- Signals ----------

export type TrustSignalKind = "risk" | "capability" | "identity" | "policy";

export type TrustSignalVerdict = "go" | "stop" | "unknown";

export interface TrustSignal {
  kind: TrustSignalKind;
  /** Producing system: a provider name ("monid") or a chain id. */
  source: string;
  verdict: TrustSignalVerdict;
  /** 0-100 — how confident the source is in its verdict. */
  confidence: number;
  /** Measured per-check cost of producing this signal. */
  cost?: { amount: number; currency: string };
  metadata?: Record<string, unknown>;
}

// ---------- Risk providers ----------

export interface RiskProviderInput {
  counterparty: string;
  intent: string;
  amount?: string;
  capability?: string;
}

/**
 * A pluggable source of off-chain counterparty risk. Implementations run one
 * measured check per call and normalize the outcome into a single signal.
 * A provider that cannot produce a signal should return a `stop` signal with
 * the error in metadata — a missing risk signal must block a payment, not
 * silently pass it.
 */
export interface RiskProvider {
  /** Stable provider name; used as the signal `source`. */
  readonly name: string;
  resolve(input: RiskProviderInput): Promise<TrustSignal>;
}

// ---------- Decisions ----------

/**
 * How long a decision stays valid, in seconds. Pre-payment decisions are
 * short-lived by design: the counterparty's state can change at any block.
 */
export const TRUST_DECISION_TTL_SECONDS = 3600;

/**
 * The decision fields embedded in the {@link EvidenceManifest}. Deliberately
 * a summary — the full decision references the manifest as its receipt, so
 * embedding it back would recurse.
 */
export interface TrustDecisionSummary {
  verdict: "go" | "stop";
  intent: string;
  amount?: string;
  expiresAt: number;
}

export interface TrustDecision {
  /** The counterparty the decision is about; empty when self-directed. */
  counterparty: string;
  intent: string;
  amount?: string;
  signals: TrustSignal[];
  verdict: "go" | "stop";
  receipt: EvidenceManifest;
  /** Unix seconds — when this verdict stops being valid. */
  expiresAt: number;
}

// ---------- Cost comparison ----------

/**
 * Persona Essential published pricing — the incumbent the trust check
 * replaces. Sources: https://withpersona.com/pricing and
 * https://help.withpersona.com (verified for the Monid "We Kill" hackathon;
 * re-screenshot before filming in case the price changes).
 */
export const PERSONA_ESSENTIAL_PRICING = {
  name: "Persona Essential",
  monthlyUsd: 250,
  perCheckUsd: 1.5,
} as const;

export interface TrustCostComparison {
  incumbent: { name: string; monthlyUsd: number; perCheckUsd: number };
  provider: { name: string; perCheckUsd?: number };
  /** (incumbent − provider) / incumbent, in percent. Can be negative. */
  savingsPct?: number;
}

/** Per-check cost of a signal in USD, when the source reports one. */
export function signalCostUsd(signal: TrustSignal): number | undefined {
  if (!signal.cost) return undefined;
  const currency = signal.cost.currency.toUpperCase();
  return currency === "USD" || currency === "$"
    ? signal.cost.amount
    : undefined;
}

export function buildCostComparison(
  providerName: string,
  perCheckUsd?: number,
): TrustCostComparison {
  const savingsPct =
    perCheckUsd !== undefined
      ? Math.round(
          (1 - perCheckUsd / PERSONA_ESSENTIAL_PRICING.perCheckUsd) * 1000,
        ) / 10
      : undefined;
  return {
    incumbent: { ...PERSONA_ESSENTIAL_PRICING },
    provider: { name: providerName, perCheckUsd },
    ...(savingsPct !== undefined ? { savingsPct } : {}),
  };
}

// ---------- Receipts ----------

export interface TrustReceipt {
  counterparty: string;
  intent: string;
  amount?: string;
  signals: TrustSignal[];
  verdict: "go" | "stop";
  cost: TrustCostComparison;
  /** keccak256 over the canonical JSON of the anchored manifest. */
  manifestHash: string;
  storage?: { rootHash: string; txHash: string } | null;
  anchoredTokenUri?: string;
  expiresAt: number;
}

/**
 * Build the receipt for a decision. The provider cost is the summed per-check
 * cost of every risk signal that reported one; when nothing was measured the
 * comparison still renders, with the provider cost left to the dashboard.
 */
export function buildTrustReceipt(
  decision: TrustDecision,
  extras: {
    storage?: { rootHash: string; txHash: string } | null;
    anchoredTokenUri?: string | null;
  } = {},
): TrustReceipt {
  const riskSignals = decision.signals.filter((s) => s.kind === "risk");
  const sources = riskSignals.map((s) => s.source);
  const providerName = sources.length > 0 ? sources.join("+") : "none";
  const measured = riskSignals
    .map(signalCostUsd)
    .filter((c): c is number => c !== undefined);
  const perCheckUsd =
    measured.length > 0 ? measured.reduce((sum, c) => sum + c, 0) : undefined;

  return {
    counterparty: decision.counterparty,
    intent: decision.intent,
    ...(decision.amount !== undefined ? { amount: decision.amount } : {}),
    signals: decision.signals,
    verdict: decision.verdict,
    cost: buildCostComparison(providerName, perCheckUsd),
    manifestHash: hashManifest(decision.receipt),
    ...(extras.storage !== undefined ? { storage: extras.storage } : {}),
    ...(extras.anchoredTokenUri
      ? { anchoredTokenUri: extras.anchoredTokenUri }
      : {}),
    expiresAt: decision.expiresAt,
  };
}

// ---------- Manifest hashing ----------

/** Deterministic JSON: object keys sorted, undefined properties dropped. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",");
  return `{${body}}`;
}

/** keccak256 of the canonical JSON serialization of an evidence manifest. */
export function hashManifest(manifest: EvidenceManifest): string {
  const bytes = keccak_256(new TextEncoder().encode(canonicalJson(manifest)));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
