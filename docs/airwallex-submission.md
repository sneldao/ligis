# Ligis — Evidence-Based Payment Control for Autonomous Finance

**Airwallex Agentic Banking Hackathon entry.** Starter kits: **3 Payment Ops
Incident Commander** (primary) and **1 Adaptive Treasury Controller**
(secondary), adapted to one product.

> Ligis makes sure autonomous finance agents pay for what the business
> actually authorized, not simply what an agent requests. It binds
> supplier identity, purchasing intent, spending mandates, and payment
> outcomes into an enforceable authorization workflow. Airwallex provides
> the settlement infrastructure.

Positioning source of truth: [`positioning.md`](positioning.md).
Competition and validation plan: [`strategy.md`](strategy.md).

## The problem

A procurement agent is authorized to buy a service from Supplier A for up
to $500. Then something changes. The supplier invoices $650, or the
supplier's payout destination changes. The same invoice arrives twice, or
a transfer times out and the agent retries.

Spend controls (limits, allowlists, card controls, approver routing) pass
all of these. The amount is under budget, the supplier is approved, and
the agent is allowed to pay. They are still the payment errors finance
teams lose money on and clear by hand.

**Ligis asks a different question.** A spend control asks whether the
payment is allowed. Ligis asks whether the payment is still justified by
what the business agreed to buy.

## The three questions

**Why Ligis instead of Airwallex's own controls or a smart-contract
wallet?** Those controls check a payment against rules. Neither holds the
purchase order, the payout destination approved with the supplier, or the
earlier attempt that timed out, so neither can tell a legitimate payment
from a changed-terms, duplicate, or unsafe-retry payment. Ligis keeps that
record and enforces it on the payout call. Airwallex stays the rail, and
its controls stay the outer fence.

**Who pays, and for what?** Platforms that run procurement, AP, or finance
agents for their customers pay. Each of their customers is a finance team
that would otherwise build these controls itself. The expensive problem is
duplicate payouts, payouts to changed bank details, overpayment beyond the
agreed price, and staff hours spent clearing exceptions. Pricing is per
controlled payment with a platform minimum. That is a hypothesis to test,
not a live price (see [`positioning.md`](positioning.md#pricing-model)).

**What can't generic agent-payment middleware easily replicate?** Rules
are easy to copy. Ligis's bet is on evidence and state: order-to-payment
binding that survives retries and settlement outcomes, supplier identity
evidence that carries across rails and chains, and a hash-addressed
evidence record for every decision. **This is a differentiation
hypothesis, not a proven moat.** We list what we need to validate below.

## How enforcement works

```
business ──authorizes──▶ PurchaseOrder + Mandate            (ledger)
agent    ──pay(order, invoice, amount, destination)──▶ ProcurementExecutor
                                                         │
                       reconcile prior attempts (Airwallex GET /transfers)
                                                         │
                              evaluate() — deterministic checks, no prompt
                                                         │
               ┌─────────── STOP / REVIEW ───────────────┤─────── GO ───────────┐
               ▼                                                                ▼
     no Airwallex call made                           POST /transfers/create (fresh request_id)
     decision + evidence hash recorded                attempt linked to decision + transfer id
     REVIEW → person approves, bound to               poll / reconcile to PAID or CANCELLED
     exact order·invoice·amount·destination           (failure_type recorded)
```

- **The agent never holds Airwallex credentials.** It gets one typed tool,
  `pay`. The executor holds the client ID and API key. A STOP or REVIEW is
  enforced because the transfer call is never made. No on-chain verdict is
  involved in that enforcement.
- **Money rules are code, not prompts.** That covers amounts, tolerances,
  mandates, duplicate locks, and state transitions, as the Airwallex guide
  recommends. A model may read an invoice or explain an exception. It
  cannot authorize a payment.
- **The destination is verified at the rail on every payment.** Before
  paying, the executor reads the supplier's beneficiary record from
  Airwallex (`GET /beneficiaries/{id}`) and compares its bank details with
  the fingerprint approved on the order. If someone edits the record (same
  `beneficiary_id`, new bank account), the result is STOP. If the record
  can't be read, the result is also STOP: Ligis fails closed.
- **Idempotency follows Airwallex's rules.** Each new attempt gets a fresh
  `request_id`. Any ambiguous result (a timeout, 429, 5xx, or network
  error) leaves the attempt UNKNOWN, and Ligis never retries it
  automatically. Only a definite 4xx rejection counts as "no transfer
  exists". A retry first looks up the original attempt by its
  `request_id`. A replacement gets a different `request_id` and records
  which attempt it replaces.
- **Budgets are serialized.** Payments under the same mandate are locked
  together, so concurrent invoices can't both spend the last of a budget.
- **Approvals are bound.** A REVIEW approval covers the exact order,
  invoice, amount, currency, and payout destination, and works once. A
  changed payout destination can never be approved inline. The supplier
  has to be re-approved.

The checks are listed in
[`positioning.md` → The order-bound checks](positioning.md#the-order-bound-checks).

## Demo scenarios

Run `pnpm demo:airwallex`. It uses fixture mode by default and the
Airwallex sandbox when `AWX_CLIENT_ID` / `AWX_API_KEY` are set; see
`.env.d/airwallex.env.example`. For each scenario the demo prints the
proposed action, the evidence checked, the decision, and the sandbox
outcome. The output is written to
`scripts/airwallex-procurement-demo.lastrun.txt`.

**A. The supplier that changed its terms.** An order for $500 from
Supplier A, with 10% tolerance.

1. A $650 invoice arrives. The result is **REVIEW**, and no transfer is
   made.
2. A $500 invoice to a changed payout destination arrives. The result is
   **STOP**, no transfer is made, and the supplier must be re-approved.
3. An otherwise-correct $500 invoice arrives, but the supplier's
   beneficiary record at the rail has been edited. The result is **STOP**,
   and no transfer is made.
4. Finance approves the $650 invoice, and the approval is bound to that
   exact payment. On resubmission the result is **GO**, and the transfer
   goes SENT → PAID.

**B. The ambiguous transfer** (kit 3).

1. The first transfer call times out, and the attempt is recorded as
   UNKNOWN.
2. The agent retries. Ligis reconciles by `request_id` and finds the
   transfer in flight. The result is **STOP**, and nothing is paid twice.
3. The bank fails the transfer: it ends CANCELLED with a `failure_type`.
   The agent retries, and the result is **GO** for a replacement with a
   new `request_id`. The replacement reaches PAID.
4. The incident record shows both the original attempt and the
   replacement.

**C. The constrained treasury** (kit 1). Three agents' obligations compete
for cash above a reserve floor:

- the critical obligation is funded;
- the deferrable obligation is deferred;
- whatever remains goes to review.

Every funded obligation still passes through the same order-bound checks.

Invariants the demo asserts, exiting non-zero if any fails: STOP and
REVIEW never create a transfer, and no invoice is ever PAID twice.

## What's built vs. what's not

| Built                                                                                  | Not built / not claimed                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/procurement`: controller, ledger, executor, Airwallex sandbox rail, treasury | ERP / purchase-order ingestion                           |
| Fixture rail with Airwallex's transfer state machine and `request_id` semantics        | Production Airwallex (sandbox only)                      |
| 25 unit tests covering every scenario and invariant                                    | Any customer, pilot, or measured loss figure             |
| Sandbox rail: request shapes checked against Airwallex docs and stubbed-fetch tests    | A recorded live-sandbox run: pending sandbox credentials |
| Stateless gate (`/api/gate`) and on-chain credentials on Monad / Pharos / Casper       | Credentials wired as the default supplier-identity check |

On-chain credentials, x402, and MCP are technical enablers, not the
headline. The supplier-identity check accepts a pluggable verifier, and a
Ligis credential read is one implementation.

## What we still have to validate

1. **Problem frequency.** Do finance teams hit duplicate payments, changed
   supplier details, and out-of-mandate agent purchases often enough to
   care?
2. **Willingness to pay.** Would they pay for a separate authorization
   layer, or do they expect Airwallex or their ERP to provide it?
3. **Integration value.** Does one controller work across more than one
   rail and agent runtime? If it only serves one Airwallex workflow, it is
   a feature, not a product.
