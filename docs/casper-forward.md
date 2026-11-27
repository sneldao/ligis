# Ligis on Casper — from credential registry to trust substrate

> **Status: plan, 2026-11-16. Nothing below is built unless marked so.**
> What is deployed today lives in `docs/archive/casper-final-round.md`.
> This doc is the holistic case for the five-axis deepening of the Casper
> deployment ahead of Mainnet, written to serve two readers at once: our own
> roadmap, and the Casper Forward conversation (how the ecosystem consumes
> Ligis, not just what Ligis does).
>
> Positioning note: `docs/positioning.md` is unchanged — on the product side,
> Ligis is evidence-based payment control and credentials are one signal
> inside `verified payee`, never the headline. What follows deepens that
> signal's on-chain substrate. On Casper specifically, the substrate itself is
> the community deliverable — the distinction matters and is addressed below.

## The honest starting point

What is live on Casper Testnet today:

- `AgentId` — mint a portable identity (`mint_self`, `mint`, `set_token_uri`).
- `CredentialRegistry` — issue/revoke an EIP-712 credential per
  `(subject, capability_hash)`, read `is_capable`, on-chain secp256k1 issuer
  recovery via `k256`.
- `GatedVault` — one demo vault that gates CSPR withdrawal on `is_capable`.

Functionally this is a registry plus a boolean. A judge, an auditor, or a
cohort team evaluating "how do I build on this" finds three entry points and
a demo. `docs/zcash-shielded-credentials.md` names the deeper problem: every
evidence source in the stack — Ligis's registry included — answers
**presence, not history**, and a credential that is cheap to mint degrades
toward _"someone holds a key."_ The narrowing isn't just feature-thin; the
_claim itself_ is thin.

The five axes below each fix a distinct weakness. Taken together they turn
Ligis-on-Casper from a credential registry into the trust substrate the rest
of the Casper agent economy builds on — which is the answer to the question
the Casper team actually asked: _how does the community leverage this?_

## The unified frame: five questions a counterparty asks

Any agent (or contract) deciding whether to transact with a stranger asks,
in order:

| #   | Question                                       | Axis                                                           | Current answer                                                                                                          |
| --- | ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | What do they claim?                            | **Claims** — parameterized capabilities + issuer accreditation | A bare `capability_hash`; "kyc.basic" with no parameters, and no way to tell a self-issued claim from an accredited one |
| 2   | What have they done?                           | **History** — outcome receipts and derived reputation          | Nothing. Presence only; the registry forgets everything except the latest row                                           |
| 3   | What holds them to it?                         | **Enforcement** — on-chain policy and dispute                  | One demo vault; the gate itself is off-chain advice                                                                     |
| 4   | How do I find them?                            | **Discovery** — capability → agents index + an indexer         | You must already know the subject address. No reverse index, no economy                                                 |
| 5   | Can they prove it without exposing themselves? | **Private presentation** — ZK proof-of-credential              | Built (`packages/circuits-zcash`, gate-verified) but framed as Zcash-only                                               |

Five features, one object: each axis makes the next one meaningful. Claims
without enforcement are marketing. Enforcement without history is a rule
book with no memory. History without discovery is a private ledger. And none
of it serves real counterparties — businesses, regulated entities — if using
it requires doxxing the subject.

## Axis 1 — Claims: from credential rows to attestable statements

**What exists:** a credential is
`(subject, capability_hash, issuer, issued_at, expires_at, revoked)`.
`capabilityHash` is `keccak256(UTF-8)` of a dotted string — chain-neutral,
which is what makes the Casper↔EVM portability demo work.

**What changes:**

- **Parameterized capabilities.** The capability string becomes a
  namespaced claim with typed parameters:
  `agent.spend:<=1000CSPR`, `rwa.accredited:jurisdiction=US`,
  `data.premium:tier=2`. The hash commits to the full claim, so contracts
  can branch on the claim's _content_ — a vault that requires
  `rwa.accredited` in a specific jurisdiction, a policy that reads a spend
  ceiling out of the credential rather than a separate config.
- **Issuer accreditation.** Today any secp256k1 key can sign anything and
  the contract can't distinguish our demo key from a KYC provider. Add an
  accreditation layer: which issuers may attest which capability
  namespaces, set by a governance/root role. `is_capable` gains a sibling
  read — `credential_standing(subject, capability)` — that returns the
  claim _plus_ its issuer's accreditation status. "Self-issued" stops being
  a docs caveat and becomes an on-chain fact a consumer can price.
- **Standard-shaped.** Parameterized claims are what makes the planned
  chain-neutral capability standard worth co-authoring — a format has to
  say more than a string to be worth standardizing. Per the strategy doc's
  composability-over-canonicality stance: ship the schema open, express it
  in W3C VC / EAS-compatible terms, don't try to own the container.

**Community leverage:** every cohort project that needs "is this agent
allowed to X" gets a real claims language instead of a boolean — and an
issuer ecosystem (CROO is already live as one) that isn't Ligis-operated.

**Scope:** contract change (`CredentialRegistry` v2 on Casper; the EVM
registries follow the same schema via `@ligis/core` hash semantics). This is
the largest audit delta and the credibility fix — sequence it first.

## Axis 2 — History: outcome receipts → derived reputation

**What exists:** `AgentId.set_token_uri` already anchors evidence roots;
the risk model already _weights_ maturity and issuer diversity (strategy.md
§3) but has almost no on-chain history to weight them against. The outcome
recorder exists off-chain (`docs/evidence-outcomes.md`, opt-in). GenLayer
`JobEscrow` is live and its dispute terminal states are already earmarked
as a future reputation signal (Phase 4).

**What changes:**

- **Receipt feed per agent.** A minimal append-only structure: every
  materialized outcome — a `GO`/`STOP` gate decision that executed, a
  settled x402 payment, a dispute resolution — anchors a content hash under
  the agent's `AgentId`. Heavy data stays off-chain (0G Storage manifests);
  the chain holds roots. This is cheap: one `anchor` entry point, no
  per-receipt storage bloat.
- **Derived reads, not stored scores.** Reputation is computed from the
  receipt feed by readers (the indexer, the gate, third parties) — settled
  volume, dispute rate, credential age, issuer diversity — not stored as a
  number Ligis asserts. This preserves the "inspectable, not black-box"
  property the risk model already advertises, and keeps the contract dumb.
- **Cross-chain receipt union.** `web/lib/resolve.ts` already unions reads
  across chains; receipts extend that, so an agent's Casper history and
  EVM history compose instead of competing.

**Community leverage:** this is the axis that makes Ligis _infrastructure_
rather than an app. Casper Trust Layer built "reputation from settled
payments" as a whole product; if the registry emits that signal as a
free read, every cohort project — escrows, oracles, treasuries, payment
rails — consumes it without building it. Presence answers "may it";
history answers "is it any good."

**Scope:** one new entry point on `AgentId` (or a small `Receipts`
contract — decide by audit surface), plus indexer work (Axis 4). The
scoring stays off-chain, so most of this axis is not contract risk.

## Axis 3 — Enforcement: from advice to on-chain policy

**What exists:** `GatedVault` proves the pattern (cross-contract
`is_capable` gate on withdrawal) but is a single-purpose demo. The
`/api/gate` decision is advisory. GenLayer `JobEscrow` adjudicates disputes
on Studio Next and already stores Ligis `GateReceipt`s.

**What changes:**

- **`PolicyGuard`** — the flagship new primitive. A contract cohort
  projects call before releasing funds:
  `check_and_record(agent, capability, amount, counterparty) → allow/deny`.
  Policies are set per-integrator: spend ceilings (read from Axis-1
  parameterized claims), velocity limits, counterparty allowlists,
  required capabilities. The call _records_ the check — which is also the
  receipt feed's highest-value write path, wiring Axis 3 into Axis 2 for
  free.
- **`GatedVault` reframed** as one instance of the pattern (capability =
  `rwa.accredited`), not the pattern itself.
- **The dispute loop closes.** Escrow dispute → GenLayer intelligent
  resolution → terminal state anchored as a receipt → feeds reputation.
  `compose, do not merge` (strategy.md): GenLayer adjudicates, Ligis
  records and gates. Nobody else in the cohort has a closed
  act → dispute → resolve → reputation loop.
- **Atomic credential-aware settlement** — the x402 path currently checks
  credential and payment in separate steps; a facilitator-side hook that
  verifies the credential in the same transaction as the CEP-18 settlement
  is the end state. Depends on facilitator cooperation — flag as an
  ecosystem ask, not unilateral scope.

**Community leverage:** this is what "integrate Ligis" concretely means for
AgentEscrow402, Trust Layer, Chainleash, ARIA — their contracts call
`PolicyGuard`, they don't reimplement eligibility. The integration surface
is one function call and an SDK wrapper.

**Scope:** the one genuinely new contract. Everything else in this axis is
wiring existing pieces.

## Axis 4 — Discovery: from lookup table to economy

**What exists:** reads are subject-keyed — you must already know the agent's
address. `web/lib/chain-casper.ts` reconstructs credential history by
scanning blocks because Casper has no EVM-style event logs.

**What changes:**

- **The Ligis indexer.** Productize what we're already forced to do: a
  block-scanning indexer over `AgentId`, `CredentialRegistry`, `PolicyGuard`
  and the receipt feed, exposing credential history, standing, and
  reputation reads as an API. This is simultaneously our infra need and a
  public good — it sits squarely in Forward's "Infrastructure & Tooling"
  support bucket, and it's the thing every cohort project needs anyway.
- **Reverse index: capability → agents.** Query "agents holding
  `data.premium` with issuer standing and history" — discovery turns the
  registry into a market. Without it, "agent economy" is a slogan; with it,
  an agent can _find_ a counterparty, not just vet one.
- **The SDK.** "Add credential gating to your x402 endpoint in three
  lines" — a thin client over the indexer + `PolicyGuard` call builder.
  Adoption is the metric that matters to Forward; the SDK is what makes
  adoption cheap.

**Community leverage:** the indexer and reverse index are public reads the
whole ecosystem benefits from, Ligis-branded or not — composable in the
strategy doc's sense: nobody's permission required to build on them.

**Scope:** zero new contract risk (the reverse index can live in the
indexer, not on-chain). This axis is engineering, not audit.

## Axis 5 — Private presentation: credentials without exposure

**What exists — and this axis is further along than the story admits:**
`packages/circuits-zcash` is _built_. The Noir circuit proves "I hold a
valid, unexpired credential for capability X, leaf of registry root R, this
is my one-time nullifier" without revealing subject, issuer, or leaf.
`nargo test` passes; `/api/gate` verifies proofs server-side via the
committed verification key. The docs describe it as a Zecathon path; the
primitive itself is registry-agnostic.

**What changes:**

- **Reframe, don't rebuild.** The same circuit architecture applies to the
  Casper registry root: prove `rwa.accredited` standing to a gate or vault
  without linking the subject's account hash to the presentation. For RWA
  and KYC capabilities — exactly the capabilities the Casper cohort cares
  about — _usable-without-correlatable_ is the difference between a
  credential institutions can accept and one they can't.
- **Gate-side verification for mainnet.** On-chain UltraHonk verification
  on Casper is not realistic near-term; the proof is verified at the gate /
  indexer layer, which is where the consumer sits anyway. The on-chain
  footprint is the registry root — already published.
- **Nullifier discipline.** One-time nullifiers per (capability, context)
  prevent a proof being replayed across counterparties — the property that
  makes private presentation safe rather than just private.

**Community leverage:** "credentials on Casper that institutions can
actually use" — the privacy-preserving read path is a property no other
cohort project has and none can easily replicate.

**Scope:** no new contract (the root already exists). Work is the Casper
root builder + gate/indexer verification path + honest docs reframe.

## Why the whole is more than the parts

The axes are not a feature list; they're a loop:

```
   richer CLAIMS ──► ENFORCEMENT has something to enforce
        ▲                    │
        │                    ▼
   ISSUERS compete    RECEIPTS accumulate
   to attest          (every policy check, every settle, every dispute)
        ▲                    │
        │                    ▼
   credentials gain    REPUTATION becomes computable
   market value               │
        ▲                     ▼
        └──── DISCOVERY makes standing + history findable
              (and PRIVACY widens who can participate at all)
```

Each turn of the loop raises the cost of a fake credential and the value of
a real one — which is the direct answer to "presence, not history" and to
the cold-start problem in strategy.md.

## What this means for Mainnet scope

| Axis           | New contract surface                                                 | Audit weight            |
| -------------- | -------------------------------------------------------------------- | ----------------------- |
| 1. Claims      | `CredentialRegistry` v2 (parameterized claims, issuer accreditation) | High — core change      |
| 2. History     | Receipt anchor entry point (small)                                   | Low–medium              |
| 3. Enforcement | `PolicyGuard` (new)                                                  | High — new primitive    |
| 4. Discovery   | None — indexer + SDK                                                 | None                    |
| 5. Privacy     | None — root already published                                        | None (verify off-chain) |

The rule holds from the last analysis: **deepen the contract only where
the credibility argument lives** (axes 1 and 3); everything else is
engineering on top of roots the chain already stores. Two real contract
changes, not five — that keeps the audit story honest for Safe Edges and
the mainnet-readiness review.

Known pre-mainnet items this plan absorbs rather than adds to:
role-gated/admin-bound mint (folds into issuer accreditation),
`GatedVault` deposit/withdraw automation via `proxy_caller.wasm` (folds
into the PolicyGuard work — same payable-entry-point machinery), block-scan
reads (replaced by the indexer).

## Forward-program mapping

| Forward pillar               | What we bring                                                                     | What we ask for                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Technical & Architecture     | Odra 2.8.1 contracts, cross-chain EIP-712/k256 recovery — done and testnet-proven | Review of the Registry-v2 + PolicyGuard design before we freeze interfaces                    |
| Security & Mainnet Readiness | 22 Odra tests, hardened revoke/nonces (see `casper-final-round.md`)               | Safe Edges audit path for the two contract deltas                                             |
| Infrastructure & Tooling     | We need an indexer regardless; we'll build it as a public good                    | RPC/indexing support; ideally co-funded or co-branded                                         |
| Ecosystem Connections        | A substrate the whole cohort can call                                             | Intros to 2–3 cohort teams for `PolicyGuard` integration pilots (x402 projects, escrows, RWA) |
| GTM & Launch                 | "The trust substrate for Casper's agent economy" — verifiable, not rhetorical     | Co-marketing around first cohort integrations and the capability standard                     |

## Risks, stated plainly

- **Scope creep before mainnet.** The defense is the scope rule above:
  two contract deltas, everything else is indexer/SDK/wiring. If the
  timeline tightens, axis 4's SDK and axis 5's reframe can ship
  post-mainnet without weakening the core.
- **Standard-fragmentation.** Parameterized claims could drift into a
  Ligis-only schema. The strategy doc's answer stands: express claims in
  VC/EAS-compatible terms, optimize composability not canonicality.
- **Accreditation is governance.** "Who accredits issuers" is a policy
  decision wearing a contract's clothes. Start minimal — a root role,
  transparent and documented — rather than designing a DAO before there's
  an economy to govern.
- **Reputation can be gamed.** Receipts are evidence, not truth — an agent
  can farm settled-volume with itself. The derived-score layer must carry
  issuer diversity and counterparty diversity as first-class inputs, and
  the docs must keep saying _evidence_, not _score_.
- **Forward's "funding" is undefined.** The program's published support is
  technical/security/GTM/infra; cash, if any, is milestone-negotiated.
  Plan for the support; treat funding as upside.

## Implementation status (post-acceptance sprint)

- **M1 Registry v2 — implemented.** `CredentialRegistry` v2 on Casper:
  canonical parameterized claims, on-chain EIP-712 digest recompute,
  per-namespace issuer accreditation evaluated at read time. 40 Odra
  tests pass; WASM built. Testnet deploy blocked on deployer funding.
  Spec: `docs/credential-registry-v2.md`.
- **M2 history — implemented.** `OutcomeFeed` contract: append-only
  outcome receipts keyed by (subject, claim_hash) with on-chain
  aggregates (settled/disputed/rejected counts). Adapter ops:
  `recordOutcome`. WASM built.
- **M3 policy — implemented.** `PolicyGuard` contract: per-subject
  spending policy (rolling window budget + required claim hash),
  cross-contract `is_capable` check, atomic `check_and_record`.
  Adapter ops: `setPolicyGuardPolicy`, `checkAndRecordSpend`. WASM built.
- **M4 discovery — implemented (v0).** `packages/adapter-casper/src/
discovery.ts` block-scan indexer: claims→holders/issuers, namespace
  policies, accreditations, outcome series, plus `--events-out` emitting
  `RegistryEvent[]` compatible with `circuits-zcash` `build-root`.
- **M5 privacy — wired.** `discovery.ts --events-out` feeds the existing
  Poseidon root builder unchanged; `claimHash` is chain-neutral so
  Casper claims slot into the same leaf format.
- **EVM parity — pending decision.** Claim grammar + accreditation
  semantics are chain-neutral in `@ligis/core`; `CredentialRegistry.sol`
  port not yet done — audit-relevant, should land before Forward review.

### Testnet resourcing (added post-sprint)

Dev iteration runs on Odra's in-process test-vm (`cargo test` — deploy,
issue, and cross-contract calls with no node and no CSPR). Testnet CSPR
is treated strictly as a demo budget: each contract deploys once per
WASM change, deploys are batched, `standardPayment=false` keeps failures
cheap, and admin ops cover behavior changes without redeploys. No
`nctl` localnet (host is resource-constrained). The durable fix is a
one-time testnet allocation requested through Forward's builder-support
pillar; the deployer purse
(`0203f6ff3abc4bae07063698e86dcdf5a5a776c4fa62a9e545a43e7dab82af2c0552`)
is currently unfunded, which blocks the v2 deploy.

## Milestones to propose to Casper Forward

1. **M1 — Registry v2 spec freeze** (parameterized claims + issuer
   accreditation), reviewed with Casper's technical team. Deliverable:
   interface doc + Odra implementation on testnet.
2. **M2 — `PolicyGuard` + first external integration.** One cohort project
   calling `check_and_record` on testnet. Deliverable: integration + the
   SDK that made it three lines.
3. **M3 — Indexer live** (public credential-history + reputation reads).
   Deliverable: public API + the capability→agents reverse index.
4. **M4 — Receipts + dispute loop.** GenLayer resolution → anchored receipt
   → reputation read, end to end.
5. **M5 — Private presentation on Casper.** Proof-of-credential against the
   Casper root verified at the gate.
6. **M6 — Mainnet.** Audit (Safe Edges), deploy `AgentId` +
   `CredentialRegistry` v2 + `PolicyGuard`, cohort integrations carried over.

The order is deliberate: the claim format (M1) is what everything else
commits to, so it freezes first; mainnet is last because nothing else is
worth auditing until it exists.

## Where this doc defers

- Product positioning and claims discipline → `docs/positioning.md`
- Market structure, composability strategy, competitive map → `docs/strategy.md`
- The privacy primitive's research and cost analysis →
  `docs/zcash-shielded-credentials.md`, `docs/zk-reputation-evidence.md`
- Contract design and module layout → `docs/architecture.md`
- What's actually deployed today → `docs/archive/casper-final-round.md`
- GenLayer adjudication plan → `docs/genlayer-agent-tank.md`
