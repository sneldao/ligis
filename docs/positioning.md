# Ligis — positioning

> The single source of truth for what Ligis is, who it's for, and the
> claims the rest of the product makes. Every landing line, sales answer,
> README paragraph, and ad copy defers to this doc. When something here and
> something elsewhere disagree, this doc wins until it's changed.

## The line

**A spend firewall for AI agents: every payment is checked against the job
before money moves.**

That is the whole product in one sentence. Everything else in this doc is
the supporting vocabulary, the measured claims, and the words we use to
say it.

## What Ligis is, and is not

**Is.** A pre-payment decision service. An agent — or the wallet behind it
— calls Ligis with a payment intent; Ligis returns a decision plus the
signals that justify it. Decision is GO, STOP, or UNKNOWN. The decision is
a single API call: one read, one latency budget, one bill.

**Is not.** A credential registry, a portable identity product, a KYC
provider, or an issuer platform. Those are how Ligis produces one of the
four signals — the verifiable credential "verified payee" — and they are
why Ligis's decisions hold up under scrutiny. But they are not the wedge.
Saying "verifiable credentials" to a buyer who came for a spend firewall
mislabels the product.

## The buyer

Two buyers, in this order:

1. **The team that owns the agent's wallet.** They want the spend
   firewall to say GO when the payment is fine and STOP when it isn't.
   They buy predictability: per-check cost is bounded, optional monthly
   cap, no surprise bills from a runaway agent.
2. **A paid API (a merchant).** They want a deterministic "this requester
   is allowed to call you" check at checkout. They buy per-call through
   CROO at marketplace pricing, or through our direct API at
   infrastructure pricing.

The first buyer is the long-term customer. The second is the distribution
channel. Pricing, sales motion, and copy target buyer 1 first.

## The four signals

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

## Claims, with sources

Every number we print must trace to a file in the repo. When the
underlying measurement changes, the claim here changes with it.

| Claim                                               | Measured                                                                                       | Source                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Jev intent check latency (warm)                     | ~135–650 ms                                                                                    | `scripts/jev-transport-smoke.lastrun.txt`, `pnpm smoke:jev` |
| Jev intent check cost                               | ~$0.0001 per call (post-promo)                                                                 | same                                                        |
| End-to-end gate cold start (Casper credential read) | ~2–3 s, first call after process start                                                         | `AGENTS.md` "Live verification (2026-09-23, AI Gateway)"    |
| Fail-open on missing intent model                   | `SKIPPED`, never silent GO                                                                     | `web/lib/arena/judge.ts` (`skipped` reason is required)     |
| Privacy posture                                     | server-aggregate only, no client SDK, no tracking, no database between visitor and chain state | `web/app/embed/page.tsx` — same promise carried forward     |

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

These numbers are live as of the Phase 5 pricing update. They move
together in `SERVICE_PRICE_USD` (`packages/croo-adapter/src/services.ts`),
`croo-store-manifest.json`, and the live CROO Dashboard
(AGENTS.md requires the three stay in lockstep).

## What defers here

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
