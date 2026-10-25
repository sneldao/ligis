# Ligis — ZK reputation evidence

> **Status: researched 2026-10-21. Not built. Not in the four signals. Not
> claimed anywhere.** Nothing in the product reads a ZK reputation proof
> today. This doc records the gap, the proposal, the cost, and the
> objections, so that a later decision is made with the analysis in hand
> rather than from memory.
>
> What we _say_ today stays in [`docs/positioning.md`](positioning.md) — the
> four-signal table there is unchanged until this ships. Where this fits in
> the strategy is in [`docs/strategy.md`](strategy.md).

---

## The gap in the current evidence stack

`verified payee` answers: _is there an on-chain credential saying this payee
is trustworthy?_

- Sources today: Casper `CredentialRegistry`, Pharos `CredentialRegistry`,
  ERC-8004 `ReputationRegistryUpgradeable` (Draft), MonID (opt-in), Self
  Protocol, EAS — see [`docs/payee-evidence.md`](payee-evidence.md) and
  [`docs/attestation-integrations.md`](attestation-integrations.md).
- What every one of them has in common: **presence, not history.** They answer
  "this subject is registered and holds a credential", and the registry is
  **public and correlatable** — anyone can read the issuance history and link
  it to the address.

That is the weak spot, and it is getting weaker. The cost of minting a
capability credential is low, so the signal degrades toward _"someone holds a
key"_ unless the credential's weight comes from evidence that was expensive to
obtain. `docs/strategy.md` § _Differentiation_ already frames aggregation as
the moat — but aggregation has a ceiling: **if every upstream source is
presence-based, aggregating them produces a stronger presence claim, not a
history claim.**

**Nobody in the agent-payment field answers the history question.** Visa
Intelligent Commerce, Google AP2, Mastercard Agent Pay and x402 all assume a
_trusted_ merchant or payee. The gate is the only place where _"does this
payee have a proven record"_ can be asked — and the gate is a policy layer,
which is where Ligis already sits. `docs/paybox-ch1.md` §0 already states the
wedge: _"a third-party-issued, on-chain-verifiable attestation about the
counterparty."_ This is the same claim expressed as a proof instead of a
registry entry.

## Two modes of reputation

|                | **Public reputation** (today)                                 | **Private reputation** (proposed)                                                          |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Question       | Is this subject registered and credentialed?                  | Does this subject have a proven record — and can I check it without learning who they are? |
| Where it lives | A public registry, keyed to an address                        | A root in a public chain plus a ZK proof, keyed to a secret the subject holds              |
| Linkability    | Full — issuance history is public and correlatable            | None to the earner; the proof reveals a qualifying leaf, not which one                     |
| Replay         | n/a                                                           | Nullifier per context                                                                      |
| Cost to fake   | Low — mint a credential                                       | High — a record has to be earned, one interaction at a time                                |
| Composability  | High — anyone can read it, rank it, build a leaderboard on it | Low — you can verify it, but not aggregate, rank or discover from it                       |
| Good for       | Discovery, audit, public accountability                       | Accept/deny decisions, privacy-preserving qualification, anti-Sybil                        |

**The privacy cuts both ways, and that is the honest objection.** A private
reputation is opaque: the gate cannot rank payers, cannot build a public track
record, and cannot let another gate learn what it learned. So the useful shape
is **both** — public for discovery and audit, private for the actual
accept/deny. A gate that reads only private reputation becomes a black box; a
gate that reads only public reputation can be farmed.

## The proposed signal: proven history

What a gate would check, in one line: _a ZK proof that this subject holds a
secret whose recorded outcomes across N interactions show ≥ T% success,
verified against a reputation root, nullifier-bound to this context, with no
link between the proof and the subject's address._

The issuer model is what separates this from the registry model. **The issuer
is the party that observed the interaction** — a marketplace, a landlord, a
counterparty service, a payment rail. The holder proves they hold a qualifying
record in an issuer's tree. The gate verifies the proof and the root without
learning which issuer, which interaction, or who the holder is.

That is a _third-party-issued_ attestation about the counterparty, expressed as
a proof rather than a registry entry — and it is the one signal nobody in this
field has.

## Who would pay for it

Ranked by who has money on the table for it, and by what each one is worth to
a gate. This is the commercial shape of the same argument the primitive's
reference implementation makes in `docs/VISION.md` — the use cases are not
decorative, they are what turns a proof into a fee.

| Use case                            | Who pays                                   | What the gate does with it                                                                                                        |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Uncollateralized credit**         | lenders, credit desks, marketplaces        | lowers the deposit or the rate it would otherwise demand, because the borrower can prove the record without revealing it          |
| **Escrow / stake sizing**           | escrow markets, prediction markets, gaming | scales the stake _with_ the track record instead of against it                                                                    |
| **Agent-to-agent payment**          | agent operators, wallets, x402/MPP rails   | the fastest-scaling instance: a new agent has no public history at all, so a proven private record is the only trust it can bring |
| **Remittance / OTC counterparties** | remittance operators, OTC desks            | proves reliability without handing over the transaction graph — privacy and compliance at once                                    |
| **Marketplace trust**               | marketplaces, gig platforms                | rates carry their own stake, so rating honestly becomes worth something to the rater                                              |

**The credit case is the one that scales fastest in dollars** — collateral that
does not need to be posted is capital that can be lent, and a gate that can
quote a risk-adjusted stake is doing something no amount of "trust blindly"
can do.

## Where it sits in the trust boundary

Current boundary ([`docs/attestation-integrations.md`](attestation-integrations.md)):

```text
Self proof / EAS attestation
          │ protocol-specific verification
          ▼
  normalized ExternalAttestation
          │ Ligis issuer + policy decision
          ▼
  Ligis capability credential
          │ portable on-chain read
          ▼
  isCapable(subject, capabilityHash)
```

Proposed addition: the ZK proof is an **upstream evidence source in the same
position as Self and EAS** — normalized into the same shape, then subject to
the same issuer and policy gate. It does not get a bypass path, and
**payment alone never mints trust** — that rule is unchanged.

## The reference implementation, and why it lives elsewhere

The working prototype of this primitive is in a separate project: **`latep`**,
a Stellar game whose third ZK pattern is exactly this primitive, redesigned on
2026-10-21 to be **issuer-agnostic** (the issuer becomes a public input and the
tree is per-issuer, so a second issuer mints a leaf without patching the game
contract). Its own analysis — market structure, the "canonical or bust"
question, the three load-bearing scale assumptions — is in its `docs/VISION.md`.

Why the primitive belongs here rather than there:

- A game creates reputation **only among its own players**, and its reputation
  is public and linkable. A closed vertical is the known failure mode in this
  market (_"closed attestation systems are dead ends due to data fragmentation"_).
- A gate is where trust is **decided**, so a gate is where the signal is worth
  the most.
- So: **latep is the first issuer; a gate is the first consumer.** One
  primitive, two consumers — and the primitive has to be a module for that to
  work.

## What it would cost — the real integration risk

- **Verifier cost.** The reference verifier is a community-maintained Rust
  library (`rs-soroban-ultrahonk`) for a 14,592-byte proof, with audits in
  flight upstream. A gate that verifies on-chain pays that cost **per
  decision**. Ligis's current cold start is ~2–3 s, dominated by the
  credential read, and the whole product claim is a single fast API call.
  **This is the risk, not the cryptography.**
- **Latency budget.** The measured decision path is 75–160 ms for the Jev
  intent read. A proof verification on the order of a second is a different
  product shape. This has to be measured in the decision path, not in a
  benchmark, before it is promised anywhere.
- **Cross-chain.** The reference implementation is on Stellar. Reading it means
  either a Stellar RPC read inside the gate's decision path, or a
  pre-verifying service returning a signed receipt. The latter preserves the
  latency; the chain set would grow either way, and the existing union-semantics
  read model (`web/lib/resolve.ts`) is where it would extend.
- **Issuer trust.** A private reputation is only as good as the issuer's honesty
  about its interactions. That is a policy question, not a cryptographic one —
  the same class of problem as the existing issuer model — and it needs an
  answer before it is an evidence source.

## What we would need before shipping any of it

- [ ] A **measured** verification cost and latency on the target chains, inside
      the gate's decision path.
- [ ] A decision on **who verifies**: the gate, or a pre-verifying service that
      returns a signed receipt.
- [ ] A policy for **issuer trust**: what makes an issuer's tree acceptable
      evidence, and what happens when two issuers disagree.
- [ ] A **fail-open / fail-closed** decision, stated the way the Jev layer
      states its own: `SKIPPED` with a reason, never a silent GO.
- [ ] The positioning change made in `docs/positioning.md` **first**, with the
      claims-and-sources discipline that doc requires.

## Potential substrates

The private reputation signal needs a chain where a subject can prove
credential possession without revealing their address. Two substrates are
researched as **alternatives, not a sequence**:

- **Zcash shielded pools** (Sapling/Orchard) — the most direct substrate for
  private presentation. A subject can prove credential possession through a ZK
  proof without revealing their address, issuer, or which credential. Zcash
  also has built-in viewing keys (selective disclosure) and nullifiers (replay
  protection), which the EVM registries do not. See
  [`docs/zcash-shielded-credentials.md`](zcash-shielded-credentials.md) for the
  additive Ligis primitive.
- **Stellar / Soroban** — Latep's chain, where the same private-reputation
  primitive (pattern 3) is spec'd but unbuilt. Latep owns that substrate; Ligis
  does not pursue it.

Zcash is the better fit for Ligis's Zecathon entry because the gate logic lives
off-chain and Zcash's shielding is native, not a third-party pool. Both docs
are researched, not built; nothing here depends on either.

## What we are not doing

- Not claiming this is built. It is not, and `docs/positioning.md` is
  unchanged.
- Not adding a fifth signal to the four-signal table until it ships and is
  measured.
- Not competing to be the canonical reputation credential. The market analysis
  in `docs/strategy.md` says that position is lost, and conforming is the play.
- Not making the gate depend on it. If the proof path is slow, unreachable, or
  unsupported for a subject's chain, the verdict falls back to the existing
  four signals — labelled.

---

_Added 2026-10-21. Research note — nothing shipped._
