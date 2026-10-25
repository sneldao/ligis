export interface Money {
  amount: number;
  currency: string;
}

export interface ApprovedSupplier {
  supplierId: string;
  name: string;
  beneficiaryId: string;
  destinationFingerprint: string;
}

export interface PurchaseOrder {
  orderId: string;
  supplier: ApprovedSupplier;
  authorized: Money;
  priceTolerancePct: number;
  purpose: string;
  expiresAt: string;
  mandateId: string;
  requireVerifiedSupplier?: boolean;
}

export interface Mandate {
  mandateId: string;
  agentId: string;
  budget: Money;
  committed: number;
}

export interface PaymentRequest {
  orderId: string;
  invoiceRef: string;
  amount: Money;
  destination: {
    beneficiaryId?: string;
    fingerprint: string;
  };
  agentId: string;
  reason?: string;
}

export type Verdict = "GO" | "STOP" | "REVIEW";

export type CheckId =
  | "order"
  | "expiry"
  | "currency"
  | "supplier-destination"
  | "supplier-identity"
  | "price"
  | "order-cumulative"
  | "duplicate-invoice"
  | "prior-attempt"
  | "mandate"
  | "approval";

export interface Check {
  id: CheckId;
  result: "pass" | "fail" | "review" | "skipped";
  detail: string;
  evidence: Record<string, unknown>;
}

export interface Decision {
  decisionId: string;
  verdict: Verdict;
  checks: Check[];
  reason: string;
  evidenceHash: string;
  at: string;
}

export type AttemptState =
  | "SUBMITTED"
  | "UNKNOWN"
  | "IN_FLIGHT"
  | "PAID"
  | "CANCELLED";

export interface PaymentAttempt {
  attemptId: string;
  orderId: string;
  invoiceRef: string;
  decisionId: string;
  airwallexRequestId: string;
  transferId?: string;
  state: AttemptState;
  amount: Money;
  failureType?: string;
  failureReason?: string;
  replaces?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Approval {
  approvalId: string;
  decisionId: string;
  approver: string;
  boundTo: {
    orderId: string;
    invoiceRef: string;
    amount: Money;
    fingerprint: string;
  };
  used: boolean;
}
