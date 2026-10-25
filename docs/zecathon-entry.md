# Ligis — Zecathon entry: shielded ZEC, gated in private

> **Status: Weeks 1–3 shipped (`packages/circuits-zcash`, `/api/gate`, `/zcash`).**
> This doc is the tactical path and architecture for our Zecathon submission.
> It does not change [`docs/positioning.md`](positioning.md) — the four signals
> stay the four. Zcash shielded credential presentation is an additive channel
> behind the existing `ChainAdapter` boundary, researched in
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

**Guided UI demo (the judge path):** `pnpm demo:zcash-web`, then open
`/zcash` (also linked from the landing hero, `/gate`, and ⌘K). Four one-click
steps against the real API: no proof → `STOP` (a shielded payee has no public
credential) → the payee generates a live UltraHonk proof
(`POST /api/zk/demo-proof`) → `GO` → the same proof replayed → `STOP` → a
revoked credential (valid proof against the pre-revocation root) → `STOP`.
Each result is explained in plain language with the hashes behind
"Technical details". `LIGIS_ZK_ROOT_MANIFEST=demo` makes the gate trust the
public demo registry and enables the demo prover; without it (e.g. Vercel,
no `bb`), `/zcash` still runs step 1 and states what the live steps return.

Manual path: `/gate` → "Payee has a private credential proof? Attach it" →
upload the `.json` from `prove:sample -- --json out.json`.
Proving system shipped: Noir + UltraHonk (not Groth16/Halo2).

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

## Timing & Hackathon Eligibility (Option B Provenance)

- **Registration opens:** Sep 28, 2026
- **Submissions open:** Sep 28, 2026
- **Submissions due:** **Oct 28, 2026 · 23:59 UTC**
- **Judging window:** Oct 29 – Nov 22, 2026
- **Winners announced:** Nov 23, 2026

### Built During the Build Window (Sep 28 – Oct 28, 2026)

In accordance with Zecathon rules (_"All code written during the build window. Libraries are fine; existing products are not"_), our submission uses Ligis's existing multi-chain core and EVM registries strictly as upstream libraries/oracles, with **all Zcash-native and zero-knowledge presentation code authored from scratch during the hackathon**:

1. **`packages/circuits-zcash/` (100% net-new):**
   - Noir circuit (`circuit/src/main.nr`): payee-bound credential proof, depth-16 Poseidon Merkle membership, and single-use context nullifier.
   - Proof pipeline: UltraHonk proving via Barretenberg (`bb`), committed verification key (`src/vk.ts`), and server-side verification (`src/verify.ts`).
   - Root builder (`src/registry.ts`): Poseidon tree generation from credential events, EIP-191 subject-to-identity-commitment registrations, and manifest signing.
   - On-chain anchor: steward-signed root manifest anchored on Monad Testnet at block `74058241` ([`0x91f64222...`](https://testnet.monadscan.com/tx/0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f)).
2. **`packages/core/src/zcash.ts` (100% net-new):**
   - ZIP-316 Bech32m and F4Jumble decoder for Unified Addresses (`utest1...`) and Unified Incoming Viewing Keys (`uivktest1...`).
   - 512-byte `LIGIS:v1:` memo encoder/decoder for encrypted Zcash note memos.
   - Zero-dependency HTTP/2 gRPC lightclient connecting to `https://testnet.zec.rocks:443` (`CompactTxStreamer`).
   - In-band Orchard and Ironwood note trial decryption (`Pallas` point scalar multiplication + `BLAKE2b` KDF + `ChaCha20-Poly1305` AEAD).
   - In-memory and KV nullifier replay store (`isSpent`, `markSpent`).
3. **Web User Experience & Guided Demo (100% net-new):**
   - Guided 4-step privacy tour (`web/app/zcash/page.tsx` + `web/components/ZcashDemo.tsx`).
   - Gate API ZK proof evaluation (`web/lib/zk-verifier.ts`, `POST /api/gate` with `zkProof`, `GET /api/zk/root`).
   - Zcash shielded address routing and asset denomination in `PaymentIntent`.
4. **Live Zcash Testnet Proofs:**
   - Real testnet shielded transaction broadcast carrying the 512-byte `LIGIS:v1:` attestation memo: [`d2b389c8fd108561f3cdc45cfcb373e7474dbb8804368fcd560135f9cb443f90`](https://fauzec.com/api/v1/status/testnet/01M5SKS8EGMJ3MK633ED1ZJ02P), confirmed at block height `4,540,356`.
   - On-chain action nullifier: `0x6743c460f674cdb17cb8abd425fc9063b68dd75a709d8e3a8c46350980540a00`.

## Honest risks & operational trade-offs

1. **Prover & verifier runtime (`nargo` + `bb`):**
   - Holder-side UltraHonk proof generation takes ~650–800 ms (`14,656` bytes), and native `bb verify` takes ~18–45 ms.
   - Standard serverless hosts (e.g. Vercel Functions) do not ship the native Barretenberg `bb` binary. When `bb` is absent, `/api/gate` refuses to guess: it returns `verification: "unverified"` and `status: "UNKNOWN"` (never a silent `GO`), while `/zcash` interactively walks through a verified UltraHonk recording and labels it explicitly.
2. **Root freshness vs. revocation lag (`LIGIS_ZK_ROOT_MAX_AGE_S`):**
   - Revoking a credential on `CredentialRegistry` drops its leaf from the next published Poseidon Merkle tree. Between root rebuilds, a recently revoked credential could still prove against an older root if that root remained trusted.
   - Mitigation: the gate enforces `LIGIS_ZK_ROOT_MAX_AGE_S` (default 24h; configurable down to minutes) and rejects proofs against superseded roots (`STOP`), while stale manifests fail closed (`UNKNOWN`).
3. **Nullifier store durability:**
   - Replay protection across concurrent serverless instances requires atomic `SET NX` in Upstash/Vercel KV (`KV_REST_API_URL` + `KV_REST_API_TOKEN`). Without KV configured, the gate falls back to an in-memory `Set` (sufficient for single-process local demos, not multi-instance production).
   - If the KV store is unreachable, the gate returns `UNKNOWN` and does not burn the nullifier.
4. **Anonymity set size:**
   - A Merkle membership proof hides which leaf the holder owns among the `leafCount` valid, registered leaves in the tree for that capability. If only one subject holds a rare capability at a given moment, the anonymity set for that capability is `1` until more subjects register.
5. **Issuer trust & fail-open Jev boundary:**
   - The ZK proof proves an accountable issuer vouched for the payee in `CredentialRegistry`; it does not replace issuer vetting.
   - The Jev intent reader (`in-scope`) is fail-open (`SKIPPED` when disabled), whereas `verified-payee` + ZK verification is **fail-closed** (`UNKNOWN` or `STOP` when unverified).

## Submission checklist

- [x] `ZcashChainAdapter` in `@ligis/core` behind `ChainAdapter` boundary (`packages/core/src/zcash.ts`)
- [x] Shielded ZEC payment readable via viewing key / light client (`z_listreceivedbyaddress` 512-byte memo codec + nullifier replay store)
- [x] Gate returns `GO` / `STOP` / `UNKNOWN` for shielded ZEC intents (`web/lib/chain-zcash.ts`, `web/lib/resolve.ts`, `/gate` presets)
- [x] ZK circuit compiling — `packages/circuits-zcash` (Noir + UltraHonk; Poseidon Merkle membership + nullifier; sample proof verifies locally)
- [x] ZK proof verified in `/api/gate` — optional `zkProof` on `POST`, `bb verify` against the committed vk, trusted roots from `LIGIS_ZK_TRUSTED_ROOTS`, (context, nullifier) replay → `STOP`, missing toolchain → explicit `unverified`/`UNKNOWN`; result shown as `Decision.zkCredential` and on `/gate`. See `docs/decide-api.md` § ZK credential proofs
- [x] Payee bound into the circuit — leaf = `H(identity_commitment, payee_hash, capability_hash, issuer, expires_at, nonce)`, `payee_hash` public; gate `STOP`s a proof for another payee (`bb` rejects a rewritten `payee_hash`)
- [x] Published registry root the gate can trust — `build-root` (CredentialRegistry events via read-only `eth_getLogs`, or fixture) → manifest; gate trusts `LIGIS_ZK_ROOT_MANIFEST` (root re-derived, staleness → `UNKNOWN`) or pinned roots; `GET /api/zk/root`; subject → identity-commitment mapping by EIP-191-signed registration
- [x] Offline end-to-end ZK gate demo — `pnpm demo:zcash-zk` (`scripts/zcash-zk-demo.lastrun.txt`)
- [x] On-chain root anchor & steward-signed root manifest — `signRootManifest()` + `checkManifest()` EIP-191 verification (`LIGIS_ZK_ROOT_SIGNER`), anchored on Monad Testnet at block `74058241` ([`0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f`](https://testnet.monadscan.com/tx/0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f))
- [x] Guided 4-step web demo (`/zcash`) + post-`GO` shielded ZEC release receipt (`pnpm demo:zcash-web`, `pnpm demo:zcash`)
- [x] README: "how to run the gate" (`README.md` § Zecathon)
- [x] Honest risks documented (latency, verifier availability, root freshness window, anonymity set, KV durability)
- [x] Live Zcash testnet broadcast txid & confirmed on-chain note (`d2b389c8fd108561f3cdc45cfcb373e7474dbb8804368fcd560135f9cb443f90`, confirmed at block `4,540,356` on `testnet.zec.rocks:443`)
- [ ] Demo video (2 min max)
- [ ] Submit before Zecathon closes (Oct 28, 2026 · 23:59 UTC)

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
