import { randomUUID } from "node:crypto";
import { evaluate } from "./controller.js";
import type { Ledger } from "./ledger.js";
import { mapTransferStatus, RailError, type PayoutRail } from "./rail.js";
import type {
  Approval,
  AttemptState,
  Decision,
  Money,
  PaymentAttempt,
  PaymentRequest,
} from "./types.js";

export interface PayResult {
  decision: Decision;
  executed: boolean;
  attempt?: PaymentAttempt;
}

export interface ExecutorDeps {
  ledger: Ledger;
  rail: PayoutRail;
  supplierVerifier?: (
    req: PaymentRequest,
  ) =>
    | { verified: boolean; source: string }
    | Promise<{ verified: boolean; source: string }>;
  now?: () => Date;
}

const UNRESOLVED: AttemptState[] = ["SUBMITTED", "UNKNOWN", "IN_FLIGHT"];

export class ProcurementExecutor {
  constructor(private deps: ExecutorDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Refresh unresolved attempts for an order from the rail. */
  private async reconcileOrder(orderId: string): Promise<void> {
    const attempts = await this.deps.ledger.attemptsForOrder(orderId);
    for (const attempt of attempts) {
      if (!UNRESOLVED.includes(attempt.state)) continue;
      await this.refreshAttempt(attempt);
    }
  }

  private async refreshAttempt(attempt: PaymentAttempt): Promise<void> {
    try {
      if (attempt.transferId) {
        const t = await this.deps.rail.getTransfer(attempt.transferId);
        await this.applyStatus(
          attempt,
          t.status,
          t.failureType,
          t.failureReason,
        );
      } else {
        const t = await this.deps.rail.findByRequestId(
          attempt.airwallexRequestId,
        );
        if (t) {
          attempt.transferId = t.transferId;
          await this.applyStatus(
            attempt,
            t.status,
            t.failureType,
            t.failureReason,
          );
        }
        // Not found + UNKNOWN stays UNKNOWN — still treated as unresolved.
      }
    } catch {
      // Rail unreachable: keep current state; unresolved stays unresolved.
    }
  }

  private async applyStatus(
    attempt: PaymentAttempt,
    status: string,
    failureType?: string,
    failureReason?: string,
  ): Promise<void> {
    const next = mapTransferStatus(status);
    const wasCancelled = attempt.state === "CANCELLED";
    attempt.state = next;
    if (next === "CANCELLED") {
      attempt.failureType = failureType;
      attempt.failureReason = failureReason;
      if (!wasCancelled) await this.releaseCommitment(attempt);
    }
    attempt.updatedAt = this.now().toISOString();
    await this.deps.ledger.putAttempt(attempt);
  }

  private async releaseCommitment(attempt: PaymentAttempt): Promise<void> {
    const order = await this.deps.ledger.getOrder(attempt.orderId);
    if (!order) return;
    const mandate = await this.deps.ledger.getMandate(order.mandateId);
    if (!mandate) return;
    mandate.committed = Math.max(0, mandate.committed - attempt.amount.amount);
    await this.deps.ledger.putMandate(mandate);
  }

  async pay(req: PaymentRequest): Promise<PayResult> {
    // Lock on the mandate (shared across invoices/orders) so committed and
    // cumulative checks are serialized; fall back to the order when unknown.
    const preOrder = await this.deps.ledger.getOrder(req.orderId);
    const key = preOrder
      ? `mandate:${preOrder.mandateId}`
      : `order:${req.orderId}`;
    return this.deps.ledger.withLock(key, async () => {
      await this.reconcileOrder(req.orderId);

      const order = await this.deps.ledger.getOrder(req.orderId);
      const mandate = order
        ? await this.deps.ledger.getMandate(order.mandateId)
        : undefined;
      const attempts = await this.deps.ledger.attemptsForOrder(req.orderId);
      const approvals = await this.deps.ledger.approvals();
      const approval = approvals.find(
        (a) =>
          !a.used &&
          a.boundTo.orderId === req.orderId &&
          a.boundTo.invoiceRef === req.invoiceRef &&
          a.boundTo.amount.amount === req.amount.amount &&
          a.boundTo.amount.currency === req.amount.currency &&
          a.boundTo.fingerprint === req.destination.fingerprint,
      );
      const supplierIdentity = this.deps.supplierVerifier
        ? await this.deps.supplierVerifier(req)
        : undefined;

      // Verify the beneficiary record at the rail hasn't drifted since
      // approval. Lookup failure fails closed (STOP).
      let railDestinationFingerprint: string | null | undefined;
      if (order) {
        try {
          railDestinationFingerprint =
            await this.deps.rail.getBeneficiaryFingerprint(
              order.supplier.beneficiaryId,
            );
        } catch {
          railDestinationFingerprint = null;
        }
      }

      const decision = evaluate(req, {
        order,
        mandate,
        attempts,
        approval,
        supplierIdentity,
        railDestinationFingerprint,
        now: this.now(),
      });
      await this.deps.ledger.putDecision(decision, req);

      if (decision.verdict !== "GO") {
        return { decision, executed: false };
      }

      const replaces = attempts
        .filter(
          (a) => a.invoiceRef === req.invoiceRef && a.state === "CANCELLED",
        )
        .at(-1)?.attemptId;

      const nowIso = this.now().toISOString();
      const attempt: PaymentAttempt = {
        attemptId: randomUUID(),
        orderId: req.orderId,
        invoiceRef: req.invoiceRef,
        decisionId: decision.decisionId,
        airwallexRequestId: randomUUID(),
        state: "SUBMITTED",
        amount: req.amount,
        replaces,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await this.deps.ledger.putAttempt(attempt);
      if (approval) {
        approval.used = true;
        await this.deps.ledger.putApproval(approval);
      }
      if (mandate) {
        mandate.committed += req.amount.amount;
        await this.deps.ledger.putMandate(mandate);
      }

      try {
        const t = await this.deps.rail.createTransfer({
          requestId: attempt.airwallexRequestId,
          beneficiaryId: order!.supplier.beneficiaryId,
          amount: req.amount,
          reference: req.invoiceRef,
          reason: req.reason ?? order!.purpose,
        });
        attempt.transferId = t.transferId;
        attempt.state = mapTransferStatus(t.status);
      } catch (err) {
        if (err instanceof RailError && err.isDefiniteRejection()) {
          // The rail validated and refused the request — no transfer exists.
          attempt.state = "CANCELLED";
          attempt.failureReason = `rejected by rail: ${err.code}`;
          await this.releaseCommitment(attempt);
        } else {
          // Timeout, 5xx, 429, or network error: the transfer may exist
          // server-side. Never auto-retry — reconcile by request_id first.
          attempt.state = "UNKNOWN";
        }
      }
      attempt.updatedAt = this.now().toISOString();
      await this.deps.ledger.putAttempt(attempt);
      return { decision, executed: true, attempt };
    });
  }

  async reconcile(attemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.deps.ledger.getAttempt(attemptId);
    if (!attempt) throw new Error(`attempt ${attemptId} not found`);
    await this.refreshAttempt(attempt);
    return attempt;
  }

  async approve(decisionId: string, approver: string): Promise<Approval> {
    const stored = await this.deps.ledger.getDecision(decisionId);
    if (!stored) throw new Error(`decision ${decisionId} not found`);
    if (stored.decision.verdict !== "REVIEW") {
      throw new Error(
        `decision ${decisionId} is ${stored.decision.verdict}, only REVIEW decisions are approvable`,
      );
    }
    const approvable = new Set(["price", "supplier-identity"]);
    const bad = stored.decision.checks.find(
      (c) =>
        c.result !== "pass" && c.result !== "skipped" && !approvable.has(c.id),
    );
    if (bad) {
      throw new Error(`check ${bad.id} is not approvable (${bad.detail})`);
    }
    const req = stored.request;
    const approval: Approval = {
      approvalId: randomUUID(),
      decisionId,
      approver,
      boundTo: {
        orderId: req.orderId,
        invoiceRef: req.invoiceRef,
        amount: req.amount,
        fingerprint: req.destination.fingerprint,
      },
      used: false,
    };
    await this.deps.ledger.putApproval(approval);
    return approval;
  }

  /** Ordered decision/attempt history for an order (reconciliation display). */
  async eventsFor(
    orderId: string,
  ): Promise<{ at: string; kind: "decision" | "attempt"; data: unknown }[]> {
    const attempts = await this.deps.ledger.attemptsForOrder(orderId);
    const events: {
      at: string;
      kind: "decision" | "attempt";
      data: unknown;
    }[] = [];
    for (const a of attempts) {
      events.push({ at: a.createdAt ?? "", kind: "attempt", data: a });
      const d = await this.deps.ledger.getDecision(a.decisionId);
      if (d)
        events.push({ at: d.decision.at, kind: "decision", data: d.decision });
    }
    return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
}
