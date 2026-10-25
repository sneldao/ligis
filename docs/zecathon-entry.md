# Ligis — Zecathon entry: shielded ZEC, gated in private

> **Status: entry plan, researched 2026-10-25. Not built.** This doc is the
> tactical path to a Zecathon submission. It does not change
> [`docs/positioning.md`](positioning.md) — the four signals stay the four.
> Zcash shielded credential presentation is an additive channel behind the
> existing `ChainAdapter` boundary, researched in
> [`docs/zcash-shielded-credentials.md`](zcash-shielded-credentials.md).

---

## The wedge, in one sentence

**Shielded ZEC should not move until a private credential proof says it can.**
Ligis gates Zcash shielded payments so the amount, the payee, and the
credential itself never leak — before, during, or after the transfer.

## What Zecathon is (and isn't)

Zecathon: _"Thirty days to build something on Zcash that does not leak."_
$100,000 prize pool across five tracks ($15k each) + $20k Grand Prize + $5k
community bounties, 30 days to build.

| Track                                       | Prize        | Fit for Ligis                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SHIELDED PAYMENTS** _(Primary target)_    | $15,000      | **Direct wedge fit.** _"Point of sale, payroll, remittance, subscriptions. Money that moves without publishing who paid whom."_ Ligis is a pre-payment decision service (`POST /api/gate`): it gates shielded agent subscriptions, payroll, and remittance before ZEC moves — verifying payee eligibility without publishing who paid whom. |
| **GRAND PRIZE** _(Awarded on top of track)_ | $20,000      | Bridges an existing multi-chain spend firewall into Zcash so public capability roots can gate private shielded transfers.                                                                                                                                                                                                                   |
| **CROSS-CHAIN** _(Secondary narrative)_     | $15,000      | _"Swaps, bridges and intents that reach other chains without unshielding on the way through."_ Our proof bridges EVM capability roots to shielded ZEC intents without linking the EVM subject to the Zcash address.                                                                                                                         |
| **CORE & TOOLING**                          | $15,000      | Not targeted (competes against pure Zebra/librustzcash infra).                                                                                                                                                                                                                                                                              |
| **PRIVATE MARKETS / WILDCARD**              | $15,000 each | Off-mission for a spend firewall.                                                                                                                                                                                                                                                                                                           |

It is **not** a general smart-contract platform. Zcash has Sapling/Orchard
shielded pools, viewing keys, and nullifiers — but no EVM, no on-chain
verifier, no contract you can deploy. Ligis works with that grain: the gate
logic stays off-chain (as it already is), and Zcash provides the shielding
layer that makes the gate meaningful.

## What we build (the 30-day scope)

| Week  | Deliverable                                                                                                                              | Zcash tech                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **1** | `ZcashChainAdapter` — Ligis reads shielded ZEC payment state via viewing key / light client; returns GO/STOP/UNKNOWN                     | Zebra/zcashd RPC, viewing-key selective disclosure |
| **2** | ZK credential presentation circuit: prove valid Ligis credential for capability X without revealing issuer, subject, or which credential | Groth16 (Sapling) or Halo2 (Orchard)               |
| **3** | End-to-end demo: sender → payee presents shielded proof → Ligis GO → shielded ZEC released on Zcash testnet                              | Zcash testnet, shielded transfer                   |
| **4** | Submission packet: README, 2-min demo video, testnet tx hash, honest risks                                                               | —                                                  |

**Additive, not a port:** Pharos/Casper/Monad public registries are untouched.
Zcash is a new `ChainAdapter` behind `@ligis/core`. Nothing existing is
rewritten.

## How it fits the app holistically (no bolt-on dashboard)

1. **One verb, one surface (`/gate` + `POST /api/gate`):** Zcash is not a
   separate mini-app. Passing a Zcash shielded address (`u1…`, `zs1…`,
   `utest1…`, `ztestsapling1…`) into `/gate` or `POST /api/gate` routes through
   `detectSubjectKind()` → `ZcashChainAdapter`.
2. **The four signals never change (`docs/positioning.md`):** Every shielded ZEC
   decision returns the same canonical stack (`right-payee`, `right-amount`,
   `in-scope`, `verified-payee`). Zcash plugs into `verified-payee` via
   viewing-key selective disclosure (Week 1) or a nullifier-bound ZK proof
   against the published `CredentialRegistry` root, bound to the payee's Zcash address (Weeks 2–3).
3. **Public issuance, private presentation:** Issuers remain publicly
   accountable on EVM/Casper registries; spend and presentation on Zcash stay
   shielded so neither the buyer, the payee, nor the payment graph leaks.
4. **Unified `PaymentIntent` & `SubjectSpecimen`:** `PaymentIntent` accepts
   shielded presentation envelopes (viewing-key disclosure / ZK proof +
   nullifier), and `SubjectSpecimen` derives a deterministic risograph portrait
   for Zcash addresses and nullifiers inside the existing `web/DESIGN.md`
   system.

## What does not leak

| Data                             | How it stays hidden                                         |
| -------------------------------- | ----------------------------------------------------------- |
| ZEC amount                       | Zcash shielded pool (Sapling/Orchard)                       |
| Payee address                    | Shielded; only revealed via payee-disclosed viewing key     |
| Which credential the payee holds | ZK proof reveals a qualifying leaf, not which one           |
| Issuer identity                  | Not in the proof; public input is only the registry root    |
| Subject balance                  | Never queried, never revealed                               |
| That Ligis was consulted         | Off-chain gate; no on-chain footprint from the check itself |

## Demo specification (90 seconds)

1. Sender opens the Ligis gate UI, enters a Zcash shielded address and amount
2. Payee (a different wallet) presents a ZK proof: _"I hold a valid Ligis
   credential for `agent.commerce.escrow`"_ — no address, no issuer, no
   which-credential revealed
3. Ligis returns `GO` (or `STOP` if the proof is invalid or the nullifier was
   already used)
4. Sender releases shielded ZEC on Zcash testnet; explorer shows a shielded
   transaction with amount hidden
5. Replay attempt with the same nullifier → `STOP`

## Circuit spec (implementation target)

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Public inputs     | `capability_hash`, `registry_root`, `nullifier`             |
| Private inputs    | `credential_leaf`, `merkle_path`, viewing key               |
| Output            | `eligible` (boolean)                                        |
| Proving system    | Groth16 (Sapling) or Halo2 (Orchard)                        |
| Not revealed      | issuer DID, subject address, credential ID, subject balance |
| Replay protection | nullifier per (capability, context)                         |

### Gate wiring (shipped)

`POST /api/gate` accepts `zkProof` (`{ proof, contextLabel, publicInputs }`).
One-command demo (offline, keyless): `pnpm demo:zcash-zk` — publishes a
registry root manifest, proves twice, and drives the real `/api/gate` wiring
through GO → replay STOP → redirect-to-other-payee STOP → verifier-missing
UNKNOWN → revoke + republish STOP (`scripts/zcash-zk-demo.lastrun.txt`).

UI demo: `pnpm --filter @ligis/circuits-zcash build-root -- --demo --out web/.zk-root.json`,
run the web app with `LIGIS_ZK_ROOT_MANIFEST=.zk-root.json` (check
`GET /api/zk/root`), generate a fresh proof with
`pnpm --filter @ligis/circuits-zcash prove:sample -- --nonce <n> --json out.json`,
open `/gate` for the demo payee (`utest1qpzry9x8gf2…8qp9x2m`, printed in the
proof's `contextLabel`) and paste it into "Attach zk credential proof". First submit: `verified · GO`; the
same proof again: `rejected · STOP` (replay). Where `bb` is not installed
(e.g. Vercel) the panel reads `unverified · UNKNOWN` and the proof does not
count. Proving system shipped: Noir + UltraHonk (not Groth16/Halo2).

## Fallback path (Day 14 checkpoint)

If the ZK circuit is not compiling by Day 14, Week 1's viewing-key selective
disclosure is the submission: Ligis reads a shielded ZEC payment via the
payee's disclosed viewing key, verifies amount/payee, and returns GO/STOP.
It still satisfies "does not leak" — shielded amounts, selective payee
verification, no public linkage. The ZK proof is the bonus layer, not the
gating item.

**Ship Week 1 by Day 7. Upgrade to ZK by Day 14 if it compiles.**

## Why this wins Zecathon

Judges reward three things: **(a) real Zcash usage**, **(b) privacy that
matters**, **(c) demoable in minutes.** This is all three:

- Shielded ZEC moves only after a private credential proof — "does not leak"
  in the literal sense
- The existing EVM public registries are untouched; Zcash is a new channel,
  not a port
- The demo is a 90-second payment flow: gate → proof → shielded transfer

## Timing (no conflict)

Zecathon: Oct 25 → ~Nov 24 (30 days). Midnight Buildathon Wave 3 starts Oct 27,
but Latep owns Midnight and Ligis has no Midnight commitment, so Ligis is free
to run this entry without conflict.

## Submission checklist

- [x] `ZcashChainAdapter` in `@ligis/core` behind `ChainAdapter` boundary (`packages/core/src/zcash.ts`)
- [x] Shielded ZEC payment readable via viewing key / light client (`z_listreceivedbyaddress` 512-byte memo codec + nullifier replay store)
- [x] Gate returns `GO` / `STOP` / `UNKNOWN` for shielded ZEC intents (`web/lib/chain-zcash.ts`, `web/lib/resolve.ts`, `/gate` presets)
- [x] ZK circuit compiling — `packages/circuits-zcash` (Noir + UltraHonk; Poseidon Merkle membership + nullifier; sample proof verifies locally). registry root is computed off-chain, anchoring is open
- [x] ZK proof verified in `/api/gate` — optional `zkProof` on `POST`, `bb verify` against the committed vk, trusted roots from `LIGIS_ZK_TRUSTED_ROOTS`, (context, nullifier) replay → `STOP`, missing toolchain → explicit `unverified`/`UNKNOWN`; result shown as `Decision.zkCredential` and on `/gate` ("Attach zk credential proof"). See `docs/decide-api.md` § ZK credential proofs
- [x] Payee bound into the circuit — leaf = `H(identity_commitment, payee_hash, capability_hash, issuer, expires_at, nonce)`, `payee_hash` public; gate `STOP`s a proof for another payee (`bb` rejects a rewritten `payee_hash`)
- [x] Published registry root the gate can trust — `build-root` (CredentialRegistry events via read-only `eth_getLogs`, or fixture) → manifest; gate trusts `LIGIS_ZK_ROOT_MANIFEST` (root re-derived, staleness → `UNKNOWN`) or pinned roots; `GET /api/zk/root`; subject → identity-commitment mapping by EIP-191-signed registration
- [x] Offline end-to-end ZK gate demo — `pnpm demo:zcash-zk`
- [ ] On-chain root anchor (root registry contract or issuer-signed root) — today the operator publishes the manifest
- [ ] End-to-end demo: gate → proof → shielded ZEC on Zcash testnet
- [ ] Demo video (2 min max)
- [ ] Zcash testnet tx hash showing shielded transfer after Ligis `GO`
- [ ] README: "how to run the gate"
- [ ] Honest risks documented (latency, verifier cost, issuer trust, fail-open)
- [ ] Submit before Zecathon closes (~Nov 24)

## Cross-references

- [`docs/zcash-shielded-credentials.md`](zcash-shielded-credentials.md) — full
  additive primitive, cost, risks, and "what we are not doing"
- [`docs/zk-reputation-evidence.md`](zk-reputation-evidence.md) — private
  reputation gap; Zcash listed as a substrate alternative to Stellar/Latep
- [`docs/payee-evidence.md`](payee-evidence.md) — public vs. private reputation;
  Zcash as complementary additive path
- [`docs/positioning.md`](positioning.md) — unchanged; four signals stay the
  four; Zcash noted as a Zecathon entry path, not a positioning change
- [`docs/proofs.md`](proofs.md) — Zecathon added to active submissions table

---

_Added 2026-10-25. Entry plan — Week 1 implementation in progress._
