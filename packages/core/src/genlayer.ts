/**
 * GenLayer JobEscrow interface freeze (Stream 0).
 *
 * Canonical prose: docs/genlayer-interface-v1.md
 * Matches packages/contracts-genlayer/contracts/JobEscrow.py
 */

import { capabilityHash } from "./hash.js";

/** Agent Tank / Studio Next targets. */
export const GENLAYER_STUDIO_NEXT = {
  networkName: "genlayer-studio-next",
  chainId: 61997,
  rpcUrl: "https://studio-dev.genlayer.com/api",
  explorerAddressUrl: (address: string) =>
    `https://explorer-studio-dev.genlayer.com/address/${address}`,
} as const;

/** Default capability gated for v1 commerce escrow demos. */
export const GENLAYER_DEFAULT_CAPABILITY = "agent.commerce.escrow";

/** Default Ligis chain for Option A pre-flight. */
export const GENLAYER_DEFAULT_LIGIS_CHAIN = "casper-testnet";

/**
 * Job lifecycle statuses stored in Job.status.
 * Terminal payout uses `claimed: true` while status stays resolved_*.
 */
export const JOB_STATUSES = [
  "open",
  "delivered",
  "disputed",
  "resolved_release",
  "resolved_refund",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Ligis eligibility proof — JSON keys match JobEscrow.create_job / get_gate_receipt.
 */
export interface GateReceipt {
  subject: string;
  capability: string;
  /** Optional; recommended for Ligis parity with capabilityHash(). */
  capabilityHash?: `0x${string}`;
  capable: boolean;
  ligisChain: string;
  proofRef: string;
  checkedAt: number;
}

/** Wire shape for gate_receipt_json (snake_case). */
export interface GateReceiptJson {
  subject: string;
  capability: string;
  capability_hash?: string;
  capable: boolean;
  ligis_chain: string;
  proof_ref: string;
  checked_at: number;
}

/** Full job view from get_job JSON. */
export interface JobView {
  id: number;
  buyer: string;
  seller: string;
  brief: string;
  stake: string;
  status: JobStatus;
  evidenceUri: string;
  disputeReason: string;
  verdictSummary: string;
  requiredCapability: string;
  subject: string;
  createdAt: number;
  deliveredAt: number;
  disputedAt: number;
  resolvedAt: number;
  claimed: boolean;
}

export interface CheckLigisGateInput {
  subject: string;
  capability?: string;
  ligisChain?: string;
}

/** Args for payable create_job. */
export interface CreateJobArgs {
  seller: string;
  brief: string;
  requiredCapability: string;
  gate: GateReceipt;
  /** Native stake in wei (string preferred for u256). */
  valueWei: string | bigint;
}

export function gateReceiptToJson(receipt: GateReceipt): GateReceiptJson {
  const out: GateReceiptJson = {
    subject: receipt.subject,
    capability: receipt.capability,
    capable: receipt.capable,
    ligis_chain: receipt.ligisChain,
    proof_ref: receipt.proofRef,
    checked_at: receipt.checkedAt,
  };
  if (receipt.capabilityHash) {
    out.capability_hash = receipt.capabilityHash;
  }
  return out;
}

export function gateReceiptToJsonString(receipt: GateReceipt): string {
  return JSON.stringify(gateReceiptToJson(receipt));
}

export function gateReceiptFromJson(
  raw: GateReceiptJson | Record<string, unknown>,
): GateReceipt {
  const r = raw as Record<string, unknown>;
  const capability = String(r.capability ?? "");
  const hashRaw = r.capability_hash ?? r.capabilityHash;
  return {
    subject: String(r.subject ?? ""),
    capability,
    capabilityHash:
      typeof hashRaw === "string" && hashRaw.startsWith("0x")
        ? (hashRaw as `0x${string}`)
        : capability
          ? capabilityHash(capability)
          : undefined,
    capable: Boolean(r.capable),
    ligisChain: String(r.ligis_chain ?? r.ligisChain ?? ""),
    proofRef: String(r.proof_ref ?? r.proofRef ?? ""),
    checkedAt: Number(r.checked_at ?? r.checkedAt ?? 0),
  };
}

export function buildGateReceipt(
  partial: Omit<GateReceipt, "capabilityHash"> & {
    capabilityHash?: `0x${string}`;
  },
): GateReceipt {
  const capability = partial.capability || GENLAYER_DEFAULT_CAPABILITY;
  return {
    subject: partial.subject,
    capability,
    capabilityHash: partial.capabilityHash ?? capabilityHash(capability),
    capable: partial.capable,
    ligisChain: partial.ligisChain || GENLAYER_DEFAULT_LIGIS_CHAIN,
    proofRef: partial.proofRef,
    checkedAt: partial.checkedAt,
  };
}

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

/** Parse get_job JSON string or object into JobView. */
export function jobViewFromContract(
  raw: string | Record<string, unknown>,
): JobView {
  const obj: Record<string, unknown> =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : raw;
  const num = (v: unknown) => Number(v ?? 0);
  const str = (v: unknown) => String(v ?? "");
  const status = str(obj.status);
  if (!isJobStatus(status)) {
    throw new Error(`Unknown job status from contract: ${status}`);
  }
  return {
    id: num(obj.id),
    buyer: str(obj.buyer),
    seller: str(obj.seller),
    brief: str(obj.brief),
    stake: str(obj.stake),
    status,
    evidenceUri: str(obj.evidence_uri ?? obj.evidenceUri),
    disputeReason: str(obj.dispute_reason ?? obj.disputeReason),
    verdictSummary: str(obj.verdict_summary ?? obj.verdictSummary),
    requiredCapability: str(obj.required_capability ?? obj.requiredCapability),
    subject: str(obj.subject),
    createdAt: num(obj.created_at ?? obj.createdAt),
    deliveredAt: num(obj.delivered_at ?? obj.deliveredAt),
    disputedAt: num(obj.disputed_at ?? obj.disputedAt),
    resolvedAt: num(obj.resolved_at ?? obj.resolvedAt),
    claimed: Boolean(obj.claimed),
  };
}

/** create_job genlayer-js args (value passed separately as tx value). */
export function createJobCallArgs(args: CreateJobArgs): unknown[] {
  return [
    args.seller,
    args.brief,
    args.requiredCapability,
    gateReceiptToJsonString(args.gate),
  ];
}
