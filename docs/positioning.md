# Ligis — positioning

> The single source of truth for what Ligis is, who it's for, and the
> claims the rest of the product makes. Every landing line, sales answer,
> README paragraph, and ad copy defers to this doc. When something here and
> something elsewhere disagree, this doc wins until it's changed.

## The line

**Evidence-based payment control for autonomous finance: Ligis makes sure
an agent pays for what the business actually authorized, not simply what
the agent requests.**

Ligis binds the original purchase decision (supplier identity, approved
payout destination, agreed price and tolerance, spending mandate) to every
later payment attempt and its settlement outcome. A payment goes ahead only
while it is still justified by that evidence.

That is the whole product in one paragraph. Everything else in this doc is
the supporting vocabulary, the measured claims, and the words we use to
say it.

## What Ligis is, and is not

**Is.** A payment authorization and execution layer for finance agents.
The business records what it agreed to buy, and the agent asks Ligis to
pay against that order. Ligis checks the request against the order and its
payment history and returns GO, STOP, or REVIEW, with the evidence behind
the verdict. The executor that holds the payout credentials (Airwallex
first) makes the transfer only on GO. It links the decision, the transfer,
and the final settlement state so finance can reconcile them.

Ligis keeps a stateless pre-payment check as well (`POST /api/gate`,
verdicts GO / STOP / UNKNOWN). That check is the entry point for agent
wallets and x402 merchants. The order-bound controller is the product we
are leading with.

**Is not.**

- A spend-limit product. Per-agent limits, allowlists, and approval
  routing are table stakes. Conto, Rigid, and Airwallex's own controls
  already provide them, and Ligis sits in front of them, not instead of
  them.
- A settlement rail. Airwallex moves the money.
- A credential registry, identity product, KYC provider, or issuer
  platform. On-chain credentials are one source of supplier-identity
  evidence. They are the reason Ligis's evidence holds up under scrutiny,
  not the headline. x402 and MCP are delivery mechanisms, not the product.

## The problem we are paid to solve

An agent is authorized to buy a service from Supplier A for up to $500.
Then something changes:

- the supplier sends a $650 invoice,
- the supplier's payout destination changes,
- the same invoice arrives twice, or
- a transfer times out and the agent retries a payment that may already
  be in flight.

A limit check, an allowlist, or a card control passes all four. The
amount is under budget, the supplier is approved, and the agent is
allowed to pay. Each one is still a loss or a manual exception for
finance. Ligis is built to catch exactly these cases, because it checks the
payment against the purchase decision and the payment history, not just
against a rule.

## The buyer

**Who pays: platforms that run procurement, accounts-payable, or finance
agents for their customers** (agent platforms, spend/AP software, and
fintechs adding autonomous payouts). Their customers are finance teams,
and each team would otherwise need its own order-to-payment controls.
The platform buys one control layer for all of its tenants.

**Who benefits: the finance team.** They see fewer duplicate payments,
fewer payouts to changed bank details, fewer out-of-mandate overpayments,
and fewer routine exceptions in the manual queue. Every payment carries a
record that links the order, decision, transfer, and settlement.

We are deliberately **not** selling SaaS directly to SMB finance teams
first. That route needs ERP and purchase-order/invoice ingestion before it
delivers value, and few SMBs run procurement agents today. If platform
discovery fails, a direct finance-team product is the fallback.

The existing buyers of the stateless gate (agent-wallet teams, and paid
APIs through CROO) remain a distribution channel. They are not the target
of the commercial case.

## The three questions

**1. Why Ligis instead of Airwallex's controls or a smart-contract
wallet?** Those controls answer "is this payment allowed?": a limit, an
allowlist, an approver. Ligis answers "is this payment still justified by
what we agreed to buy?" A smart-contract wallet or card control has no
record of the purchase order, the approved payout destination, or the
earlier attempt that timed out. Ligis keeps that record and enforces it on
the execution path. Airwallex remains the rail and its controls remain the
outer fence.

**2. Who pays, and what expensive problem are they paying to solve?**
Platforms running finance agents pay. The problem is the cost of three
failure modes: paying a supplier twice, paying to changed bank details,
and paying more than was agreed. Add the staff time spent clearing
exceptions that shouldn't have needed a human. The value is measured as
losses prevented plus exception hours removed. If that doesn't exceed the
price, the product isn't worth buying.

**3. What can't generic agent-payment middleware easily replicate?** Rules
are easy to copy. The defensible part is the evidence and state:

- order-to-payment binding that survives across attempts, retries, and
  settlement outcomes;
- supplier identity evidence that carries across payment providers and
  chains (Ligis credentials resolve on Monad, Pharos, Casper and
  Zcash-shielded payees today);
- a hash-addressed evidence record for every decision, and an honest
  REVIEW/UNKNOWN when the evidence isn't there.

**This is a differentiation hypothesis, not a proven moat.** Competitors
cover adjacent controls, and the depth of their order-to-payment support
is something we validate in discovery (see `docs/strategy.md`).

## The order-bound checks

The procurement controller (`packages/procurement`) evaluates every
payment request against its order with deterministic code, never a
prompt:

| Check                | What it answers                                                                                                                                            | On failure |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Order / expiry       | Is there a live authorized order for this payment?                                                                                                         | STOP       |
| Supplier destination | Does the invoice's payout destination, and the beneficiary record live at the rail, still match what was approved with the supplier? (unverifiable → STOP) | STOP       |
| Price                | Is the amount within the agreed price plus tolerance?                                                                                                      | REVIEW     |
| Order cumulative     | Do all invoices on this order still fit inside what was authorized?                                                                                        | STOP       |
| Duplicate invoice    | Has this invoice already been paid?                                                                                                                        | STOP       |
| Prior attempt        | Is an earlier attempt for this invoice still in flight or unconfirmed?                                                                                     | STOP       |
| Mandate              | Does this agent's mandate still have budget for it?                                                                                                        | STOP       |
| Supplier identity    | Is there verifiable evidence the supplier is who the order says (optional)?                                                                                | REVIEW     |

A REVIEW can be approved by a person. The approval is bound to the exact
order, invoice, amount, currency, and payout destination, and is single-use.
A changed payout destination is never approvable inline: the supplier has
to be re-approved.

## The four signals (stateless gate)

Every decision is justified by signals drawn from one place. A verdict
without its signal stack is not a Ligis verdict.

| Signal         | What it answers                                                     |
| -------------- | ------------------------------------------------------------------- |
| Right payee    | Does this payment go where the agent intended to send it?           |
| Right amount   | Is the amount plausible for the job the agent was hired to do?      |
| In scope       | Is this request consistent with what the agent is allowed to do?    |
| Verified payee | Is there an on-chain credential that says the payee is trustworthy? |

`verified payee` is the credential signal. It is one of four, not the
whole answer. Its source — Casper `CredentialRegistry`, Pharos
`CredentialRegistry`, cross-chain portability, the Steward loop — is the
moat. It appears in the verdict as provenance, not as the headline.

A signal that the model could not evaluate is reported as `SKIPPED` with
the reason. A verdict built on three signals is more honest than one built
on four that includes a made-up number. Unknown is a valid answer.

**These four are the four, and they stay the four until a fifth is built and
measured.** The planned extension — a _private, ZK-proven_ counterparty history
alongside the public registry evidence — is researched in
`docs/zk-reputation-evidence.md` and is not part of this product today. No
landing line, sales answer, or meta description may imply it.

## Claims, with sources

Every number we print must trace to a file in the repo. When the
underlying measurement changes, the claim here changes with it.

| Claim                                               | Measured                                                                                       | Source                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Jev intent check latency                            | 75–160 ms on production (`direct`)                                                             | `pnpm watchdog:jev` provenance line, 2026-10-18          |
| Jev intent check cost                               | ~$0.00005 per call                                                                             | same                                                     |
| End-to-end gate cold start (Casper credential read) | ~2–3 s, first call after process start                                                         | `AGENTS.md` "Live verification (2026-09-23, AI Gateway)" |
| Fail-open on missing intent model                   | `SKIPPED`, never silent GO                                                                     | `web/lib/arena/judge.ts` (`skipped` reason is required)  |
| Privacy posture                                     | server-aggregate only, no client SDK, no tracking, no database between visitor and chain state | `web/app/embed/page.tsx` — same promise carried forward  |

Banned: any unmeasured latency claim, "sub-second" without a source,
"verifiable credentials" in taglines and meta descriptions. The next
section gates the vocabulary.

## Glossary

Internal words mapped to user words. Use the user words in copy and meta.
Internal words stay internal.

| Internal   | User words                                         |
| ---------- | -------------------------------------------------- |
| subject    | payee                                              |
| capability | permission                                         |
| issuer     | verifier                                           |
| vouch      | verify a payee                                     |
| steward    | (product-internal; appears only on `/steward`)     |
| field      | (product-internal; appears only on `/field`)       |
| registry   | (product-internal; appears only in dev / API docs) |

If the surrounding sentence only makes sense with a credential term ("the
agent's `kyc.basic` credential"), the design is wrong. Lead with `verified
payee` and let the credential ID stay in the provenance line.

## Privacy posture

The gate is, and stays, a server-aggregate-only read:

- No client SDK ships to the visitor's browser.
- No third-party analytics, no fingerprinting, no cookies set by Ligis.
- No database between the request and the chain state — the embed badge
  reads live chain state on every load.
- Any aggregate counter we add in future (hero CTA clicks, gate runs by
  preset) lives in our own access log, sampled and rolled up server-side.
  We do not add client telemetry without updating this doc and the
  matching sentence on `/embed` in the same change.

This is the same posture `/embed` already commits to. Reproducing it here
keeps the gate and the embed page in one voice.

## Pricing model

### Procurement controller (lead product) — hypotheses, not live prices

Charging per API call undersells a control that blocks a $650
overpayment. The procurement controller is priced on **payments
controlled**, with a platform minimum. Every number below is a hypothesis
for customer discovery, not a verified market rate and not a live price:

| Model                    | Who pays                                    | Hypothesis to test                                      |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| Platform usage (lead)    | Agent / AP platforms running finance agents | Per controlled payment, with a monthly platform minimum |
| Platform licence (later) | Payment providers, multi-tenant platforms   | Annual contract, roughly €20k–€100k+                    |
| Direct SaaS (fallback)   | Finance teams running procurement agents    | Roughly €200–€1,000 / month                             |

The pricing test is simple: monthly price < (duplicate and altered
payouts prevented + exception hours removed). If a customer saves less
than they pay, the price or the segment is wrong.

### Stateless gate and CROO services — live prices

Per-call is the unit of sale. Two surfaces, one product.

**CROO marketplace (agent-to-agent):** per-call, listed at marketplace
prices. CROO charges its own commission on top; the agent-buyer pays a
premium because they are hiring a service, not subscribing to
infrastructure.

| Service         | Live (SERVICE_PRICE_USD)                                                             |
| --------------- | ------------------------------------------------------------------------------------ |
| `ligis.risk`    | $0.50                                                                                |
| `ligis.verify`  | $0.25                                                                                |
| `ligis.issue`   | $2.00 (evidence-gated; pricing reflects work, not volume)                            |
| `ligis.gate`    | $0.25 (the wedge; cheaper by design because it runs on every payment)                |
| `ligis.qualify` | $2.50 (one order saves vs. risk + verify + issue at $2.75 across three negotiations) |

**Direct API (`POST /api/gate`):** per-call at infrastructure pricing,
with monthly wallet plans for predictability.

| Plan    | Price     | Included checks | Overage        |
| ------- | --------- | --------------- | -------------- |
| Starter | $29 / mo  | 2,500           | $0.012 / check |
| Builder | $99 / mo  | 10,000          | $0.010 / check |
| Scale   | $499 / mo | 100,000         | $0.005 / check |
| Custom  | by quote  | by quote        | by quote       |

Per-call without a plan: $0.015 / check. The plan is a discount plus a
ceiling; per-call without a plan is the floor.

**Why the 17× spread.** CROO's $0.25/listing includes the marketplace
commission and the premium of hiring an agent-to-agent service. The
web/API plans charge infrastructure cost — the actual Jev call (~$0.0001)
plus provider overhead — because the buyer is subscribing to
infrastructure, not negotiating a service. Both prices are honest; the
difference reflects who is buying and through what channel.

These numbers are live as of the Phase 5 pricing update. They move
together in `SERVICE_PRICE_USD` (`packages/croo-adapter/src/services.ts`),
`croo-store-manifest.json`, and the live CROO Dashboard
(AGENTS.md requires the three stay in lockstep).

## Downstream copy not yet updated

The web landing (`web/app`), `/gate` copy, and the OKX.AI / CROO listings
still lead with "spend firewall". That describes the stateless gate and is
accurate for it. It moves to the new line when the procurement controller
gets a web surface.

## What defers here

- **Airwallex hackathon submission** → `docs/airwallex-submission.md`.
- **Private / ZK-proven counterparty history** → `docs/zk-reputation-evidence.md`
  (researched 2026-10-21; not built, not in the four signals, and this doc is
  unchanged until it ships and is measured).
- **Zcash shielded credential presentation** →
  `docs/zcash-shielded-credentials.md` (researched 2026-10-25; not built, not
  in the four signals, positioning unchanged). This is a Zecathon entry path:
  an additive shielded presentation channel behind the existing `ChainAdapter`
  boundary. It does not change what Ligis says today, and it does not add a
  fifth signal.
- **Competitive landscape** → `docs/strategy.md` (kept; not a positioning
  doc concern).
- **Roadmap and program status** → `docs/strategy.md` (kept; not a
  positioning doc concern).
- **Architecture, schema, contract layout** → `docs/architecture.md`.
- **CROO integration specifics** → `docs/croo-integration.md`.
- **OKX.AI ASP listing copy** → `docs/okx-ai.md` (will pull the line above
  when it lands).

## Change control

This doc is the source. Edits land here first; landing, README, design
doc, and sales answers are downstream of edits here. When something
shipped contradicts something in this doc, change this doc, then update
what shipped.

A copy-rule lint guards the tagline and meta layer in CI
(`scripts/lint-design.mjs`, Phase 1 work). The lint fails on banned
vocabulary in `web/app` and `web/components` so the doc stays honest.
