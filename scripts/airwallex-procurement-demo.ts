/**
 * Ligis × Airwallex procurement demo.
 *
 * Thesis: Ligis decides whether a payment is still justified by the ORIGINAL
 * purchase order — supplier identity, price tolerance, prior attempts, mandate —
 * not just whether the agent has budget. The executor is the only thing holding
 * Airwallex credentials, so a STOP means the transfer API call is never made.
 *
 * Fixture mode by default; live Airwallex sandbox when AWX_CLIENT_ID +
 * AWX_API_KEY are set (auto-loads .env.d/airwallex.env).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  AirwallexSandboxRail,
  FixtureRail,
  MemoryLedger,
  ProcurementExecutor,
  RailTimeoutError,
  allocate,
  destinationFingerprint,
  type Decision,
  type PayoutRail,
  type PaymentAttempt,
  type TransferSimulator,
} from "../packages/procurement/src/index.js";

const LASTRUN = "scripts/airwallex-procurement-demo.lastrun.txt";

function loadEnvFiles(...paths: string[]) {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

loadEnvFiles(".env.d/airwallex.env");

const LIVE = Boolean(process.env.AWX_CLIENT_ID && process.env.AWX_API_KEY);
const transcript: string[] = [];
const log = (...args: unknown[]) => {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  transcript.push(line);
  console.log(line);
};
const failures: string[] = [];

function invariant(cond: boolean, msg: string) {
  if (!cond) {
    failures.push(msg);
    log(`  !! INVARIANT VIOLATED: ${msg}`);
  }
}

function printDecision(
  label: string,
  action: string,
  d: Decision,
  outcome: string,
) {
  log(`\n  ${label}`);
  log(`  Proposed action : ${action}`);
  log(`  Evidence checked:`);
  for (const c of d.checks) {
    log(`    [${c.result.padEnd(7)}] ${c.id}: ${c.detail}`);
  }
  log(`  Decision        : ${d.verdict} — ${d.reason}`);
  log(`  Sandbox outcome : ${outcome}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mode = LIVE ? "live sandbox" : "fixture";
  log(`Ligis procurement controller demo — mode: ${mode}`);

  let baseRail: PayoutRail & TransferSimulator;
  let beneficiaryId: string;
  let fixture: FixtureRail | undefined;
  let timeoutNextCreate = false;

  if (LIVE) {
    const awx = new AirwallexSandboxRail({
      clientId: process.env.AWX_CLIENT_ID!,
      apiKey: process.env.AWX_API_KEY!,
    });
    baseRail = awx;
    beneficiaryId = process.env.AWX_BENEFICIARY_ID ?? "";
    if (!beneficiaryId) {
      log("  creating US LOCAL supplier beneficiary via schema…");
      await sleep(150);
      beneficiaryId = await awx.createBeneficiary({
        beneficiary: {
          type: "BANK_ACCOUNT",
          entity_type: "COMPANY",
          company_name: "Demo Supplier LLC",
          bank_details: {
            account_currency: "USD",
            account_number: "9990001111",
            routing_number: "021000021",
            bank_country_code: "US",
          },
        },
        payment_methods: ["LOCAL"],
        payer: { entity_type: "COMPANY", company_name: "Ligis Demo" },
      });
      log(`  beneficiary created: ${beneficiaryId}`);
    }
    await sleep(150);
  } else {
    fixture = new FixtureRail({ USD: 3_000 });
    baseRail = fixture;
    beneficiaryId = "ben-demo-a";
  }
  let railTampered = false;

  // In live mode, `timeoutNextCreate` makes the next create record server-side
  // but throw a timeout to the caller — the ambiguity scenario needs it.
  const rail: PayoutRail & TransferSimulator = {
    createTransfer: async (input) => {
      const h = await baseRail.createTransfer(input);
      if (timeoutNextCreate) {
        timeoutNextCreate = false;
        throw new RailTimeoutError();
      }
      return h;
    },
    getTransfer: (id) => baseRail.getTransfer(id),
    findByRequestId: (id) => baseRail.findByRequestId(id),
    getBalance: (c) => baseRail.getBalance(c),
    getBeneficiaryFingerprint: async (id) =>
      // Live mode can't edit a real beneficiary — simulate the tamper here.
      railTampered
        ? destinationFingerprint({
            country: "US",
            currency: "USD",
            accountNumber: "5551234567",
            routingNumber: "021000021",
          })
        : baseRail.getBeneficiaryFingerprint(id),
    transition: (id, to, ft) => baseRail.transition(id, to, ft),
  };

  const ledger = new MemoryLedger();
  const executor = new ProcurementExecutor({ ledger, rail });
  const fingerprints = {
    supplier: destinationFingerprint({
      country: "US",
      currency: "USD",
      accountNumber: "9990001111",
      routingNumber: "021000021",
    }),
    fraud: destinationFingerprint({
      country: "US",
      currency: "USD",
      accountNumber: "5551234567",
      routingNumber: "021000021",
    }),
  };
  fixture?.registerBeneficiary(beneficiaryId, fingerprints.supplier);
  const transfers = new Set<string>();
  const paidInvoices = new Set<string>();

  const track = (attempt?: PaymentAttempt) => {
    if (attempt?.transferId) transfers.add(attempt.transferId);
  };
  const trackPaid = (invoice: string, attempt?: PaymentAttempt) => {
    if (attempt?.state === "PAID") {
      invariant(!paidInvoices.has(invoice), `two PAID for invoice ${invoice}`);
      paidInvoices.add(invoice);
    }
  };

  async function mkOrder(id: string, amount: number) {
    await ledger.putOrder({
      orderId: id,
      supplier: {
        supplierId: "sup-a",
        name: "Supplier A",
        beneficiaryId,
        destinationFingerprint: fingerprints.supplier,
      },
      authorized: { amount, currency: "USD" },
      priceTolerancePct: 10,
      purpose: `${id} office supplies`,
      expiresAt: "2099-01-01T00:00:00Z",
      mandateId: "mand-proc",
    });
  }
  await ledger.putMandate({
    mandateId: "mand-proc",
    agentId: "procurement-agent",
    budget: { amount: 5_000, currency: "USD" },
    committed: 0,
  });

  const pace = () => (LIVE ? sleep(150) : Promise.resolve());

  // ---------- Scenario A ----------
  log("\n=== Scenario A: The supplier that changed its terms ===");
  await mkOrder("PO-A", 500);
  const baseReq = {
    orderId: "PO-A",
    agentId: "procurement-agent",
    destination: { beneficiaryId, fingerprint: fingerprints.supplier },
  };

  const a1 = await executor.pay({
    ...baseReq,
    invoiceRef: "INV-A1",
    amount: { amount: 650, currency: "USD" },
  });
  printDecision(
    "Invoice INV-A1: $650 against a $500 PO (10% tolerance)",
    "pay Supplier A $650",
    a1.decision,
    "no Airwallex call made",
  );
  invariant(a1.decision.verdict === "REVIEW", "A1 should be REVIEW");
  invariant(!a1.executed, "A1 must not execute");

  const a2 = await executor.pay({
    ...baseReq,
    invoiceRef: "INV-A2",
    amount: { amount: 500, currency: "USD" },
    destination: {
      beneficiaryId: "ben-fraud",
      fingerprint: fingerprints.fraud,
    },
  });
  printDecision(
    "Invoice INV-A2: $500 to a CHANGED payout destination",
    "pay Supplier A $500",
    a2.decision,
    "no Airwallex call made",
  );
  invariant(a2.decision.verdict === "STOP", "A2 should be STOP");
  invariant(!a2.executed, "A2 must not execute");

  log(
    "  Meanwhile, the beneficiary record at the rail is edited (same id, new bank details)…",
  );
  if (fixture) fixture.tamperBeneficiary(beneficiaryId, fingerprints.fraud);
  else railTampered = true;
  const a2b = await executor.pay({
    ...baseReq,
    invoiceRef: "INV-A3",
    amount: { amount: 500, currency: "USD" },
  });
  printDecision(
    "Invoice INV-A3: correct request, but the rail-side beneficiary was tampered",
    "pay Supplier A $500",
    a2b.decision,
    "no Airwallex call made",
  );
  invariant(a2b.decision.verdict === "STOP", "A3 should be STOP");
  invariant(!a2b.executed, "A3 must not execute");
  if (fixture) fixture.tamperBeneficiary(beneficiaryId, fingerprints.supplier);
  else railTampered = false;
  log("  Supplier re-verified; beneficiary record restored.");

  log("  Finance approves the $650 invoice…");
  await executor.approve(a1.decision.decisionId, "cfo@acme");
  const a3 = await executor.pay({
    ...baseReq,
    invoiceRef: "INV-A1",
    amount: { amount: 650, currency: "USD" },
  });
  track(a3.attempt);
  invariant(a3.decision.verdict === "GO", "A3 should be GO");
  await pace();
  await rail.transition(a3.attempt!.transferId!, "SENT");
  await pace();
  await rail.transition(a3.attempt!.transferId!, "PAID");
  const a3r = await executor.reconcile(a3.attempt!.attemptId);
  trackPaid("INV-A1", a3r);
  printDecision(
    "Resubmitted INV-A1 with approval bound to $650",
    "pay Supplier A $650",
    a3.decision,
    `transfer ${a3.attempt!.transferId} → ${a3r.state}`,
  );

  // ---------- Scenario B ----------
  log("\n=== Scenario B: The ambiguous transfer ===");
  await mkOrder("PO-B", 300);
  const bReq = {
    orderId: "PO-B",
    invoiceRef: "INV-B1",
    agentId: "procurement-agent",
    amount: { amount: 300, currency: "USD" },
    destination: { beneficiaryId, fingerprint: fingerprints.supplier },
  };

  if (fixture) fixture.failNextCreateWithTimeout();
  else timeoutNextCreate = true;
  const b1 = await executor.pay(bReq);
  invariant(b1.attempt?.state === "UNKNOWN", "B1 attempt should be UNKNOWN");
  log(
    `  create timed out client-side — attempt ${b1.attempt!.attemptId} is UNKNOWN`,
  );

  const b2 = await executor.pay(bReq);
  printDecision(
    "Agent retries the same invoice before reconciling",
    "pay Supplier A $300 (retry)",
    b2.decision,
    "no Airwallex call made",
  );
  invariant(b2.decision.verdict === "STOP", "B2 should be STOP");

  const orig = await ledger.getAttempt(b1.attempt!.attemptId);
  track(orig ?? undefined);
  await pace();
  await rail.transition(orig!.transferId!, "SENT");
  await pace();
  await rail.transition(
    orig!.transferId!,
    "FAILED",
    "INVALID_ACCOUNT_NAME_OR_NUMBER",
  );
  const origR = await executor.reconcile(orig!.attemptId);
  invariant(
    origR.state === "CANCELLED",
    "original attempt should be CANCELLED",
  );

  const b3 = await executor.pay(bReq);
  track(b3.attempt);
  printDecision(
    "Retry after the original transfer failed",
    "pay Supplier A $300 (replacement)",
    b3.decision,
    `transfer ${b3.attempt!.transferId} (request_id ${b3.attempt!.airwallexRequestId}); replaces attempt ${orig!.attemptId}`,
  );
  invariant(b3.decision.verdict === "GO", "B3 should be GO");
  invariant(
    b3.attempt!.airwallexRequestId !== orig!.airwallexRequestId,
    "replacement must use a new request_id",
  );
  await pace();
  await rail.transition(b3.attempt!.transferId!, "SENT");
  await pace();
  await rail.transition(b3.attempt!.transferId!, "PAID");
  const b3r = await executor.reconcile(b3.attempt!.attemptId);
  trackPaid("INV-B1", b3r);

  log("  Incident record:");
  for (const id of [orig!.attemptId, b3.attempt!.attemptId]) {
    const a = await ledger.getAttempt(id);
    log(
      `    attempt ${a!.attemptId}: state=${a!.state}` +
        (a!.failureType ? ` failure_type=${a!.failureType}` : "") +
        (a!.replaces ? ` replaces=${a!.replaces}` : ""),
    );
  }

  // ---------- Scenario C ----------
  log("\n=== Scenario C: The constrained treasury ===");
  const balance = await rail.getBalance("USD");
  log(`  Airwallex USD balance: ${balance.toFixed(2)}; reserve floor: 500.00`);
  const floor = Math.min(500, balance);
  await mkOrder("PO-C1", 1200);
  await mkOrder("PO-C2", 700);
  await mkOrder("PO-C3", 300);
  const plan = allocate({
    balance,
    reserveFloor: floor,
    now: new Date(),
    obligations: [
      {
        obligationId: "obl-crit",
        orderId: "PO-C1",
        amount: { amount: 1000, currency: "USD" },
        dueAt: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
        priority: "critical",
      },
      {
        obligationId: "obl-norm",
        orderId: "PO-C2",
        amount: { amount: 700, currency: "USD" },
        dueAt: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
        priority: "normal",
      },
      {
        obligationId: "obl-def",
        orderId: "PO-C3",
        amount: { amount: 600, currency: "USD" },
        dueAt: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        priority: "deferrable",
      },
    ],
  });
  for (const f of plan.fund)
    log(
      `  FUND   ${f.obligation.obligationId} $${f.obligation.amount.amount}: ${f.reason}`,
    );
  for (const f of plan.review)
    log(
      `  REVIEW ${f.obligation.obligationId} $${f.obligation.amount.amount}: ${f.reason}`,
    );
  for (const f of plan.defer)
    log(
      `  DEFER  ${f.obligation.obligationId} $${f.obligation.amount.amount}: ${f.reason}`,
    );

  for (const f of plan.fund) {
    const res = await executor.pay({
      orderId: f.obligation.orderId,
      invoiceRef: `INV-${f.obligation.obligationId}`,
      agentId: "procurement-agent",
      amount: f.obligation.amount,
      destination: { beneficiaryId, fingerprint: fingerprints.supplier },
    });
    track(res.attempt);
    printDecision(
      `Funded obligation ${f.obligation.obligationId} (${f.obligation.orderId})`,
      `pay $${f.obligation.amount.amount}`,
      res.decision,
      res.executed
        ? `transfer ${res.attempt!.transferId} → ${res.attempt!.state}`
        : "no Airwallex call made",
    );
    if (res.executed) {
      await pace();
      await rail.transition(res.attempt!.transferId!, "SENT");
      await pace();
      await rail.transition(res.attempt!.transferId!, "PAID");
      const rec = await executor.reconcile(res.attempt!.attemptId);
      trackPaid(res.attempt!.invoiceRef, rec);
      log(`  Transfer ${res.attempt!.transferId} settled → ${rec.state}`);
    }
    await pace();
  }

  log(`\nTransfers created: ${transfers.size}`);
  writeFileSync(
    LASTRUN,
    [
      `mode: ${mode}`,
      `ran_at: ${new Date().toISOString()}`,
      `beneficiary: ${beneficiaryId}`,
      `transfers: ${[...transfers].join(", ") || "none"}`,
      `invariant_failures: ${failures.length}`,
      "",
      "=== transcript ===",
      ...transcript,
    ].join("\n") + "\n",
  );
  log(`Wrote ${LASTRUN}`);
  if (failures.length) {
    console.error(`${failures.length} invariant failure(s)`);
    process.exit(1);
  }
  log(
    "All invariants held: STOP/REVIEW made zero transfers; no double-payment.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
