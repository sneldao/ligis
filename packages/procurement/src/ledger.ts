import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Approval,
  Decision,
  Mandate,
  PaymentAttempt,
  PaymentRequest,
  PurchaseOrder,
} from "./types.js";

export interface StoredDecision {
  decision: Decision;
  request: PaymentRequest;
}

export interface Ledger {
  putOrder(order: PurchaseOrder): Promise<void>;
  getOrder(orderId: string): Promise<PurchaseOrder | undefined>;
  putMandate(mandate: Mandate): Promise<void>;
  getMandate(mandateId: string): Promise<Mandate | undefined>;
  putAttempt(attempt: PaymentAttempt): Promise<void>;
  getAttempt(attemptId: string): Promise<PaymentAttempt | undefined>;
  attemptsForOrder(orderId: string): Promise<PaymentAttempt[]>;
  putDecision(decision: Decision, request: PaymentRequest): Promise<void>;
  getDecision(decisionId: string): Promise<StoredDecision | undefined>;
  putApproval(approval: Approval): Promise<void>;
  getApproval(approvalId: string): Promise<Approval | undefined>;
  approvals(): Promise<Approval[]>;
  /** Serialize all work touching a given orderId:invoiceRef pair. */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

interface LedgerState {
  orders: Record<string, PurchaseOrder>;
  mandates: Record<string, Mandate>;
  attempts: Record<string, PaymentAttempt>;
  decisions: Record<string, StoredDecision>;
  approvals: Record<string, Approval>;
}

function emptyState(): LedgerState {
  return {
    orders: {},
    mandates: {},
    attempts: {},
    decisions: {},
    approvals: {},
  };
}

abstract class BaseLedger implements Ledger {
  protected locks = new Map<string, Promise<unknown>>();

  protected abstract state(): Promise<LedgerState>;
  protected abstract persist(state: LedgerState): Promise<void>;

  async putOrder(order: PurchaseOrder): Promise<void> {
    const s = await this.state();
    s.orders[order.orderId] = order;
    await this.persist(s);
  }
  async getOrder(orderId: string): Promise<PurchaseOrder | undefined> {
    return (await this.state()).orders[orderId];
  }
  async putMandate(mandate: Mandate): Promise<void> {
    const s = await this.state();
    s.mandates[mandate.mandateId] = mandate;
    await this.persist(s);
  }
  async getMandate(mandateId: string): Promise<Mandate | undefined> {
    return (await this.state()).mandates[mandateId];
  }
  async putAttempt(attempt: PaymentAttempt): Promise<void> {
    const s = await this.state();
    s.attempts[attempt.attemptId] = attempt;
    await this.persist(s);
  }
  async getAttempt(attemptId: string): Promise<PaymentAttempt | undefined> {
    return (await this.state()).attempts[attemptId];
  }
  async attemptsForOrder(orderId: string): Promise<PaymentAttempt[]> {
    return Object.values((await this.state()).attempts).filter(
      (a) => a.orderId === orderId,
    );
  }
  async putDecision(
    decision: Decision,
    request: PaymentRequest,
  ): Promise<void> {
    const s = await this.state();
    s.decisions[decision.decisionId] = { decision, request };
    await this.persist(s);
  }
  async getDecision(decisionId: string): Promise<StoredDecision | undefined> {
    return (await this.state()).decisions[decisionId];
  }
  async putApproval(approval: Approval): Promise<void> {
    const s = await this.state();
    s.approvals[approval.approvalId] = approval;
    await this.persist(s);
  }
  async getApproval(approvalId: string): Promise<Approval | undefined> {
    return (await this.state()).approvals[approvalId];
  }
  async approvals(): Promise<Approval[]> {
    return Object.values((await this.state()).approvals);
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}

export class MemoryLedger extends BaseLedger {
  private store = emptyState();
  protected state(): Promise<LedgerState> {
    return Promise.resolve(this.store);
  }
  protected persist(): Promise<void> {
    return Promise.resolve();
  }
}

export class JsonFileLedger extends BaseLedger {
  private store: LedgerState;
  constructor(private path: string) {
    super();
    this.store = existsSync(path)
      ? { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) }
      : emptyState();
  }
  protected state(): Promise<LedgerState> {
    return Promise.resolve(this.store);
  }
  protected async persist(state: LedgerState): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2));
  }
}
