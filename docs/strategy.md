# Ligis — Product Strategy & Roadmap

> The trust layer for agent-to-agent commerce. Ligis aggregates external
> verification signals into portable on-chain credentials, then sells
> counterparty risk checks on the CROO Agent Store and OKX.AI Agent Store.
> Built on 0G Compute and 0G Storage.

## Status (2026-09-25)

- **Live:** 5 paid services on the CROO Agent Store (`ligis.risk` $0.75,
  `ligis.verify` $0.50, `ligis.issue` $2.00, `ligis.gate` $1.00,
  `ligis.qualify` $2.50), provider under PM2, idempotent delivery with retry.
- **On-chain:** `AgentId` + `CredentialRegistry` + `GatedVault` on Casper
  Testnet; `PharosAgentID` + `CredentialRegistry` on Pharos Atlantic;
  GenLayer `JobEscrow` on Studio Next (61997).
- **Mint policy:** `ligis.issue` and `ligis.qualify` both refuse to mint a
  capability from payment alone — external evidence that passes policy, or an
  explicit `LIGIS_SELF_ISSUABLE_CAPABILITIES` allowlist (empty by default).
- **Intent layer:** Jev routes through the Vercel AI Gateway, **free only
  through 2026-09-25**. `pnpm smoke:jev` proves the route answers (and fails
  loudly when it stops) — run it after that date, then either attach
  gateway billing or flip `LIGIS_JEV_TRANSPORT=direct` with `TYPESAFE_API_KEY`.
- **Tests:** 41 Foundry + 22 Odra + 133 TypeScript (25 suites).
- **Next:** Phase 3 (OKX.AI ASP) is the open one. The 0G Bridge by AKINDO
  program was **never submitted and is dropped** (2026-09-25); deploying the
  contracts on 0G Chain stays a future option via `@ligis/adapter-0g`, not a
  deadline-driven milestone. Replacement 0G channel identified: **0G Apollo
  Accelerator Cohort 2** (applications opening soon, program Nov–Feb) —
  see "0G: Apollo Cohort 2" for the deploy-prep checklist.

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

Each of these is a signal. None of them is integrated with agent
marketplaces. No individual verifier has incentive to integrate with a
single marketplace — the market is too small for them. But Ligis
aggregating all of them into one marketplace-consumable credential
creates value none of them could create alone.

```
External verifiers          Ligis (aggregator)          Agent marketplaces
──────────────────          ────────────────           ──────────────────
Self Protocol ─────┐
World ID ──────────┤
EAS attestations ──┼──→  Issue unified          ──→  Agent has credential
Wallet history ────┤    on-chain credential         on CROO / OKX.AI.
KYA scoring ───────┘    (Casper or Pharos)          Risk check returns
                        readable by anyone          pass/warn/fail
```

An agent with a World ID verification → Ligis issues `kyc.basic`.
An agent with clean wallet history → Ligis issues `reputation.tenure`.
An agent with Self Protocol biometric → Ligis issues `identity.human-backed`.

The credentials already exist. Ligis normalizes them into one schema,
puts them on-chain, and makes them consumable through CROO, OKX.AI,
and any other agent marketplace.

## Competitive landscape

### Direct competitors

| Project                   | Model                                                                  | Gap vs Ligis                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Nerq**                  | Proprietary API, trust score from provenance/behavior/audit. Sub-50ms. | Black box — no on-chain credentials, no portability, no issuer model. Agent can't verify how the score was computed. |
| **ATEP**                  | Portable reputation passport from execution logs. 4 trust tiers.       | Reputation-based (past behavior), not credential-based (capabilities). No issuer model. No marketplace integration.  |
| **EtereCitizen**          | DID + on-chain reputation with temporal decay on Base.                 | Reputation-based, not credential-based. No issuer/verifier marketplace. No CROO integration.                         |
| **knowyouragent.network** | Wallet tenure, ownership trail, soulbound identity. 100K agents.       | Proprietary scoring, no credential issuance, no marketplace integration.                                             |

### Credential infrastructure (complementary, not competitive)

| Project                   | What they do                                                                          | How Ligis uses them                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **EAS**                   | Free, open attestation standard on Base/Ethereum. Anyone can register schemas.        | Ligis could use EAS as an additional on-chain layer. EAS is plumbing; Ligis is the intelligence on top.         |
| **Self Protocol**         | ZK-based identity verification — age, nationality, proof-of-human. $0.01-$0.25/check. | Ligis consumes Self verifications as an input signal for credential issuance.                                   |
| **World ID / AgentKit**   | Biometric uniqueness, human-backed agent registration on World Chain.                 | Ligis maps World ID verification to `kyc.basic` or `identity.human-backed` credentials.                         |
| **KYH (Know Your Human)** | Aggregates Self, Didit, Human Passport → EAS attestation on Celo. 90-day credential.  | Closest analog to Ligis's model, but for human KYC on Celo. Ligis does the same for agent capabilities on CROO. |

### Standards (complementary)

| Standard                   | What it defines                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------- |
| **TSAI (AWS)**             | Open protocol, W3C VC-based, tiered trust (T0-T3), Trust Authorities issue credentials |
| **AIS-1**                  | Bonded identity pair (agent + sponsor), 3 tiers, on-chain verifyBond()                 |
| **A2A Trust (IETF draft)** | PKI-based agent identity, spawn chains, CA-signed templates                            |
| **KYA Standard**           | W3C VC + JSON-LD manifest for agent governance/safety                                  |

Ligis is compatible with these standards (uses W3C VC-style credentials,
DIDs, secp256k1 signatures) but doesn't depend on any single one. The
aggregation model means Ligis can map any external standard into its
credential schema.

### Adjudication (complementary — GenLayer)

**GenLayer** is trustless adjudication for the agentic economy: Intelligent
Contracts and AI-validator consensus resolve disputes that need judgment,
not just deterministic code. Happy-path rails (x402, agent identity,
marketplaces) do not ship dispute resolution; GenLayer fills that gap.

| Layer        | Owner              | Question                                       |
| ------------ | ------------------ | ---------------------------------------------- |
| Eligibility  | **Ligis**          | _Who is allowed to trade?_ (`isCapable`, risk) |
| Adjudication | **GenLayer**       | _What happened when delivery is contested?_    |
| Payment      | x402 / CROO / etc. | _How does money move?_                         |

**Product rule:** compose, do not merge. Ligis does not reimplement the
registry on GenLayer; GenLayer does not mint core KYC/capability
credentials in the happy path. GenLayer JobEscrow (and similar) should
**call or record a Ligis gate** before opening funded work, then use
subjective judgment only for delivery outcomes. Dispute outcomes are a
future aggregation signal into Ligis risk — same pattern as EAS / Self /
World ID.

Full Agent Tank plan (parallel workstreams, portal requirements, non-goals):
[`docs/genlayer-agent-tank.md`](genlayer-agent-tank.md).

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

- Every agent on CROO or OKX.AI can hire Ligis (risk check)
- Every agent on CROO or OKX.AI can get credentialed by Ligis (issuance)
- The marketplace is the distribution — no separate user acquisition needed
- As more agents hold Ligis credentials, the risk check becomes more
  valuable, driving more credential issuance (network effect)
- Cross-marketplace portability means a credential issued via CROO is
  instantly verifiable on OKX.AI, and vice versa

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

$0.50 for verify, $0.75 for risk check, $1.00 for the gate. For a $5 task,
that's 15% overhead. For a $0.50 task, it's 150%.

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
- [x] `ligis.gate` — Jev payment-intent verdict + on-chain credential check in one deliverable
- [x] `ligis.risk` returns `pathToTrust` on `fail`, so a missing credential converts
      into the next order instead of a dead end (missing capabilities, both routes,
      listing UUIDs, prices, and target chain — all derived, none hardcoded)
- [x] `ligis.qualify` collapses the funnel into one order (check → policy-gated
      issue → re-check), with evidence required unless the operator allowlists a
      capability as self-issuable

### Phase 2: Aggregation issuance (in progress)

- [x] `ligis.issue` supports external evidence import, not only self-issuance
- [x] Ship the chain-neutral external attestation boundary
- [x] Add a read-only EAS adapter foundation
- [x] Wire EAS-backed issuance into `ligis.issue`
- [ ] Configure production EAS schema + attester allowlists
- [ ] Integrate Self Protocol as the first human/controller verifier
- [x] Both mint paths (`ligis.issue`, `ligis.qualify`) enforce evidence-or-allowlist,
      so the policy can't be bypassed by hiring the cheaper service
- [x] Agent can request externally backed credential issuance through CROO
- [x] Ligis verifies the source proof and records provenance (no raw PII)
- [x] Ligis issues unified on-chain credential on Casper/Pharos after policy passes
- [ ] Agent now has a credential that any CROO risk check can verify
- [ ] Demo: agent gets credentialed → another agent runs risk check → gets `pass`

### Phase 3: Cross-platform portability (OKX.AI Genesis)

- [ ] Launch Ligis as an Agent Service Provider (ASP) on OKX.AI Genesis
- [ ] Offer `okx.ligis.risk`, `okx.ligis.verify`, and `okx.ligis.issue`
      services, mirroring the CROO CAP integration
- [ ] Prove cross-marketplace utility: credentials issued via CROO are
      verifiable by OKX.AI agents, and vice versa
- [ ] Other agent marketplaces read Ligis credentials (they're on-chain, anyone can read)
- [ ] Ligis becomes the standard trust layer, not a CROO plugin
- [ ] CROO is the first distribution channel; OKX.AI is the second
- [ ] SDK for third-party platforms to verify Ligis credentials
- [ ] (Deferred, no deadline) Deploy `CredentialRegistry` and `AgentId` to
      0G Chain via `@ligis/adapter-0g` — now re-anchored as the Apollo
      Cohort 2 application prep, see "0G: Apollo Cohort 2" below

### Phase 4: Adjudication compose (GenLayer Agent Tank → ongoing)

- [x] GenLayer `JobEscrow` Intelligent Contract on Studio Next (gate → escrow → dispute → settle) —
      live at `0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F`, 5 SUCCESS txs
- [x] Ligis pre-flight `GateReceipt` stored in job state (Casper/Pharos `isCapable` remains source of truth)
- [x] Demo + observer UI shipped — [60s video](https://youtu.be/goACAqXjUxY), `ligis.vercel.app/genlayer`
- [ ] Portal submission for Agent Tank — see [`docs/genlayer-agent-tank.md`](genlayer-agent-tank.md)
- [ ] Post-hackathon: map dispute terminal states into Ligis risk / `reputation.dispute_*` signals
- [ ] Do **not** migrate CredentialRegistry to GenLayer; GenLayer stays a consumer + signal source

### Phase 5: Credential marketplace

- [ ] Third-party issuers issue Ligis-compatible credentials directly
- [ ] Ligis becomes the schema/verification standard, not just an aggregator
- [ ] Revenue shifts from per-check fees to issuer certification / schema registration
- [ ] Decentralized issuer registry on-chain

## Business model

### Current: per-check pricing on CROO

| Service         | Price | Margin                                                                                         |
| --------------- | ----- | ---------------------------------------------------------------------------------------------- | --- | ------------ | ----- | --------------------------------------------------------------------- |
| `ligis.risk`    | $0.75 | High — on-chain read + computation, no external API cost                                       |
| `ligis.verify`  | $0.50 | High — single on-chain read                                                                    |
| `ligis.issue`   | $2.00 | Cost depends on external verifier fees ($0.01-$0.25) + gas                                     |     | `ligis.gate` | $1.00 | High — bundled intent read (Jev) + credential read in one deliverable |
| `ligis.qualify` | $2.50 | Medium — includes an issuance write (gas), priced below risk + issue bought separately ($2.75) |

Prices live in one place in code — `SERVICE_PRICE_USD` in
`packages/croo-adapter/src/services.ts` — which builds the provider
listings, the CROO store manifest, and any hint that quotes a price. Changing
a price in code without changing the live CROO Dashboard listing throws away
trust: the hint is a promise, the Dashboard is the charge.

### Future: subscription + bundling

- **CROO-bundled:** CROO pays Ligis, includes verification in transaction fees
- **OKX.AI-bundled:** OKX.AI pays Ligis, includes verification in agent fees
- **Subscription:** $X/month for unlimited checks (high-volume agents)
- **Issuer certification:** Third-party issuers pay to be in the Ligis registry
- **Enterprise:** Custom integrations for agent platforms beyond CROO and OKX.AI

## 0G Bridge by AKINDO (dropped)

The [0G Bridge by AKINDO](https://build.0g.ai) 10-week program was evaluated
as the highest-leverage accelerator for Ligis but **never submitted**
(closed 2026-09-25). Ligis still runs on 0G Compute (reasoning) and 0G
Storage (evidence); the 0G Chain contract deployment lives in Phase 3 as a
deadline-free option via `@ligis/adapter-0g`. If a future 0G program or
ecosystem partnership materializes, the wave plan can be revived from git
history.

### 0G: Apollo Cohort 2 (the re-dock, researched 2026-09-25)

One week after dropping the Bridge, the same ecosystem upside reappeared in a
better-fitting vehicle: the **0G Apollo Accelerator** (xBuilders + Stanford
veterans) opens **Cohort 2 applications soon** — a 4-month program
(November → February), up to 10 startups building on the 0G protocol, up to
$2M investment per project headline, Demo Day on Stanford campus.

Why Ligis fits, from the program's own evidence:

- Cohort 1 alumni are described as "live on 0G Storage, Compute, **and
  Chain**" — Chain is the third pillar Ligis doesn't have yet, and the only
  gap in an otherwise perfect fit (we already run Compute + Storage in
  production).
- Cohort 1 included Walnut AI, "a professional network for agents" — the
  same buyer persona Ligis sells verification to.
- Cohort 1 outcomes validate the effort: 220+ applications for 10 spots,
  10/10 teams at Demo Day, $1.5M raised by alumni within 30 days.
- Timing is clean: Metropolis closes 13 Oct; Apollo runs Nov–Feb, so prep
  slots between the two.

Secondary 0G channels, same research:

- **TOKEN2049 Singapore, 7–8 Oct 2026** — 0G had a major presence at
  Token2049 Dubai and side events are open during TOKEN2049 Week; this is the
  in-person substitute for the Bridge's promised BD/investor exposure.
  Decide by early October whether a presence is worth it.
- **ETHGlobal prize tracks** — 0G sponsored $15k at Lisbon (Jul 2026) with
  repo-level integration review + mandatory live demo: judging rewards real
  integration depth, which is our strength. Enter the next stop once 0G
  Chain integration exists.
- **Zero Cup** (Arena tournament, $17k) concluded Jul 2026 — watch for a
  second edition. The site footer also lists an **Ecosystem Growth Fund** —
  worth one DevRel email to qualify the standing-grants path.

**The application story we want to be able to tell:** "Ligis is live on 0G
Compute + Storage today; here is the 0G Chain deploy proving the third
pillar." That makes the adapter-0g checkpoint the critical path:

- [ ] Point `@ligis/adapter-0g` at the 0G Chain testnet RPC + chain config
- [ ] Deploy `PharosAgentID` + `CredentialRegistry` to 0G Chain testnet
      (standard EIP-712 / ERC-721 — verify no opcode/gas-metering surprises)
- [ ] Run the full Foundry suite against a 0G testnet fork
- [ ] Confirm viem reads/writes/event logs work against 0G Chain RPC
- [ ] Wire 0G Chain into the web chain selector as a read target
- [ ] One credential issued on 0G Chain verified from Casper (the portability
      demo, now with a third chain)
- [ ] Submit Apollo Cohort 2 application when it opens + prepare a
      TOKEN2049 Week presence decision

- Sources: [apollo.0g.ai](https://apollo.0g.ai/),
  [Apollo 2026 recap](https://0g.ai/blog/apollo-graduation-2026),
  [ETHGlobal Lisbon recap](https://0g.ai/blog/ethglobal-lisbon-2026-recap),
  [Zero Cup](https://0g.ai/arena/zero-cup),
  [TOKEN2049 Singapore](https://www.token2049.com/singapore)

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
