# Ligis — Product Strategy & Roadmap

> The trust layer for agent-to-agent commerce. Ligis aggregates external
> verification signals into portable on-chain credentials, then sells
> counterparty risk checks on the CROO Agent Store.

## The problem

Agent-to-agent commerce has a trust gap. When Agent A hires Agent B
autonomously, there's no human doing due diligence. The buyer agent needs
a fast, machine-readable signal: "is this counterparty safe to transact
with?" Without one, the answer is either "yes, blindly" or "no, because
we can't tell."

Wallets are not identities. Prompts are not permissions. An agent's
address existing on-chain doesn't mean it's trustworthy.

## The Ligis solution

Ligis is a **credential aggregator and risk scoring layer** for agent
commerce. It does two things:

1. **Issues credentials** by aggregating signals from external verifiers
   (Self Protocol, World ID, EAS attestations, wallet history) and
   minting unified on-chain credentials on Casper and Pharos.
2. **Verifies and scores** counterparties by reading those credentials
   on-chain and computing a pass/warn/fail verdict with a 0–100 risk
   score.

The credentials are portable (work across chains and platforms), signed
with secp256k1, and enforced on-chain by smart contracts. Any agent or
contract can verify them without trusting Ligis's server.

## Why aggregation solves the chicken-and-egg problem

The biggest risk for any credential-based trust system is the cold start:
no agents have credentials, so risk checks return `fail` for everyone,
so nobody uses the system, so nobody gets credentials.

**Ligis solves this by importing trust, not bootstrapping it.**

Existing verifiers already issue credentials in fragmented form:
- **Self Protocol** — ZK-based proof-of-human, $0.01/check
- **World ID** — biometric uniqueness, AgentKit for human-backed agents
- **EAS** — open attestation standard, anyone can issue
- **Wallet history** — on-chain tenure, transaction patterns
- **KYA** — agent identity scoring from wallet age and ownership trail

Each of these is a signal. None of them is integrated with CROO. No
individual verifier has incentive to integrate with a single agent
marketplace — the market is too small for them. But Ligis aggregating
all of them into one CROO-consumable credential creates value none of
them could create alone.

```
External verifiers          Ligis (aggregator)          CROO marketplace
──────────────────          ────────────────           ────────────────
Self Protocol ─────┐
World ID ──────────┤
EAS attestations ──┼──→  Issue unified          ──→  Agent has credential
Wallet history ────┤    on-chain credential         on CROO. Risk check
KYA scoring ───────┘    (Casper or Pharos)          returns pass/warn/fail
                        readable by anyone
```

An agent with a World ID verification → Ligis issues `kyc.basic`.
An agent with clean wallet history → Ligis issues `reputation.tenure`.
An agent with Self Protocol biometric → Ligis issues `identity.human-backed`.

The credentials already exist. Ligis normalizes them into one schema,
puts them on-chain, and makes them consumable through CROO.

## Competitive landscape

### Direct competitors

| Project | Model | Gap vs Ligis |
|---|---|---|
| **Nerq** | Proprietary API, trust score from provenance/behavior/audit. Sub-50ms. | Black box — no on-chain credentials, no portability, no issuer model. Agent can't verify how the score was computed. |
| **ATEP** | Portable reputation passport from execution logs. 4 trust tiers. | Reputation-based (past behavior), not credential-based (capabilities). No issuer model. No marketplace integration. |
| **EtereCitizen** | DID + on-chain reputation with temporal decay on Base. | Reputation-based, not credential-based. No issuer/verifier marketplace. No CROO integration. |
| **knowyouragent.network** | Wallet tenure, ownership trail, soulbound identity. 100K agents. | Proprietary scoring, no credential issuance, no marketplace integration. |

### Credential infrastructure (complementary, not competitive)

| Project | What they do | How Ligis uses them |
|---|---|---|
| **EAS** | Free, open attestation standard on Base/Ethereum. Anyone can register schemas. | Ligis could use EAS as an additional on-chain layer. EAS is plumbing; Ligis is the intelligence on top. |
| **Self Protocol** | ZK-based identity verification — age, nationality, proof-of-human. $0.01-$0.25/check. | Ligis consumes Self verifications as an input signal for credential issuance. |
| **World ID / AgentKit** | Biometric uniqueness, human-backed agent registration on World Chain. | Ligis maps World ID verification to `kyc.basic` or `identity.human-backed` credentials. |
| **KYH (Know Your Human)** | Aggregates Self, Didit, Human Passport → EAS attestation on Celo. 90-day credential. | Closest analog to Ligis's model, but for human KYC on Celo. Ligis does the same for agent capabilities on CROO. |

### Standards (complementary)

| Standard | What it defines |
|---|---|
| **TSAI (AWS)** | Open protocol, W3C VC-based, tiered trust (T0-T3), Trust Authorities issue credentials |
| **AIS-1** | Bonded identity pair (agent + sponsor), 3 tiers, on-chain verifyBond() |
| **A2A Trust (IETF draft)** | PKI-based agent identity, spawn chains, CA-signed templates |
| **KYA Standard** | W3C VC + JSON-LD manifest for agent governance/safety |

Ligis is compatible with these standards (uses W3C VC-style credentials,
DIDs, secp256k1 signatures) but doesn't depend on any single one. The
aggregation model means Ligis can map any external standard into its
credential schema.

## Differentiation

### 1. Aggregation, not origination

Ligis doesn't compete with Self or World ID on verification. It
aggregates their outputs into a unified credential that CROO agents can
use. This is the KYH model — proven for human KYC, unapplied to agent
capabilities.

### 2. On-chain, not API-only

Nerq returns a trust score from a proprietary API. Ligis issues
credentials on-chain (Casper/Pharos) that any agent or contract can
verify independently. The risk check is a read of on-chain state, not a
trust-the-server API call. This matters because:
- Agents can verify the credential without trusting Ligis's server
- Credentials persist even if Ligis goes offline
- Other platforms can read the same credentials without integrating with Ligis

### 3. Risk scoring with a defensible model

The risk score isn't a black box. It's a weighted average of
per-capability sub-scores, factoring in:
- **Capability criticality** — `kyc.basic` (weight 4) matters more than `data.premium` (weight 1)
- **TTL health** — how much time remains relative to the requested minimum
- **Credential maturity** — 7-day threshold filters flash-mint attacks
- **Issuer diversity** — concentration risk if all credentials come from one issuer

An agent can inspect the score breakdown and signals to understand why
it got `warn` instead of `pass`. This transparency is a feature that
proprietary scoring (Nerq, knowyouragent.network) can't offer.

### 4. Distribution built into the product (Thiel framing)

The product is the distribution channel:
- Every agent on CROO can hire Ligis (risk check)
- Every agent on CROO can get credentialed by Ligis (issuance)
- The marketplace is the distribution — no separate user acquisition needed
- As more agents hold Ligis credentials, the risk check becomes more
  valuable, driving more credential issuance (network effect)

### 5. Cross-chain portability

Credentials work across Casper and Pharos because `capabilityHash()`
and the issuer secp256k1 key are chain-neutral. An agent credentialed on
Casper is verifiable on Pharos without re-issuance. This makes Ligis
the trust layer for multi-chain agent commerce, not a single-chain
reputation system.

## Risks (honest assessment)

### CROO could build reputation natively

CROO's docs already mention "verifiable reputation" as a core feature.
If they build it themselves, Ligis is redundant.

**Mitigation:** The aggregation play is the defense. CROO won't integrate
with 6 different verifiers — but they'll integrate with one that
aggregates all of them. Once Ligis is the standard bridge, replacing it
means re-integrating every verifier.

### The market might not be real yet

All projections ($190-385B by 2030) assume agent commerce materializes
at scale. If it doesn't, none of this matters.

**Mitigation:** Being early with infrastructure is the right position.
If the market grows, Ligis is already integrated. If it doesn't, the
technology is still useful for human-to-agent trust (x402 Trust Gate,
credential-gated access).

### EAS could make Ligis unnecessary

If EAS on Base becomes the standard and agents get attestations
directly, why need Ligis?

**Answer:** EAS is data; Ligis is intelligence. Raw attestations don't
tell you whether an agent is safe to transact with. Ligis's risk scoring
model — weighted by capability criticality, TTL, maturity, issuer
diversity — is the value on top of raw attestations. But this only holds
if the scoring is genuinely better than what a competitor could build on
the same EAS data.

### Pricing vs. transaction value

$0.50 for verify, $0.75 for risk check. For a $5 task, that's 15%
overhead. For a $0.50 task, it's 150%.

**Mitigation:** Ligis is only relevant for transactions above ~$5-10.
Below that, the verification cost exceeds the risk. This is probably
fine — small transactions are low-stakes. But it means Ligis targets
the upper end of agent commerce, which may be a smaller slice of volume.
Subscription pricing or CROO-bundled pricing could address this.

## Roadmap

### Phase 1: Credential verification + risk check + issuance on CROO (done)

- [x] `ligis.verify` — on-chain credential verification via CROO
- [x] `ligis.risk` — counterparty risk check with pass/warn/fail + 0–100 score
- [x] `ligis.issue` — credential issuance with on-chain transaction submission
- [x] Provider running 24/7 under PM2 on dedicated infrastructure
- [x] Health endpoint, idempotent delivery, retry with backoff
- [x] CROO listing live with deliverable schema for all three services
- [x] End-to-end tested: issue → verify (`capable: true`) → risk (`warn`, maturing to `pass`)

### Phase 2: Aggregation issuance (next)

- [ ] `ligis.issue` becomes an aggregation service, not self-issuance
- [ ] Ship the chain-neutral external attestation boundary
- [ ] Add an EAS read adapter with schema + attester allowlists
- [ ] Integrate Self Protocol as the first human/controller verifier
- [ ] Agent requests credential through CROO (or directly)
- [ ] Ligis verifies the source proof and records provenance (no raw PII)
- [ ] Ligis issues unified on-chain credential on Casper/Pharos
- [ ] Agent now has a credential that any CROO risk check can verify
- [ ] Demo: agent gets credentialed → another agent runs risk check → gets `pass`

### Phase 3: Cross-platform portability

- [ ] Other agent marketplaces read Ligis credentials (they're on-chain, anyone can read)
- [ ] Ligis becomes the standard trust layer, not a CROO plugin
- [ ] CROO is the first distribution channel, not the only one
- [ ] SDK for third-party platforms to verify Ligis credentials

### Phase 4: Credential marketplace

- [ ] Third-party issuers issue Ligis-compatible credentials directly
- [ ] Ligis becomes the schema/verification standard, not just an aggregator
- [ ] Revenue shifts from per-check fees to issuer certification / schema registration
- [ ] Decentralized issuer registry on-chain

## Business model

### Current: per-check pricing on CROO

| Service | Price | Margin |
|---|---|---|
| `ligis.risk` | $0.75 | High — on-chain read + computation, no external API cost |
| `ligis.verify` | $0.50 | High — single on-chain read |
| `ligis.issue` | TBD | Cost depends on external verifier fees ($0.01-$0.25) + gas |

### Future: subscription + bundling

- **CROO-bundled:** CROO pays Ligis, includes verification in transaction fees
- **Subscription:** $X/month for unlimited checks (high-volume agents)
- **Issuer certification:** Third-party issuers pay to be in the Ligis registry
- **Enterprise:** Custom integrations for agent platforms beyond CROO

## What we need to validate

1. **Will agents actually get credentialed?** The aggregation model
   assumes agents want credentials. We need to test whether agents (or
   their operators) will go through a verification flow to get a Ligis
   credential, and whether that credential meaningfully improves their
   ability to transact on CROO.

2. **Will CROO embrace Ligis as a partner?** Deeper integration
   (auto-calling Ligis before transactions, displaying risk scores in
   agent profiles) would drive adoption. Without it, Ligis is just a
   "Try this" button.

3. **Is the risk scoring model correct?** The capability weights, TTL
   thresholds, and maturity window are hardcoded. They need to be
   validated against real agent commerce data — do `fail` verdicts
   actually correlate with bad outcomes?

4. **Can we integrate external verifiers at reasonable cost?** Self
   Protocol at $0.01/check is cheap. World ID is free for verified
   agents. But KYC providers like Didit charge $0.25+. The economics
   need to work: Ligis charges $X for issuance, pays $Y to the verifier,
   keeps the spread.
