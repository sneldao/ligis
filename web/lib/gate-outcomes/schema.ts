export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SOURCE_NAMES = [
  "ligis-credential",
  "erc8004",
  "x402-settlement",
  "nansen",
] as const;
export const SOURCE_STATUSES = [
  "positive",
  "negative",
  "unknown",
  "unavailable",
] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type SettlementContext = {
  chainId: number;
  asset: string;
  payer: string;
  payee: string;
  amountBaseUnits: string;
};
export type DecisionInput = {
  verdict: "GO" | "STOP" | "UNKNOWN";
  policyVersion: string;
  evidenceVersion: string;
  sources: Partial<Record<SourceName, SourceStatus>>;
  context: { payee: string; amountUsd: number; capability?: string };
  settlement?: SettlementContext;
};
export type OutcomeSubmission =
  | { decisionId: string; reportId: string; kind: "feedback" }
  | { decisionId: string; reportId: string; kind: "dispute" }
  | {
      decisionId: string;
      reportId: string;
      kind: "transaction";
      txHash: string;
      logIndex: number;
    };
export type OutcomeStatus =
  | "unverified-caller-feedback"
  | "pending-transaction"
  | "unverified-transaction"
  | "verified-reverted"
  | "verified-matching-settlement"
  | "unverified-service-dispute";
export type Outcome = {
  status: OutcomeStatus;
  verification: "verified" | "unverified" | "pending";
  reason: string;
  at: string;
  proofReference?: string;
};
export type DecisionRecord = {
  schemaVersion: 1;
  id: string;
  tenantHash: string;
  createdAt: string;
  expiresAt: number;
  policyVersion: string;
  evidenceVersion: string;
  verdict: DecisionInput["verdict"];
  sources: DecisionInput["sources"];
  contextBinding: string;
  settlement?: {
    chainId: number;
    assetHash: string;
    payerHash: string;
    payeeHash: string;
    amountBaseUnits: string;
  };
  outcome?: Outcome;
  /** Service feedback is not a payment status and cannot replace settlement. */
  dispute?: Outcome;
  reports: Record<string, string>;
};

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
const version = (s: unknown) =>
  typeof s === "string" && /^[a-z0-9._-]{1,64}$/i.test(s);
export function validSettlement(value: unknown): value is SettlementContext {
  return (
    object(value) &&
    exactKeys(value, [
      "chainId",
      "asset",
      "payer",
      "payee",
      "amountBaseUnits",
    ]) &&
    Number.isSafeInteger(value.chainId) &&
    (value.chainId as number) > 0 &&
    ["asset", "payer", "payee"].every(
      (key) =>
        typeof value[key] === "string" && ADDRESS.test(value[key] as string),
    ) &&
    typeof value.amountBaseUnits === "string" &&
    /^[1-9][0-9]{0,77}$/.test(value.amountBaseUnits) &&
    BigInt(value.amountBaseUnits) < 2n ** 256n
  );
}
export function validDecisionInput(value: unknown): value is DecisionInput {
  return (
    object(value) &&
    exactKeys(value, [
      "verdict",
      "policyVersion",
      "evidenceVersion",
      "sources",
      "context",
      "settlement",
    ]) &&
    ["GO", "STOP", "UNKNOWN"].includes(value.verdict as string) &&
    version(value.policyVersion) &&
    version(value.evidenceVersion) &&
    object(value.sources) &&
    Object.keys(value.sources).length > 0 &&
    Object.entries(value.sources).every(
      ([key, status]) =>
        SOURCE_NAMES.includes(key as SourceName) &&
        SOURCE_STATUSES.includes(status as SourceStatus),
    ) &&
    object(value.context) &&
    exactKeys(value.context, ["payee", "amountUsd", "capability"]) &&
    typeof value.context.payee === "string" &&
    value.context.payee.length > 0 &&
    value.context.payee.length <= 200 &&
    typeof value.context.amountUsd === "number" &&
    Number.isFinite(value.context.amountUsd) &&
    value.context.amountUsd > 0 &&
    value.context.amountUsd <= 1e9 &&
    (value.context.capability === undefined ||
      version(value.context.capability)) &&
    (value.settlement === undefined ||
      (validSettlement(value.settlement) &&
        value.settlement.payee.toLowerCase() ===
          value.context.payee.toLowerCase()))
  );
}
export function parseOutcomeSubmission(
  value: unknown,
): OutcomeSubmission | null {
  if (
    !object(value) ||
    typeof value.decisionId !== "string" ||
    !UUID.test(value.decisionId) ||
    typeof value.reportId !== "string" ||
    !UUID.test(value.reportId)
  )
    return null;
  if (value.kind === "feedback" || value.kind === "dispute") {
    return exactKeys(value, ["decisionId", "reportId", "kind"])
      ? {
          decisionId: value.decisionId.toLowerCase(),
          reportId: value.reportId.toLowerCase(),
          kind: value.kind,
        }
      : null;
  }
  if (
    value.kind === "transaction" &&
    exactKeys(value, [
      "decisionId",
      "reportId",
      "kind",
      "txHash",
      "logIndex",
    ]) &&
    typeof value.txHash === "string" &&
    TX_HASH.test(value.txHash) &&
    Number.isSafeInteger(value.logIndex) &&
    (value.logIndex as number) >= 0 &&
    (value.logIndex as number) <= 1_000_000
  )
    return {
      decisionId: value.decisionId.toLowerCase(),
      reportId: value.reportId.toLowerCase(),
      kind: "transaction",
      txHash: value.txHash.toLowerCase(),
      logIndex: value.logIndex as number,
    };
  return null;
}
