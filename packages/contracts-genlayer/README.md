# @ligis/contracts-genlayer

GenLayer Intelligent Contract for the [Agent Tank](../../docs/genlayer-agent-tank.md) submission —
the **adjudication** half of the Ligis × GenLayer compose story.

> Ligis decides **who** may trade. GenLayer decides **what happened** when delivery is disputed.
> `gate → create_job → deliver → dispute → resolve → claim`

This package implements `JobEscrow`, a Python Intelligent Contract deployed on
**Studio Next (studio_devnet, chain ID 61997)** — the network the portal requires
for the explorer-link field.

> **Interface freeze:** aligned to [`docs/genlayer-interface-v1.md`](../../docs/genlayer-interface-v1.md)
> (Stream 0, LOCKED). Method names, status enum, `GateReceipt` schema, and default
> capability (`agent.commerce.escrow`) match the freeze exactly. Shared TS types
> live in `@ligis/core` → `genlayer.ts`.

## Contract

`contracts/JobEscrow.py` — one focused contract, many jobs (TreeMap).

### State (meaningful, not echo storage)

| Field               | Type          | Purpose                                                                                                                           |
| ------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `jobs[id]`          | `Job`         | buyer, seller, brief, stake, status, evidence_uri, dispute_reason, verdict_summary, timestamps                                    |
| `gate_receipts[id]` | `GateReceipt` | on-chain mirror of the Ligis pre-flight proof (subject, capability, capable, ligis_chain, proof_ref, checked_at, capability_hash) |
| `next_job_id`       | `u256`        | monotonic counter                                                                                                                 |

Status enum (locked by Stream 0):

```
open -> delivered -> disputed -> resolved_release | resolved_refund
                                  --> claim() pays out per terminal status
```

### Methods

| Method                                                              | Decorator                  | Role                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `create_job(seller, brief, required_capability, gate_receipt_json)` | `@gl.public.write.payable` | Open + fund. **Enforces the Ligis gate** (receipt `capable == True` + capability match) and stores the receipt on-chain. Default capability: `agent.commerce.escrow`.                                          |
| `submit_delivery(job_id, evidence_uri)`                             | `@gl.public.write`         | Seller only. `open → delivered`.                                                                                                                                                                               |
| `open_dispute(job_id, reason)`                                      | `@gl.public.write`         | Buyer only. `delivered → disputed`.                                                                                                                                                                            |
| `resolve(job_id)`                                                   | `@gl.public.write`         | **Intelligent path.** Each validator fetches the deliverable from the web and asks an LLM to judge it against the brief. Consensus on the binary verdict (Equivalence Principle). `disputed → resolved_release | resolved_refund`. |
| `claim(job_id)`                                                     | `@gl.public.write`         | Pays the stake to the seller (release) or buyer (refund). Idempotent.                                                                                                                                          |
| `cancel_job(job_id)`                                                | `@gl.public.write`         | Buyer cancels an open job and reclaims the stake.                                                                                                                                                              |
| `get_job`, `get_gate_receipt`, `is_eligible`, `job_count`           | `@gl.public.view`          | Reads for UI / explorer / orchestrator.                                                                                                                                                                        |

## How judgment is invoked and what state changes

`resolve()` is the GenLayer-native, load-bearing step:

1. The caller triggers `resolve(job_id)` on a `disputed` job.
2. Inside a **non-deterministic block** (`gl.vm.run_nondet_unsafe`):
   - **Leader** fetches the deliverable via `gl.nondet.web.get(evidence_uri)` — native web access, no oracle.
   - **Leader** calls `gl.nondet.exec_prompt(prompt, response_format="json")` with a prompt that compares the fetched deliverable against the stored `brief` and the buyer's `dispute_reason`.
   - **Validators** independently repeat the fetch + LLM call.
   - **Equivalence Principle**: consensus is reached when validators agree on the binary `verdict` (`APPROVED`/`REJECTED`), _not_ on the reasoning. Different wording, same verdict = consensus.
3. **After consensus** (deterministic context): storage is written — `status` becomes `resolved_release` (APPROVED) or `resolved_refund` (REJECTED), and `verdict_summary` stores the reasoning.
4. `claim()` is a separate transaction so the state transition is **visible in the explorer** before funds move.

If you removed the LLM/web step, the product collapses — there is no deterministic
fallback for "was the delivery good enough?". That is exactly the gap GenLayer
fills and why this contract is not on Casper/Pharos.

## The Ligis gate (visible, not a README comment)

The gate is enforced in `create_job()`: the caller supplies a `gate_receipt_json`
produced off-chain by Stream 2's `checkLigisGate({ subject, capability })` (live
Casper `isCapable` read). The contract asserts `capable == True` and stores the
full receipt (subject, capability, ligis_chain, proof_ref, checked_at) on-chain
via `gate_receipts[id]`. A judge can open the explorer, call `get_gate_receipt`,
and see the Ligis proof — not just hear it in the voiceover. The STOP path
(`capable == False`) reverts `create_job`, demonstrated by `deploy.py --stop`.

This is **Option A** (pre-flight off-chain) from the win plan: honest, shippable,
uses the live Casper registry, and keeps Ligis as the portable eligibility source
of truth. GenLayer does **not** become the issuer of core KYC/capability credentials.

## Deploy

### Option 1 — Studio UI (fastest, recommended for judges)

1. Open [studio-dev.genlayer.com](https://studio-dev.genlayer.com) (chain 61997).
2. New contract → paste `contracts/JobEscrow.py`.
3. Deploy (no constructor args). Copy the address.
4. Interact via the Read/Write panels, or run `deploy.py` with
   `JOBEscrow_ADDRESS=0x... python deploy.py --no-deploy`.

### Option 2 — CLI

```bash
npm install -g genlayer
genlayer deploy --contract contracts/JobEscrow.py --rpc https://studio-dev.genlayer.com/api
```

### Option 3 — Scripted (deploy + full flow)

```bash
pip install -r requirements.txt
export GENLAYER_PRIVATE_KEY=0x...   # optional; fresh account created if unset
python deploy.py                     # deploy + create -> deliver -> dispute -> resolve -> claim
python deploy.py --stop              # also show the STOP gate path
```

`deploy.py` targets `studio_devnet` (chain 61997) via `genlayer-py` and writes
`scripts/genlayer-agent-tank-demo.lastrun.txt` with the contract address, job id,
and explorer URL for Stream 3's one-command demo.

## Test

```bash
pip install -r requirements.txt
pytest tests/direct/ -v
```

Direct-mode tests run in-memory (no Docker/Studio) and cover: gate GO/STOP/capability
mismatch, role enforcement, state transitions, and `resolve()` with mocked web + LLM
for both APPROVED and REJECTED verdicts.

## Lint

```bash
pip install genvm-linter
genvm-lint check contracts/JobEscrow.py
```

## Judge repro

```bash
# Ligis gate (existing, Stream 2)
set -a && source .env.d/casper.env && set +a

# GenLayer Studio Next
cd packages/contracts-genlayer
pip install -r requirements.txt
python deploy.py
# -> scripts/genlayer-agent-tank-demo.lastrun.txt
# -> explorer: https://explorer-studio-dev.genlayer.com/address/0x...
```

## Explorer

> **Studio Next address (chain 61997):** _`0x…` — fill from `lastrun.txt` after first deploy._

Explorer base: `https://explorer-studio-dev.genlayer.com/address/0x…`

## Roadmap hook (not blocking)

Dispute terminal states (`resolved_release` / `resolved_refund` + `verdict_summary`)
become a future Ligis risk signal (`reputation.dispute_win`, concentration of losses)
— the same aggregation thesis as EAS / Self / World ID. Stated in the portal
application; no on-chain issuance from GenLayer required for this hackathon.
