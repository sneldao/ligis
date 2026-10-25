# Ligis — Zcash shielded credential presentation

> **Status: researched 2026-10-25. Not built. Not claimed anywhere.**
> Nothing in Ligis reads or writes Zcash today. This doc records the additive
> primitive, the cost, and the objections, so that a later decision is made
> with the analysis in hand rather than from memory.
>
> What we _say_ today stays in [`docs/positioning.md`](positioning.md) — the
> four-signal table there is unchanged until this ships. Where this fits in
> the strategy is in [`docs/strategy.md`](strategy.md).

---

## The gap in the current evidence stack

`isCapable(subject, capability)` answers: _is there an on-chain credential
saying this subject holds capability X?_

- Sources today: Casper `CredentialRegistry`, Pharos `CredentialRegistry`,
  Monad `CredentialRegistry`, ERC-8004 `ReputationRegistryUpgradeable` (Draft),
  MonID (opt-in), Self Protocol, EAS — see [`docs/payee-evidence.md`](payee-evidence.md)
  and [`docs/attestation-integrations.md`](attestation-integrations.md).
- What every one of them has in common: **presence, not history.** They answer
  "this subject is registered and holds a credential", and the registry is
  **public and correlatable** — anyone can read the issuance history and link
  it to the address.

That is the weak spot. The cost of minting a capability credential is low, so
the signal degrades toward _"someone holds a key"_ unless the credential's
weight comes from evidence that was expensive to obtain. `docs/strategy.md`
§ _Differentiation_ already frames aggregation as the moat — but aggregation
has a ceiling: **if every upstream source is presence-based, aggregating them
produces a stronger presence claim, not a history claim.**

**Nobody in the agent-payment field answers the history question.** Visa
Intelligent Commerce, Google AP2, Mastercard Agent Pay and x402 all assume a
_trusted_ merchant or payee. The gate is the only place where _"does this
payee have a proven record — and can I check it without learning who they are?"_
can be asked — and the gate is a policy layer, which is where Ligis already
sits. `docs/paybox-ch1.md` §0 already states the wedge: _"a third-party-issued,
on-chain-verifiable attestation about the counterparty."_

## The proposed signal: shielded presentation

What a gate would check, in one line: _a ZK proof that this subject holds a
valid Ligis credential for capability X, verified against the public
CredentialRegistry root, nullifier-bound to this context, with no link between
the proof and the subject's address._

The architecture is deliberately **additive**: nothing existing is ported,
replaced, or rewritten.

| Layer                    | What exists now                                | What Zcash adds                                                                                                         |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Public identity          | ERC-721 Agent IDs on Pharos/Casper/Monad       | **unchanged**                                                                                                           |
| Public credentials       | EIP-712 attestations on-chain, readable by all | **unchanged**                                                                                                           |
| Gate decision            | `isCapable()` public read on EVM               | **unchanged** (still the source of truth)                                                                               |
| **Private presentation** | _Not built_ (roadmap only)                     | **Zcash shielded note + ZK proof** — prove credential possession without revealing issuer, subject, or which credential |

Ligis's chain-neutral core (`@ligis/core`) already defines `ChainAdapter`,
`Reasoner`, `EvidenceStore`, capability hashing (`keccak256("agent.commerce.escrow")`),
and the DID format (`did:ligis:<chain>:<id>`). The Zcash layer is a new
adapter + proving circuit behind that same boundary — the EVM public registry
stays exactly as it is.

## How it composes with Ligis today

Current trust boundary ([`docs/attestation-integrations.md`](attestation-integrations.md)):

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

Proposed addition: the Zcash shielded proof is an **upstream evidence source in
the same position as Self and EAS** — normalized into the same shape, then
subject to the same issuer and policy gate. It does not get a bypass path, and
**payment alone never mints trust** — that rule is unchanged.

The flow:

1. Issuer (EVM) signs an EIP-712 credential for `(subject, capability, expiresAt, nonce)`.
2. Holder constructs a Zcash shielded note committing to the credential (issuer, subject, capability, expiry, a per-credential secret).
3. Holder presents a ZK proof at the gate: "I know an opening of a note in the Zcash shielded pool whose credential is valid for capability X and whose expiry has not passed."
4. Gate verifies the proof against the public registry root (or a pre-verified receipt) and answers GO/STOP — learning only "eligible", never "who".

## What is reusable vs. what is new work

**Reusable (chain-neutral, already built):**

- `@ligis/core`: `ChainAdapter`, `Reasoner`, `EvidenceStore` interfaces, capability hashing, DID format
- Issuer key infrastructure: EIP-712 signing, nonce management, revocation
- Trust Steward gate logic: `boot → reason → gate → act → record`
- x402 gate (`POST /api/gate` GO/STOP): already accepts credentials, can accept ZK proofs too
- Jev intent evaluation layer: fail-open GO/STOP reflex, chain-agnostic

**New work (Zcash-native):**

- Zcash shielded note format for credential commitments (Sapling/Orchard note encryption)
- ZK circuit proving "holder of valid Ligis credential for capability X" (Groth16/Halo2, using librustzcash primitives)
- Zcash RPC / light-client integration (zebra or lightwalletd; zodl-inc's `slipstream` sync engine is relevant)
- Bridge logic: EVM issues credential → Zcash shielded commitment → ZK proof presented at gate → EVM gate verifies proof (or off-chain verifier relays result)

This is bounded work, not a full port. You are not rewriting Ligis on Zcash; you are adding one shielded presentation primitive.

## Who would pay for it

| Use case                        | Who pays                                   | What the gate does with it                                                                             |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Agent-to-agent payment          | agent operators, wallets, x402/MPP rails   | fastest-scaling instance: a new agent has no public history; a proven private record is its only trust |
| Uncollateralized credit         | lenders, credit desks, marketplaces        | lowers deposit / rate because the borrower proves the record without revealing it                      |
| Escrow / stake sizing           | escrow markets, prediction markets, gaming | scales stake with track record instead of against it                                                   |
| Remittance / OTC counterparties | remittance operators, OTC desks            | proves reliability without handing over the transaction graph                                          |
| Marketplace trust               | marketplaces, gig platforms                | ratings carry their own stake; honest rating becomes worth something to the rater                      |

**The credit case scales fastest in dollars** — collateral that does not need to
be posted is capital that can be lent, and a gate that can quote a
risk-adjusted stake is doing something no amount of "trust blindly" can do.

## Where it fits Zecathon

Zecathon's thesis: _"Thirty days to build something on Zcash that does not leak."_
$100,000 prize pool, 5 tracks, 30 days to build ([thezecathon.com](https://thezecathon.com)).

Ligis's public credential system leaks linkage (issuer → subject → capability is all
readable). The Zcash add-on fixes exactly that: an agent can prove capability
**without doxxing** — the gate learns "eligible" but never "who". That is "does
not leak" in the literal sense.

Track fit: **SHIELDED PAYMENTS** ($15,000 — _"Point of sale, payroll,
remittance, subscriptions. Money that moves without publishing who paid whom"_)

- **GRAND PRIZE** ($20,000). Ligis is a pre-payment decision service: it checks
  every shielded subscription, payroll, or remittance payment against the job and
  a private credential presentation before ZEC moves, without publishing who paid
  whom on-chain. (Secondary narrative touchpoint: **CROSS-CHAIN**, since EVM
  capability roots gate shielded ZEC intents without unshielding or linking the
  EVM address to the Zcash payee.)

## Timing

Zecathon is a 30-day window. Today is Oct 25, 2026. Midnight Buildathon Wave 3
starts Oct 27 (Latep owns Midnight; Ligis has no Midnight commitment), so Ligis
is free to run a Zecathon entry without conflicting with Wave 3.

## What it would cost — the real integration risk

- **Verifier cost.** A gate that verifies a ZK proof on-chain pays that cost per
  decision. Ligis's current cold start is ~2–3 s, dominated by the credential
  read, and the whole product claim is a single fast API call. **This is the
  risk, not the cryptography.**
- **Latency budget.** The measured decision path is 75–160 ms for the Jev
  intent read. A proof verification on the order of a second is a different
  product shape. This has to be measured in the decision path, not in a
  benchmark, before it is promised anywhere.
- **Cross-chain.** Reading the EVM public registry from a Zcash context means
  either a cross-chain RPC read inside the gate's decision path, or a
  pre-verifying service returning a signed receipt. The latter preserves the
  latency; the chain set would grow either way, and the existing union-semantics
  read model (`web/lib/resolve.ts`) is where it would extend.
- **Issuer trust.** A private credential proof is only as good as the issuer's
  honesty about its interactions. That is a policy question, not a cryptographic
  one — the same class of problem as the existing issuer model — and it needs
  an answer before it is an evidence source.

## What we would need before shipping any of it

- [ ] A **measured** verification cost and latency on the target chains, inside
      the gate's decision path.
- [ ] A decision on **who verifies**: the gate, or a pre-verifying service that
      returns a signed receipt.
- [ ] A policy for **issuer trust**: what makes an issuer's credential
      acceptable evidence, and what happens when two issuers disagree.
- [ ] A **fail-open / fail-closed** decision, stated the way the Jev layer
      states its own: `SKIPPED` with a reason, never a silent GO.
- [ ] The positioning change made in `docs/positioning.md` **first**, with the
      claims-and-sources discipline that doc requires.
- [ ] A Zcash proving key / circuit build pipeline (Groth16 or Halo2) — this is
      the largest single implementation item.

## What we are not doing

- Not claiming this is built. It is not, and `docs/positioning.md` is
  unchanged.
- Not adding a fifth signal to the four-signal table until it ships and is
  measured.
- Not porting Ligis's public registry to Zcash. Zcash has no EVM; the public
  registry stays on EVM chains exactly as it is.
- Not making the gate depend on it. If the proof path is slow, unreachable, or
  unsupported for a subject's chain, the verdict falls back to the existing
  four signals — labelled.

---

## The 30-day Zecathon build (Oct 25 → Nov 24)

This is the path to a submission. It is additive: nothing on Pharos/Casper/Monad
is touched. The Zcash layer is a new `ChainAdapter` + proving circuit behind
`@ligis/core`.

### Week 1 — Shielded read, no ZK yet (fallback path)

- Add `ZcashChainAdapter` to `@ligis/core` behind the existing `ChainAdapter`
  boundary. It reads Zcash shielded pool state via a Zebra/zcashd light client
  or via payee-disclosed viewing keys.
- Demo target: Ligis gate reads a shielded ZEC payment — amount and payee hidden
  from the public ledger, visible only through selective disclosure — and
  returns `GO` / `STOP` / `UNKNOWN`.
- If nothing else lands by Day 7, this is the demoable core: shielded ZEC
  gated by Ligis before money moves.

### Week 2 — ZK credential presentation circuit

- Circuit statement: _this subject holds a valid Ligis credential for
  capability X, verified against the public `CredentialRegistry` root,
  nullifier-bound to this context, with no link between the proof and the
  subject's address._
- **Public inputs:** `capability_hash` (bytes32), `registry_root` (bytes32),
  `nullifier` (bytes32)
- **Private inputs:** `credential_leaf`, `merkle_path`, subject's Zcash
  viewing/spending key material
- **Output:** `eligible` (boolean)
- **Not revealed:** issuer DID, subject Zcash address, which credential,
  subject balance
- Proving system: Groth16 (Sapling) or Halo2 (Orchard) — whichever compiles
  first using Zcash's proving stack (`librustzcash` / Zebra tooling)
- Target: a compiling circuit by Day 14

### Week 3 — End-to-end shielded payment gate

- Sender enters a Zcash shielded address + amount in the Ligis gate UI
- Payee presents a shielded credential proof (or Week 1 view-key fallback)
- Ligis gate returns `GO` / `STOP` / `UNKNOWN`
- On `GO`, sender releases shielded ZEC on Zcash testnet; explorer shows a
  shielded transaction with amount hidden
- Replay attempt with the same nullifier → `STOP`
- Record a 90-second demo video

**Shipped (Week 3, ZK side):** the circuit now binds the payee (`payee_hash`
in the leaf and public inputs), the registry root is published from
`CredentialIssued`/`CredentialRevoked` events + signed subject →
identity-commitment registrations (`build-root`, served at
`GET /api/zk/root`, trusted via `LIGIS_ZK_ROOT_MANIFEST`), and
`pnpm demo:zcash-zk` runs root → proof → GO → replay STOP end to end. The
testnet shielded transfer and the video are still open.

### Week 4 — Submission packet

- README with "how to run the gate"
- Demo video (2 min max), Zcash testnet tx hash showing shielded transfer
  after Ligis `GO`
- Honest risks doc (this doc, with measured latency/cost if available)
- Submit to Zecathon before the Nov 24 close

---

## Demo specification (what the judge sees in 90 seconds)

1. Sender opens the Ligis gate UI, enters a Zcash shielded address and amount
2. Payee (a different wallet) presents a ZK proof: _"I hold a valid Ligis
   credential for `agent.commerce.escrow`"_ — no address, no issuer, no
   which-credential revealed
3. Ligis returns `GO` (or `STOP` if the proof is invalid or the nullifier was
   already used)
4. Sender releases shielded ZEC on Zcash testnet; the explorer shows a shielded
   transaction with the amount hidden
5. Replay attempt with the same nullifier → `STOP`

---

## Circuit spec (for implementation)

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Public inputs     | `capability_hash`, `registry_root`, `nullifier`             |
| Private inputs    | `credential_leaf`, `merkle_path`, viewing key               |
| Output            | `eligible` (boolean)                                        |
| Proving system    | Groth16 (Sapling) or Halo2 (Orchard)                        |
| Not revealed      | issuer DID, subject address, credential ID, subject balance |
| Replay protection | nullifier per (capability, context)                         |

---

## Why this wins Zecathon

Judges reward three things: **(a) real Zcash usage**, **(b) privacy that
matters**, **(c) demoable in minutes.** This is all three:

- Shielded ZEC moves only after a private credential proof — "does not leak"
  in the literal sense
- The existing EVM public registries are untouched; Zcash is a new channel,
  not a port
- The demo is a 90-second payment flow: gate → proof → shielded transfer

The ZK proof is the load-bearing layer. If it slips, Week 1's view-key
selective disclosure is still a shielded-ZEC gate and still satisfies "does
not leak." Ship Week 1 by Day 7; upgrade to ZK by Day 14 if it compiles.

---

_Added 2026-10-25. Research note — nothing shipped._

_Added 2026-10-25. Research note — nothing shipped._
