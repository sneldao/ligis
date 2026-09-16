# Ligis × GenLayer — Agent Tank Hackathon

> **Hackathon**: [Agent Tank](https://portal.genlayer.foundation/agent-tank/hackathon/)
> **Portal submit**: https://portal.genlayer.foundation/agent-tank/hackathon/submit
> **Primary track**: Agent launch and commerce infra  
>  (“payments, escrow, identity and insurance for agents”)
> **Secondary framing** (if the form forces a single idea pick): Agentic marketplace disputes  
>  — only if the demo leads with adjudication; do not recenter the product there
> **Build window**: 3–17 September 2026 · **Winners**: 25 September  
> **Prize**: 5% of all GenLayer Points  
> **Status**: Stream 0 interface **LOCKED** — see [`docs/genlayer-interface-v1.md`](genlayer-interface-v1.md) · workboard [`docs/genlayer-streams.md`](genlayer-streams.md)  
> **Live Ligis today**: [ligis.vercel.app](https://ligis.vercel.app) · Casper + Pharos · x402 · CROO

---

## Product design (locked)

Ligis and GenLayer answer **different questions**. We compose them; we do not merge them.

| Layer        | Owner              | Question               | Nature                           | Timing                                          |
| ------------ | ------------------ | ---------------------- | -------------------------------- | ----------------------------------------------- |
| Eligibility  | **Ligis**          | _Who is allowed?_      | Deterministic `isCapable` + risk | **Before** value moves                          |
| Adjudication | **GenLayer**       | _What happened?_       | Intelligent Contract / AI-jury   | **After** (or mid-escrow) when parties disagree |
| Payment rail | x402 / CROO / etc. | _How does money move?_ | Settlement                       | Happy path + post-verdict                       |

**Public one-liner (portal + partners):**

> Ligis decides who may trade. GenLayer decides what happened when agents disagree on delivery. Gate → act → dispute → settle → (later) feed the outcome back into trust.

**Stakeholder rule:** Ligis remains the portable GO/STOP credential layer. GenLayer is an adjudication venue that **respects the gate** — the same posture we take with CROO CAP and x402. We do **not** reimplement `CredentialRegistry` on GenLayer, and GenLayer does **not** become the issuer of core KYC/capability credentials.

```
hire / pay intent
    → Ligis GATE (who may trade)          # existing: isCapable + risk
    → GenLayer JobEscrow open             # NEW: Intelligent Contract
    → work delivered (evidence URI / web)
    → optional dispute → AI-jury verdict  # NEW: why GenLayer exists
    → release / refund / slash
    → (roadmap) verdict → Ligis risk signal
```

### Non-goals (explicit)

- Do **not** port AgentId / CredentialRegistry to GenLayer as the source of truth.
- Do **not** use Intelligent Contracts to mint `kyc.basic` / core capabilities in the happy path.
- Do **not** submit Ligis-only with a token Studio Next deploy that never exercises judgment.
- Do **not** pitch “Ligis now runs on GenLayer” to Casper, Pharos, CROO, or 0G partners.

### Why this wins (judging lens)

Portal review expects more than a boilerplate star. Explicit bar from the form copy:

1. Frontend (or CLI demo) calls a **real GenLayer contract** on Studio Next.
2. **Decentralized judgment adds value** to the problem (not a deterministic re-check).
3. Contract stores **meaningful state** and validates outcomes.
4. Repo **builds**, goes **beyond boilerplate**, and has **clear repro**.
5. Hard gate: explorer link on **Studio Next chain ID 61997**  
   `https://explorer-studio-dev.genlayer.com/address/0x…`  
   Casper / Pharos / other-network links **do not** satisfy this field.

A Ligis-only story fails (2). A GenLayer-only escrow fails originality vs other tank builds and wastes our live commerce proof. The **compose** story is rare in the tank: identity+gate already live on multiple chains, plus subjective dispute — the gap GenLayer’s own docs say x402 / agent-identity stacks leave open.

---

## Optimal integration (win-oriented)

Ship a **complete vertical slice** judges can run and rate, not a stub. Parallelize; do not serialize on “MVP then polish.”

### End-state demo narrative (≤3 min video)

1. **Problem (15s)** — Agent A hires Agent B. Wallets aren’t trust. Happy-path rails (x402) don’t settle “was it good enough?”
2. **Gate (45s)** — Live Ligis: subject + capability → `isCapable` / risk on Casper (or Pharos). GO.
3. **Escrow (45s)** — Same job opens on GenLayer JobEscrow (Studio Next). Brief + stake + evidence URI stored on-chain.
4. **Dispute (60s)** — Buyer disputes. Intelligent Contract pulls/reads deliverable (web / Equivalence Principle), validators judge against the brief. Verdict + state transition visible in explorer.
5. **Settle (15s)** — Funds release or refund per verdict.
6. **Close (15s)** — One stack: Ligis = who; GenLayer = what happened. Repo + one-command repro.

### System components

| Component                        | Role                                                                              | Repo home (proposed)                                                      |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `JobEscrow` Intelligent Contract | Create job, fund, submit evidence, dispute, adjudicate, settle                    | `packages/contracts-genlayer/`                                            |
| Ligis gate adapter               | Before `create_job` / `fund`: verify subject capable (Casper read or attested GO) | `packages/adapter-genlayer/` or `packages/genlayer-bridge/`               |
| Demo orchestrator                | One script: gate → open → dispute → settle; writes `lastrun.txt`                  | `scripts/genlayer-agent-tank-demo.ts`                                     |
| Thin UI                          | Optional web page or Studio-facing page that calls the IC                         | `web/` route or `packages/genlayer-demo/`                                 |
| Portal / BUIDL copy              | Form fields + this doc’s pitch                                                    | `docs/genlayer-agent-tank.md` (+ submission appendix when addresses land) |

### Intelligent Contract — product shape

`JobEscrow` (see freeze + `packages/contracts-genlayer/contracts/JobEscrow.py`):

**State:** `jobs[id]`, `gate_receipts[id]`, monotonic `next_job_id`

**Writes:** payable `create_job` (open + stake) → `submit_delivery` → `open_dispute` → intelligent `resolve` → `claim` (plus `cancel_job` while open)

**Reads:** `get_job`, `get_gate_receipt`, `is_eligible`, `job_count`

Judgment is load-bearing in `resolve()` only. Ligis checks happen in the orchestrator and are enforced via stored `GateReceipt` at `create_job`.

### Ligis ↔ GenLayer bridge (pick one primary for the tank; implement adapter interface for both)

Winning demos need a **visible** Ligis call, not a comment in the README.

| Option                                                | How                                                                                                                                                                                      | Pros                                            | Cons                                         | Recommendation                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| **A. Pre-flight off-chain**                           | Demo/UI calls Ligis (`isCapable` / `ligis.verify` / risk) on Casper; only then submits `create_job` with a gate receipt (tx hash + subject + capability + timestamp) stored in job state | Fast; uses live Casper registry; clear in video | Gate is not enforced inside the IC           | **Primary for Agent Tank** — honest, shippable, shows live Ligis |
| **B. Attested GO on GenLayer**                        | Steward or issuer posts a short-lived “GO” attestation the IC checks in `create_job`                                                                                                     | Stronger on-chain coupling on Studio Next       | Extra moving parts; don’t mint real KYC here | **Stretch** if Option A lands early                              |
| **C. Equivalence / web read of Ligis UI or explorer** | IC fetches a public Ligis gate URL during resolve/create                                                                                                                                 | “Pure” GenLayer flavor                          | Fragile for judges; don’t rely on alone      | Support act only                                                 |

Implement **A** as the happy path. Keep a small `GateReceipt` struct in the IC so the panel sees Ligis in contract state, not only in the video voiceover.

### Roadmap hook (mention in portal; do not block submit)

Dispute terminal states become a future Ligis risk signal (`reputation.dispute_win` / concentration of losses) — same aggregation thesis as EAS / Self / World ID. Say it in the written application; do not require issuance from GenLayer for this hackathon.

---

## Parallel workstreams

Several engineers; one integration lead. Streams are independent after the contract interface freeze (Stream 0).

### Stream 0 — Interface freeze (lead) · **DONE 2026-09-16**

Owner: product / tech lead.

**Canonical freeze:** [`docs/genlayer-interface-v1.md`](genlayer-interface-v1.md) · workboard [`docs/genlayer-streams.md`](genlayer-streams.md)

Deliverables:

- [x] Final track choice confirmed: **Agent launch and commerce infra**
- [x] `JobEscrow` method + status enum locked (`open` → `delivered` → `disputed` → `resolved_*`; payable `create_job`)
- [x] `GateReceipt` schema locked (JSON keys for IC)
- [x] Studio Next target confirmed: chain ID **61997**
- [x] Shared workboard with stream owners + done-when checks
- [x] Shared TS types in `@ligis/core` (`genlayer.ts`) + adapter stubs

`GateReceipt` (v1) — JSON into `create_job`:

```text
subject            # agent / account identifier used in Ligis
capability         # e.g. agent.commerce.escrow
capability_hash    # optional but recommended (0x + keccak256)
capable            # bool — must be true
ligis_chain        # casper-testnet | pharos-atlantic | ...
proof_ref          # tx hash, verify response id, or gate URL
checked_at         # unix seconds
```

### Stream 1 — GenLayer Intelligent Contract

Owner: contract engineer(s).

Deliverables:

- [x] `packages/contracts-genlayer/` with `JobEscrow.py` (impl present — matches freeze)
- [ ] Deploy to **Studio Next** (`studio-dev` / chain 61997)
- [ ] Explorer link: `https://explorer-studio-dev.genlayer.com/address/0x…`
- [x] Interaction script: `deploy.py` create → deliver → dispute → resolve → claim
- [x] README: how judgment is invoked and what state changes
- [x] Beyond boilerplate: LLM + web fetch in `resolve()`

**Done when:** A stranger can open the explorer address, see a job with dispute+verdict fields populated, and reproduce from docs.

### Stream 2 — Ligis gate wiring

Owner: someone who already knows Casper adapter / risk / verify.

Status: **DONE** 2026-09-16 — implementation lives in `packages/adapter-genlayer/`
(Stream 0 created the home; Stream 2 filled in the function bodies). The Stream 0
freeze ([`genlayer-interface-v1.md`](genlayer-interface-v1.md)) locked the
`GateReceipt` schema first; Stream 2 aligned to it, did not drift it.

Deliverables:

- [x] Helper: `checkLigisGate({ subject, capability, ligisChain })` → `GateReceipt`
      in `packages/adapter-genlayer/src/check-gate.ts` (default chain
      `casper-testnet`, default capability `agent.commerce.escrow`)
- [x] Uses live Casper (`CasperAdapter.verifyCapability`) by default; Pharos via
      `ligisChain` argument or `LIGIS_GENLAYER_GATE_CHAIN` env var. Same env vars
      as the rest of the Ligis Casper integration (see AGENTS.md § Casper).
- [x] `refuseIfNotCapable` throws `GateRefusedError` on STOP with the receipt
      attached — Stream 3 wraps `create_job` with this and gets a hard refusal
      before any IC transaction is sent. Contract also asserts `capable=true`,
      so bypass would revert anyway (belt-and-braces).
- [x] Demo `scripts/genlayer-gate-demo.ts` (`pnpm demo:genlayer-gate`) prints
      GO + STOP receipts, snake_case JSON wire shape, and the typed-error
      contract. Runs without RPC keys; optional `LIGIS_LIVE_GATE=1` switches
      to the real Casper adapter.
- [x] Unit tests: `packages/adapter-genlayer/test/check-gate.test.ts` (9 passing)
      cover receipt shape, GO/STOP mapping, `GateRefusedError`, defaults match
      the frozen `GENLAYER_DEFAULT_*` constants.
- [ ] Optional: hit `ligis.verify` / risk for richer receipt fields — deferred
      to Stream 3 once Studio Next keys are available, since risk signals aren't
      needed for the happy-path demo verdict.

**Done when:** ✅ GO and STOP paths both run in the orchestrator
(`pnpm demo:genlayer-gate`); receipt fields land in IC job state via
`gateReceiptToJsonString(receipt)` matching the frozen schema in
[`genlayer-interface-v1.md`](genlayer-interface-v1.md).

### Stream 3 — Demo orchestrator + judge repro · **DONE 2026-09-16**

Owner: scripting / DX.

Deliverables:

- [x] `scripts/genlayer-agent-tank-demo.ts` — Ligis gate then GenLayer lifecycle
- [x] Writes `scripts/genlayer-agent-tank-demo.lastrun.txt` (via `deploy.py`)
- [x] One-command judge path: `pnpm demo:genlayer`
- [x] `runJobEscrowDemoViaPython` in `@ligis/adapter-genlayer` (Studio Next = genlayer-py)
- [x] Flags: `--mock-gate`, `--dry-run`, `--stop`, `--no-deploy`

**Done when:** `pnpm demo:genlayer` exits 0 on a funded Studio setup and prints explorer links.

### Stream 4 — UI / Studio-facing surface · **in progress 2026-09-16**

Owner: web.

Deliverables:

- [ ] Minimal page or local UI: show gate result → job status → dispute → verdict
- [ ] Must call the **deployed** Studio Next contract (portal criterion)
- [ ] Optional: deep-link to existing `/gate?chain=casper-testnet` for the Ligis half
- [ ] No redesign of landing/field — don’t burn time on Metropolis UX here

**Done when:** Screen recording can follow the full loop without raw RPC only.

### Stream 5 — Portal, video, partner messaging

Owner: founder / PM + whoever edits video.

Deliverables:

- [ ] GenLayer portal: Builder journey complete (GitHub linked + boilerplate starred)
- [ ] Wallet connected; one project per account
- [ ] Form: title, track, description, GitHub, Studio Next address, demo URL (YouTube or X)
- [ ] Demo video ≤3 min following the narrative above
- [ ] Reuse Casper/CROO footage only as **context**; GenLayer dispute must be live screen capture
- [ ] Partner blurb (Casper/CROO/0G): “adjudication venue that checks Ligis — not a registry move”

**Suggested form fields (draft):**

- **Title:** Ligis × GenLayer — credential-gated agent commerce with Intelligent Contract adjudication
- **Tagline:** Ligis says GO/STOP before payment; GenLayer rules when delivery is disputed
- **Repo:** `https://github.com/sneldao/ligis`
- **Track:** Agent launch and commerce infra

**Done when:** Submission saved on the portal; video public; editable until close if panel requests changes.

### Stream 6 — Stretch (only after 1–4 are green)

- [ ] Option B attested GO checked inside `create_job`
- [ ] Second job type (SLA / uptime) to show the IC is reusable
- [ ] Sketch `reputation.dispute_*` mapping doc for Phase-2 Ligis risk (no on-chain issue required)
- [ ] Project Explorer polish after acceptance

---

## Portal checklist (mechanical)

From live Agent Tank submit requirements:

- [ ] Become a **Builder** before submit
- [ ] Connect wallet
- [ ] Public GitHub repository
- [ ] Complete **every** project application section
- [ ] ≥1 contract on Studio Next **61997** with correct explorer URL
- [ ] Demo URL on **YouTube or X** (required)
- [ ] Pick a track
- [ ] reCAPTCHA
- [ ] Submit before **17 September** close (editable until tank closes)
- [ ] If panel asks for more: edit existing submission — do **not** create a second project

---

## Stakeholder messaging

| Audience          | Say                                                                         | Don’t say                         |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------- |
| GenLayer / judges | Compose eligibility + adjudication; judgment is load-bearing on Studio Next | “We brought our Casper contracts” |
| Casper / Pharos   | Same Ligis registry; GenLayer is another consumer of the gate               | “We’re migrating the registry”    |
| CROO / x402       | Pre-hire gate unchanged; disputes finally have a venue                      | “Ligis now settles payments”      |
| Investors         | Full stack story: identity → gate → pay → dispute → reputation loop         | “Pivot to GenLayer”               |

---

## Judge repro

```bash
# Ligis gate (Casper) + GenLayer Studio Next
set -a && source .env.d/casper.env && set +a
pnpm demo:genlayer

# Gate only (no GenLayer / Python):
pnpm demo:genlayer --dry-run

# GenLayer-only with labeled mock GO (no Casper credential required):
pnpm demo:genlayer --mock-gate
```

`pnpm demo:genlayer` runs Stream 2 `checkLigisGate`, injects `LIGIS_GATE_RECEIPT_JSON` into
`packages/contracts-genlayer/deploy.py`, and writes
`scripts/genlayer-agent-tank-demo.lastrun.txt`.

Live Ligis half (already works):  
https://ligis.vercel.app/gate?chain=casper-testnet

Studio Next half: paste explorer address from `lastrun.txt`.

---

## Decision log

| Date       | Decision                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-16 | Compose, don’t merge. Ligis = who; GenLayer = what happened.                                                                                                                                                              |
| 2026-09-16 | Primary track: Agent launch and commerce infra.                                                                                                                                                                           |
| 2026-09-16 | Optimal win plan (not minimum slice): full gate→escrow→dispute→settle vertical with parallel streams.                                                                                                                     |
| 2026-09-16 | Bridge primary: Option A pre-flight Ligis + `GateReceipt` in IC state.                                                                                                                                                    |
| 2026-09-16 | Non-goals: no CredentialRegistry on GenLayer; no GenLayer-minted core KYC for happy path.                                                                                                                                 |
| 2026-09-16 | **Stream 0 LOCKED:** payable `create_job` + JSON `GateReceipt`; no separate `funded` status; docs/genlayer-interface-v1.md is source of truth.                                                                            |
| 2026-09-16 | **Stream 3:** `pnpm demo:genlayer` orchestrates Ligis gate + Python `deploy.py` (Studio Next 61997); per-method genlayer-js deferred until chain preset exists.                                                           |
| 2026-09-16 | **Stream 2 DONE:** `checkLigisGate` in `@ligis/adapter-genlayer` calls `CasperAdapter.verifyCapability` by default; `refuseIfNotCapable` throws `GateRefusedError`; `pnpm demo:genlayer-gate` proves GO+STOP with no RPC. |
| 2026-09-16 | **Stream 4 in progress:** thin UI that calls the deployed JobEscrow; deep-link to `/gate?chain=casper-testnet` for the Ligis half; no Metropolis redesign.                                                                |
