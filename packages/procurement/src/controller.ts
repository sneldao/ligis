import { createHash, randomUUID } from "node:crypto";
import type {
  Approval,
  Check,
  Decision,
  Mandate,
  Money,
  PaymentAttempt,
  PaymentRequest,
  PurchaseOrder,
} from "./types.js";

export interface EvaluateContext {
  order?: PurchaseOrder;
  mandate?: Mandate;
  /** All recorded attempts for this order (any invoice). */
  attempts: PaymentAttempt[];
  approval?: Approval;
  supplierIdentity?: { verified: boolean; source: string };
  /**
   * Fingerprint of the beneficiary record as it exists at the rail right now.
   * `undefined` = rail record not checked; `null` = lookup failed (fail closed).
   */
  railDestinationFingerprint?: string | null;
  now: Date;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function evidenceHash(req: PaymentRequest, ctx: EvaluateContext): string {
  const payload = canonical({
    request: req,
    order: ctx.order ?? null,
    mandate: ctx.mandate ?? null,
    attempts: ctx.attempts,
    railDestinationFingerprint: ctx.railDestinationFingerprint,
    supplierIdentity: ctx.supplierIdentity,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function moneyEq(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

function check(
  id: Check["id"],
  result: Check["result"],
  detail: string,
  evidence: Record<string, unknown> = {},
): Check {
  return { id, result, detail, evidence };
}

const UNRESOLVED = new Set(["SUBMITTED", "UNKNOWN", "IN_FLIGHT"]);

function approvalCovers(approval: Approval, req: PaymentRequest): boolean {
  return (
    !approval.used &&
    approval.boundTo.orderId === req.orderId &&
    approval.boundTo.invoiceRef === req.invoiceRef &&
    moneyEq(approval.boundTo.amount, req.amount) &&
    approval.boundTo.fingerprint === req.destination.fingerprint
  );
}

export function evaluate(req: PaymentRequest, ctx: EvaluateContext): Decision {
  const checks: Check[] = [];
  const order = ctx.order;
  const at = ctx.now.toISOString();

  const finalize = (): Decision => {
    const fail = checks.find((c) => c.result === "fail");
    const review = checks.find((c) => c.result === "review");
    const verdict = fail ? "STOP" : review ? "REVIEW" : "GO";
    return {
      decisionId: randomUUID(),
      verdict,
      checks,
      reason: (fail ?? review)?.detail ?? "all checks passed",
      evidenceHash: evidenceHash(req, ctx),
      at,
    };
  };

  if (!order) {
    checks.push(
      check(
        "order",
        "fail",
        "no purchase order found for orderId; payment is not justified by any PO",
        {
          orderId: req.orderId,
        },
      ),
    );
    for (const id of [
      "expiry",
      "currency",
      "supplier-destination",
      "supplier-identity",
      "price",
      "approval",
      "duplicate-invoice",
      "prior-attempt",
      "order-cumulative",
      "mandate",
    ] as const) {
      checks.push(check(id, "skipped", "no order to evaluate against"));
    }
    return finalize();
  }
  checks.push(
    check(
      "order",
      "pass",
      `purchase order ${order.orderId} found (supplier ${order.supplier.name})`,
      {
        orderId: order.orderId,
        supplierId: order.supplier.supplierId,
      },
    ),
  );

  if (ctx.now.getTime() > Date.parse(order.expiresAt)) {
    checks.push(
      check("expiry", "fail", `purchase order expired at ${order.expiresAt}`, {
        expiresAt: order.expiresAt,
        now: at,
      }),
    );
  } else {
    checks.push(
      check("expiry", "pass", `purchase order valid until ${order.expiresAt}`, {
        expiresAt: order.expiresAt,
      }),
    );
  }

  if (req.amount.currency !== order.authorized.currency) {
    checks.push(
      check(
        "currency",
        "fail",
        `invoice currency ${req.amount.currency} does not match order currency ${order.authorized.currency}`,
        { invoice: req.amount.currency, order: order.authorized.currency },
      ),
    );
  } else {
    checks.push(
      check(
        "currency",
        "pass",
        `currency ${req.amount.currency} matches order`,
        {},
      ),
    );
  }

  const fingerprintMatches =
    req.destination.fingerprint === order.supplier.destinationFingerprint;
  const beneficiaryMatches =
    req.destination.beneficiaryId === undefined ||
    req.destination.beneficiaryId === order.supplier.beneficiaryId;
  if (ctx.railDestinationFingerprint === null) {
    checks.push(
      check(
        "supplier-destination",
        "fail",
        "payout destination could not be verified at the rail; supplier must be re-approved",
        { beneficiaryId: order.supplier.beneficiaryId },
      ),
    );
  } else if (
    ctx.railDestinationFingerprint !== undefined &&
    ctx.railDestinationFingerprint !== order.supplier.destinationFingerprint
  ) {
    checks.push(
      check(
        "supplier-destination",
        "fail",
        "beneficiary record at the payout rail no longer matches the approved destination; supplier must be re-approved",
        {
          expectedFingerprint: order.supplier.destinationFingerprint,
          railFingerprint: ctx.railDestinationFingerprint,
          beneficiaryId: order.supplier.beneficiaryId,
        },
      ),
    );
  } else if (!fingerprintMatches || !beneficiaryMatches) {
    checks.push(
      check(
        "supplier-destination",
        "fail",
        "payout destination changed since approval; supplier must be re-approved",
        {
          expectedFingerprint: order.supplier.destinationFingerprint,
          presentedFingerprint: req.destination.fingerprint,
          expectedBeneficiaryId: order.supplier.beneficiaryId,
          presentedBeneficiaryId: req.destination.beneficiaryId ?? null,
        },
      ),
    );
  } else {
    checks.push(
      check(
        "supplier-destination",
        "pass",
        ctx.railDestinationFingerprint !== undefined
          ? "payout destination matches the approved supplier (verified at rail)"
          : "payout destination matches the approved supplier",
        { beneficiaryId: order.supplier.beneficiaryId },
      ),
    );
  }

  if (order.requireVerifiedSupplier) {
    if (!ctx.supplierIdentity) {
      checks.push(
        check(
          "supplier-identity",
          "skipped",
          "no supplier identity verifier configured",
        ),
      );
    } else if (!ctx.supplierIdentity.verified) {
      checks.push(
        check(
          "supplier-identity",
          "review",
          `supplier identity could not be verified (source: ${ctx.supplierIdentity.source})`,
          { source: ctx.supplierIdentity.source },
        ),
      );
    } else {
      checks.push(
        check(
          "supplier-identity",
          "pass",
          `supplier identity verified via ${ctx.supplierIdentity.source}`,
          { source: ctx.supplierIdentity.source },
        ),
      );
    }
  } else {
    checks.push(
      check(
        "supplier-identity",
        "skipped",
        "order does not require verified supplier identity",
      ),
    );
  }

  const limit = order.authorized.amount * (1 + order.priceTolerancePct / 100);
  const approved =
    ctx.approval && approvalCovers(ctx.approval, req)
      ? ctx.approval
      : undefined;
  let effectiveLimit = limit;
  if (req.amount.amount <= order.authorized.amount) {
    checks.push(
      check(
        "price",
        "pass",
        `amount ${req.amount.amount} within authorized ${order.authorized.amount}`,
        {
          amount: req.amount.amount,
          authorized: order.authorized.amount,
        },
      ),
    );
    checks.push(check("approval", "skipped", "no approval required"));
  } else if (req.amount.amount <= limit) {
    checks.push(
      check(
        "price",
        "pass",
        `amount ${req.amount.amount} within tolerance (${order.priceTolerancePct}% over ${order.authorized.amount})`,
        { amount: req.amount.amount, limit },
      ),
    );
    checks.push(check("approval", "skipped", "no approval required"));
  } else if (approved) {
    effectiveLimit = approved.boundTo.amount.amount;
    checks.push(
      check(
        "approval",
        "pass",
        `amount covered by approval ${approved.approvalId} from ${approved.approver}`,
        {
          approvalId: approved.approvalId,
          approver: approved.approver,
        },
      ),
    );
    checks.push(
      check(
        "price",
        "pass",
        `amount ${req.amount.amount} above tolerance but within approved amount ${approved.boundTo.amount.amount}`,
        { amount: req.amount.amount, approved: approved.boundTo.amount.amount },
      ),
    );
  } else {
    checks.push(
      check("approval", "skipped", "no valid approval bound to this request"),
    );
    checks.push(
      check(
        "price",
        "review",
        `amount ${req.amount.amount} exceeds authorized ${order.authorized.amount} + ${order.priceTolerancePct}% tolerance (${limit}); requires human approval`,
        { amount: req.amount.amount, limit },
      ),
    );
  }

  const sameInvoice = ctx.attempts.filter(
    (a) => a.invoiceRef === req.invoiceRef,
  );
  if (sameInvoice.some((a) => a.state === "PAID")) {
    checks.push(
      check(
        "duplicate-invoice",
        "fail",
        `invoice ${req.invoiceRef} already paid; refusing to pay twice`,
        { invoiceRef: req.invoiceRef },
      ),
    );
  } else {
    checks.push(
      check(
        "duplicate-invoice",
        "pass",
        `invoice ${req.invoiceRef} has not been paid`,
        {},
      ),
    );
  }

  const unresolved = sameInvoice.filter((a) => UNRESOLVED.has(a.state));
  const latestCancelled = sameInvoice
    .filter((a) => a.state === "CANCELLED")
    .at(-1);
  if (unresolved.length > 0) {
    checks.push(
      check(
        "prior-attempt",
        "fail",
        "prior attempt unresolved; reconcile before retrying",
        { attemptIds: unresolved.map((a) => a.attemptId) },
      ),
    );
  } else if (latestCancelled) {
    checks.push(
      check(
        "prior-attempt",
        "pass",
        `prior attempt ${latestCancelled.attemptId} ended CANCELLED; this payment replaces it`,
        { replaces: latestCancelled.attemptId },
      ),
    );
  } else {
    checks.push(
      check("prior-attempt", "pass", "no prior attempts for this invoice"),
    );
  }

  // Other invoices already committed against this order. The price check owns
  // a single invoice's size; this check owns the aggregate across invoices.
  const cumulative = ctx.attempts
    .filter(
      (a) =>
        a.invoiceRef !== req.invoiceRef &&
        (UNRESOLVED.has(a.state) || a.state === "PAID"),
    )
    .reduce((sum, a) => sum + a.amount.amount, 0);
  if (cumulative > 0 && cumulative + req.amount.amount > effectiveLimit) {
    checks.push(
      check(
        "order-cumulative",
        "fail",
        `cumulative ${cumulative} + ${req.amount.amount} exceeds order limit ${effectiveLimit}`,
        { cumulative, amount: req.amount.amount, limit: effectiveLimit },
      ),
    );
  } else {
    checks.push(
      check(
        "order-cumulative",
        "pass",
        `cumulative ${cumulative} + ${req.amount.amount} within order limit ${effectiveLimit}`,
        { cumulative, limit: effectiveLimit },
      ),
    );
  }

  const mandate = ctx.mandate;
  if (!mandate) {
    checks.push(
      check("mandate", "fail", `mandate ${order.mandateId} not found`),
    );
  } else if (mandate.agentId !== req.agentId) {
    checks.push(
      check(
        "mandate",
        "fail",
        `agent ${req.agentId} is not authorized under mandate ${mandate.mandateId} (agent ${mandate.agentId})`,
        { mandateId: mandate.mandateId, agentId: req.agentId },
      ),
    );
  } else if (mandate.budget.currency !== req.amount.currency) {
    checks.push(
      check(
        "mandate",
        "fail",
        `mandate budget currency ${mandate.budget.currency} does not match invoice ${req.amount.currency}`,
        {},
      ),
    );
  } else if (mandate.budget.amount - mandate.committed < req.amount.amount) {
    checks.push(
      check(
        "mandate",
        "fail",
        `mandate ${mandate.mandateId} exhausted: ${mandate.budget.amount - mandate.committed} available, ${req.amount.amount} requested`,
        { available: mandate.budget.amount - mandate.committed },
      ),
    );
  } else {
    checks.push(
      check(
        "mandate",
        "pass",
        `mandate ${mandate.mandateId} covers amount (${mandate.budget.amount - mandate.committed} available)`,
        { mandateId: mandate.mandateId },
      ),
    );
  }

  return finalize();
}
