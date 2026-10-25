import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate } from "../src/controller.js";
import { ProcurementExecutor } from "../src/executor.js";
import { destinationFingerprint } from "../src/fingerprint.js";
import { MemoryLedger } from "../src/ledger.js";
import { FixtureRail, RailError, type PayoutRail } from "../src/rail.js";
import { allocate } from "../src/treasury.js";
import type {
  Mandate,
  Money,
  PaymentRequest,
  PurchaseOrder,
} from "../src/types.js";

const FP_A = destinationFingerprint({
  country: "US",
  currency: "USD",
  accountNumber: "123456789",
  routingNumber: "021000021",
});
const FP_B = destinationFingerprint({
  country: "US",
  currency: "USD",
  accountNumber: "987654321",
  routingNumber: "021000021",
});

function order(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    orderId: "PO-1",
    supplier: {
      supplierId: "sup-a",
      name: "Supplier A",
      beneficiaryId: "ben-a",
      destinationFingerprint: FP_A,
    },
    authorized: { amount: 500, currency: "USD" },
    priceTolerancePct: 10,
    purpose: "PO-1 supplies",
    expiresAt: "2099-01-01T00:00:00Z",
    mandateId: "mand-1",
    ...overrides,
  };
}

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: "mand-1",
    agentId: "agent-1",
    budget: { amount: 5000, currency: "USD" },
    committed: 0,
    ...overrides,
  };
}

function request(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    orderId: "PO-1",
    invoiceRef: "INV-1",
    amount: { amount: 500, currency: "USD" },
    destination: { beneficiaryId: "ben-a", fingerprint: FP_A },
    agentId: "agent-1",
    ...overrides,
  };
}

function setup(opts: { balance?: number; rail?: PayoutRail } = {}) {
  const ledger = new MemoryLedger();
  const rail = opts.rail ?? new FixtureRail({ USD: opts.balance ?? 10_000 });
  if (rail instanceof FixtureRail) rail.registerBeneficiary("ben-a", FP_A);
  const executor = new ProcurementExecutor({ ledger, rail });
  return { ledger, rail, executor };
}

async function seed(
  ledger: MemoryLedger,
  o: PurchaseOrder = order(),
  m: Mandate = mandate(),
) {
  await ledger.putOrder(o);
  await ledger.putMandate(m);
}

async function settle(
  rail: FixtureRail,
  executor: ProcurementExecutor,
  transferId: string,
  attemptId: string,
) {
  await rail.transition(transferId, "SENT");
  await rail.transition(transferId, "PAID");
  const attempt = await executor.reconcile(attemptId);
  assert.equal(attempt.state, "PAID");
}

describe("executor GO path", () => {
  it("creates a transfer, links ids, reaches PAID", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);
    const res = await executor.pay(request());
    assert.equal(res.decision.verdict, "GO");
    assert.equal(res.executed, true);
    const attempt = res.attempt!;
    assert.equal(attempt.state, "IN_FLIGHT");
    assert.ok(attempt.transferId);
    assert.equal(attempt.decisionId, res.decision.decisionId);
    assert.equal(rail.createCalls, 1);

    await settle(rail, executor, attempt.transferId!, attempt.attemptId);
    const stored = await ledger.getAttempt(attempt.attemptId);
    assert.equal(stored!.state, "PAID");
    assert.equal(stored!.transferId, attempt.transferId);
  });
});

describe("changed destination", () => {
  it("STOPs without touching the rail and is not approvable", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);
    const res = await executor.pay(
      request({ destination: { beneficiaryId: "ben-b", fingerprint: FP_B } }),
    );
    assert.equal(res.decision.verdict, "STOP");
    assert.equal(res.executed, false);
    assert.match(res.decision.reason, /destination changed/);
    assert.equal(rail.createCalls, 0);
    await assert.rejects(() =>
      executor.approve(res.decision.decisionId, "cfo"),
    );
  });

  it("tampered beneficiary record at the rail → STOP, zero create calls", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);
    rail.tamperBeneficiary("ben-a", FP_B);
    const res = await executor.pay(request());
    assert.equal(res.decision.verdict, "STOP");
    assert.match(res.decision.reason, /payout rail no longer matches/);
    assert.equal(rail.createCalls, 0);
    await assert.rejects(() =>
      executor.approve(res.decision.decisionId, "cfo"),
    );
  });

  it("beneficiary lookup error → fail closed STOP", async () => {
    const { ledger, rail, executor } = setup();
    await seed(
      ledger,
      order({
        supplier: {
          supplierId: "s",
          name: "S",
          beneficiaryId: "ben-x",
          destinationFingerprint: FP_A,
        },
      }),
    );
    const res = await executor.pay(
      request({ destination: { beneficiaryId: "ben-x", fingerprint: FP_A } }),
    );
    assert.equal(res.decision.verdict, "STOP");
    assert.match(res.decision.reason, /could not be verified/);
    assert.equal(rail.createCalls, 0);
  });
});

describe("price tolerance and approvals", () => {
  it("$650 vs $500 tol 10% → REVIEW; approval binds exactly and is single-use", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);

    const over = request({ amount: { amount: 650, currency: "USD" } });
    const res1 = await executor.pay(over);
    assert.equal(res1.decision.verdict, "REVIEW");
    assert.equal(rail.createCalls, 0);

    await executor.approve(res1.decision.decisionId, "cfo@acme");
    const res2 = await executor.pay(over);
    assert.equal(res2.decision.verdict, "GO");
    assert.equal(rail.createCalls, 1);

    // Pay it to completion; the approval is now used.
    await settle(
      rail,
      executor,
      res2.attempt!.transferId!,
      res2.attempt!.attemptId,
    );

    // Binding variants on a fresh order so the paid $650 doesn't trip
    // order-cumulative.
    await ledger.putOrder(order({ orderId: "PO-2" }));

    // Different invoice — approval does not carry over.
    const res3 = await executor.pay(
      request({
        orderId: "PO-2",
        invoiceRef: "INV-2",
        amount: { amount: 650, currency: "USD" },
      }),
    );
    assert.equal(res3.decision.verdict, "REVIEW");

    // $651 — one dollar over the approved amount — approval does not apply.
    const res4 = await executor.pay(
      request({
        orderId: "PO-2",
        invoiceRef: "INV-3",
        amount: { amount: 651, currency: "USD" },
      }),
    );
    assert.equal(res4.decision.verdict, "REVIEW");

    // Different fingerprint — STOP (not approvable at all).
    const res5 = await executor.pay(
      request({
        orderId: "PO-2",
        invoiceRef: "INV-4",
        amount: { amount: 650, currency: "USD" },
        destination: { fingerprint: FP_B },
      }),
    );
    assert.equal(res5.decision.verdict, "STOP");
  });

  it("$540 is within 10% tolerance → GO", async () => {
    const { ledger, executor } = setup();
    await seed(ledger);
    const res = await executor.pay(
      request({ amount: { amount: 540, currency: "USD" } }),
    );
    assert.equal(res.decision.verdict, "GO");
    const price = res.decision.checks.find((c) => c.id === "price")!;
    assert.match(price.detail, /within tolerance/);
  });
});

describe("invoice idempotency", () => {
  it("refuses to pay an invoice already PAID", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);
    const res1 = await executor.pay(request());
    assert.equal(res1.decision.verdict, "GO");
    await settle(
      rail,
      executor,
      res1.attempt!.transferId!,
      res1.attempt!.attemptId,
    );
    const res2 = await executor.pay(request());
    assert.equal(res2.decision.verdict, "STOP");
    assert.match(res2.decision.reason, /already paid/);
    assert.equal(rail.createCalls, 1);
  });
});

describe("ambiguous transfer (timeout → reconcile → fail → replace)", () => {
  it("handles the full incident lifecycle", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);

    rail.failNextCreateWithTimeout();
    const res1 = await executor.pay(request());
    assert.equal(res1.decision.verdict, "GO");
    assert.equal(res1.attempt!.state, "UNKNOWN");
    const firstRequestId = res1.attempt!.airwallexRequestId;
    const mandateAfter = (await ledger.getMandate("mand-1"))!;
    assert.equal(mandateAfter.committed, 500);

    // Retry of the same invoice: reconciliation finds the in-flight transfer.
    const res2 = await executor.pay(request());
    assert.equal(res2.decision.verdict, "STOP");
    assert.match(res2.decision.reason, /prior attempt unresolved/);
    const attempt1 = await ledger.getAttempt(res1.attempt!.attemptId);
    assert.equal(attempt1!.state, "IN_FLIGHT");
    assert.ok(attempt1!.transferId);

    // The transfer fails server-side.
    await rail.transition(attempt1!.transferId!, "SENT");
    await rail.transition(
      attempt1!.transferId!,
      "FAILED",
      "INVALID_ACCOUNT_NAME_OR_NUMBER",
    );
    const reconciled = await executor.reconcile(attempt1!.attemptId);
    assert.equal(reconciled.state, "CANCELLED");
    assert.equal(reconciled.failureType, "INVALID_ACCOUNT_NAME_OR_NUMBER");
    assert.equal((await ledger.getMandate("mand-1"))!.committed, 0);

    // Retry → GO, replacement with a different request_id.
    const res3 = await executor.pay(request());
    assert.equal(res3.decision.verdict, "GO");
    assert.notEqual(res3.attempt!.airwallexRequestId, firstRequestId);
    assert.equal(res3.attempt!.replaces, attempt1!.attemptId);
    await settle(
      rail,
      executor,
      res3.attempt!.transferId!,
      res3.attempt!.attemptId,
    );
  });
});

describe("hard stops", () => {
  it("mandate exhausted → STOP", async () => {
    const { ledger, rail, executor } = setup();
    await seed(
      ledger,
      order(),
      mandate({ budget: { amount: 400, currency: "USD" } }),
    );
    const res = await executor.pay(request());
    assert.equal(res.decision.verdict, "STOP");
    assert.match(res.decision.reason, /exhausted/);
    assert.equal(rail.createCalls, 0);
  });

  it("expired order → STOP", async () => {
    const { ledger, executor } = setup();
    await seed(ledger, order({ expiresAt: "2020-01-01T00:00:00Z" }));
    const res = await executor.pay(request());
    assert.equal(res.decision.verdict, "STOP");
    assert.equal(
      res.decision.checks.find((c) => c.id === "expiry")!.result,
      "fail",
    );
  });

  it("currency mismatch → STOP", async () => {
    const { ledger, executor } = setup();
    await seed(ledger);
    const res = await executor.pay(
      request({ amount: { amount: 500, currency: "EUR" } }),
    );
    assert.equal(res.decision.verdict, "STOP");
    assert.match(res.decision.reason, /currency/);
  });

  it("cumulative partial invoices exceeding order → STOP", async () => {
    const { ledger, executor } = setup();
    await seed(ledger);
    // order 500, tol 10% → limit 550. Pay two partial invoices of 300 each.
    const r1 = await executor.pay(
      request({
        invoiceRef: "INV-p1",
        amount: { amount: 300, currency: "USD" },
      }),
    );
    assert.equal(r1.decision.verdict, "GO");
    const r2 = await executor.pay(
      request({
        invoiceRef: "INV-p2",
        amount: { amount: 300, currency: "USD" },
      }),
    );
    assert.equal(r2.decision.verdict, "STOP");
    assert.equal(
      r2.decision.checks.find((c) => c.id === "order-cumulative")!.result,
      "fail",
    );
  });

  it("missing order → STOP", async () => {
    const { ledger, executor } = setup();
    await seed(ledger);
    const res = await executor.pay(request({ orderId: "PO-nope" }));
    assert.equal(res.decision.verdict, "STOP");
  });
});

describe("concurrency", () => {
  it("two concurrent pay() of the same invoice → exactly one transfer", async () => {
    const { ledger, rail, executor } = setup();
    await seed(ledger);
    const [a, b] = await Promise.all([
      executor.pay(request()),
      executor.pay(request()),
    ]);
    const results = [a, b];
    assert.equal(results.filter((r) => r.executed).length, 1);
    assert.equal(rail.createCalls, 1);
  });

  it("different invoices sharing a mandate: only one fits → one transfer, other STOP", async () => {
    const { ledger, rail, executor } = setup();
    await seed(
      ledger,
      order(),
      mandate({ budget: { amount: 600, currency: "USD" } }),
    );
    const inv1 = request({ invoiceRef: "INV-c1" });
    const inv2 = request({ invoiceRef: "INV-c2" });
    const [a, b] = await Promise.all([executor.pay(inv1), executor.pay(inv2)]);
    const results = [a, b];
    assert.equal(results.filter((r) => r.executed).length, 1);
    assert.equal(
      results.filter((r) => r.decision.verdict === "STOP").length,
      1,
    );
    assert.equal(rail.createCalls, 1);
    assert.equal((await ledger.getMandate("mand-1"))!.committed, 500);
  });
});

describe("ambiguous create errors", () => {
  function errorRail(err: RailError): PayoutRail {
    return {
      createTransfer: async () => {
        throw err;
      },
      getTransfer: async () => {
        throw err;
      },
      findByRequestId: async () => null,
      getBalance: async () => 0,
      getBeneficiaryFingerprint: async () => FP_A,
    };
  }

  it("5xx from create → UNKNOWN (transfer may exist server-side)", async () => {
    const rail = errorRail(new RailError("internal", "internal_error", 500));
    const { ledger, executor } = setup({ rail });
    await seed(ledger);
    const res = await executor.pay(request());
    assert.equal(res.attempt!.state, "UNKNOWN");
    assert.equal((await ledger.getMandate("mand-1"))!.committed, 500);
  });

  it("400 from create → CANCELLED 'rejected by rail'", async () => {
    const rail = errorRail(new RailError("bad request", "invalid_amount", 400));
    const { ledger, executor } = setup({ rail });
    await seed(ledger);
    const res = await executor.pay(request());
    assert.equal(res.attempt!.state, "CANCELLED");
    assert.match(
      res.attempt!.failureReason!,
      /rejected by rail: invalid_amount/,
    );
    // Commitment released.
    assert.equal((await ledger.getMandate("mand-1"))!.committed, 0);
  });
});

describe("treasury allocate", () => {
  it("respects reserve floor, critical first, defers deferrables", () => {
    const ob = (
      id: string,
      amount: number,
      priority: "critical" | "normal" | "deferrable",
      dueAt: string,
    ) => ({
      obligationId: id,
      orderId: `PO-${id}`,
      amount: { amount, currency: "USD" } as Money,
      dueAt,
      priority,
    });
    const out = allocate({
      balance: 1000,
      reserveFloor: 200,
      now: new Date("2026-01-01"),
      obligations: [
        ob("def", 300, "deferrable", "2026-02-01"),
        ob("norm", 500, "normal", "2026-01-15"),
        ob("crit", 600, "critical", "2026-01-10"),
      ],
    });
    // available = 800. critical 600 funded → 200 left. normal 500 → review. deferrable → defer.
    assert.deepEqual(
      out.fund.map((f) => f.obligation.obligationId),
      ["crit"],
    );
    assert.deepEqual(
      out.review.map((f) => f.obligation.obligationId),
      ["norm"],
    );
    assert.deepEqual(
      out.defer.map((f) => f.obligation.obligationId),
      ["def"],
    );
  });
});

describe("evaluate determinism", () => {
  it("same inputs → same evidenceHash", async () => {
    const o = order();
    const m = mandate();
    const now = new Date("2026-01-01T00:00:00Z");
    const ctx = { order: o, mandate: m, attempts: [], now };
    const req = request();
    const d1 = evaluate(req, ctx);
    const d2 = evaluate(req, ctx);
    assert.equal(d1.evidenceHash, d2.evidenceHash);
    assert.equal(d1.verdict, "GO");
  });
});
