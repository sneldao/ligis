# GenLayer JobEscrow — Interface Freeze v1

> **Status:** LOCKED (Stream 0) · 2026-09-16  
> **Canonical implementation sketch:** `packages/contracts-genlayer/contracts/JobEscrow.py`  
> **Shared types:** `@ligis/core` → `genlayer.ts`  
> **Workboard:** [`docs/genlayer-streams.md`](genlayer-streams.md)  
> **Parent plan:** [`docs/genlayer-agent-tank.md`](genlayer-agent-tank.md)  
> **Breaking changes:** require a v1.1+ bump and Stream 0 re-approval.

This freeze matches the GenLayer-idiomatic shape already in `JobEscrow.py`:
**payable `create_job` (open + fund in one call)**, Ligis `GateReceipt` as JSON,
intelligent `resolve()`, then `claim()`.

---

## Confirmed targets

| Item                   | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| **Track**              | Agent launch and commerce infra                                    |
| **Network name**       | `genlayer-studio-next`                                             |
| **Chain ID**           | `61997`                                                            |
| **RPC / API**          | `https://studio-dev.genlayer.com/api`                              |
| **Explorer**           | `https://explorer-studio-dev.genlayer.com/address/<addr>`          |
| **Default capability** | `agent.commerce.escrow`                                            |
| **Who is gated (v1)**  | **Seller** (Ligis subject in the receipt)                          |
| **Bridge**             | **Option A** — off-chain Ligis pre-flight; receipt stored on-chain |
| **Contract**           | `JobEscrow`                                                        |

---

## Status enum (frozen)

Exact spellings:

| Status             | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `open`             | Created + stake locked; awaiting seller delivery                      |
| `delivered`        | Seller posted `evidence_uri`                                          |
| `disputed`         | Buyer opened dispute                                                  |
| `resolved_release` | Verdict APPROVED (or cancel path N/A) — seller may claim              |
| `resolved_refund`  | Verdict REJECTED (or buyer `cancel_job` while open) — buyer may claim |
| `claimed`          | Represented by `claimed: true` on the job (status stays `resolved_*`) |

**Lifecycle (happy dispute demo):**

```text
create_job (payable) → open
  → submit_delivery → delivered
  → open_dispute → disputed
  → resolve → resolved_release | resolved_refund
  → claim (claimed flag)
```

**Cancel path:** `open` → `cancel_job` → `resolved_refund` + immediate reclaim (`claimed=true`).

There is **no** separate `funded` status in v1 — stake is locked in `create_job`.

---

## GateReceipt (frozen)

JSON object passed into `create_job` as `gate_receipt_json`. Also returned by `get_gate_receipt`.

| Field          | JSON key          | Type   | Notes                                              |
| -------------- | ----------------- | ------ | -------------------------------------------------- |
| subject        | `subject`         | string | Seller Ligis id (`account-hash-…` / `0x…`)         |
| capability     | `capability`      | string | Must equal `required_capability` arg               |
| capabilityHash | `capability_hash` | string | Optional but **recommended**; `0x`+keccak256 UTF-8 |
| capable        | `capable`         | bool   | Must be `true` or IC asserts                       |
| ligisChain     | `ligis_chain`     | string | e.g. `casper-testnet`                              |
| proofRef       | `proof_ref`       | string | Judge-openable URL or tx hash                      |
| checkedAt      | `checked_at`      | number | Unix seconds                                       |

Contract asserts: `capable is True` and `capability == required_capability`.

---

## Intelligent Contract API (frozen)

### Writes

| Method            | Args                                                                                  | Notes                                         |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `create_job`      | `seller: Address`, `brief: str`, `required_capability: str`, `gate_receipt_json: str` | **payable**; returns `job_id`                 |
| `submit_delivery` | `job_id`, `evidence_uri: str`                                                         | seller only; `open` → `delivered`             |
| `open_dispute`    | `job_id`, `reason: str`                                                               | buyer only; `delivered` → `disputed`          |
| `resolve`         | `job_id`                                                                              | ★ intelligent; returns terminal status string |
| `claim`           | `job_id`                                                                              | pays seller or buyer per status               |
| `cancel_job`      | `job_id`                                                                              | buyer only while `open`; refund               |

### Views

| Method                     | Returns                        |
| -------------------------- | ------------------------------ |
| `get_job(job_id)`          | JSON **string** of job fields  |
| `get_gate_receipt(job_id)` | JSON **string** of GateReceipt |
| `is_eligible(job_id)`      | `bool` (stored `capable`)      |
| `job_count()`              | `u256`                         |

### `get_job` JSON fields

`id`, `buyer`, `seller`, `brief`, `stake`, `status`, `evidence_uri`, `dispute_reason`, `verdict_summary`, `required_capability`, `subject`, `created_at`, `delivered_at`, `disputed_at`, `resolved_at`, `claimed`

### `resolve()` bar (non-negotiable)

Must fetch `evidence_uri` (web) and use GenLayer nondet / equivalence (LLM jury) so judgment is load-bearing. No deterministic “buyer always wins” shortcut.

---

## Off-chain APIs (Streams 2–4)

### `checkLigisGate` (Stream 2)

```ts
checkLigisGate({
  subject: string;
  capability?: string;     // default agent.commerce.escrow
  ligisChain?: string;     // default casper-testnet
}): Promise<GateReceipt>
```

### Demo (Stream 3)

`pnpm demo:genlayer` → gate → `create_job` (with value) → `submit_delivery` → `open_dispute` → `resolve` → `claim` → `scripts/genlayer-agent-tank-demo.lastrun.txt`

### UI (Stream 4)

`readContract` / `writeContract` on Studio Next address; parse JSON strings from views.

---

## Demo evidence convention

|              |                                                                             |
| ------------ | --------------------------------------------------------------------------- |
| Brief        | Must include a clear, checkable requirement (phrase / verdict)              |
| Pass fixture | Public URL whose body satisfies the brief → `APPROVED` / `resolved_release` |
| Fail fixture | Public URL that fails the brief → `REJECTED` / `resolved_refund`            |

Stream 3 owns fixture hosting under this repo or a gist.

---

## Non-goals

- No CredentialRegistry / AgentId on GenLayer
- No GenLayer-minted core KYC
- No Option B in-IC attested GO for v1
- No Metropolis landing/field redesign in these streams

---

## Package layout

| Path                                  | Owner                                                    |
| ------------------------------------- | -------------------------------------------------------- |
| `docs/genlayer-interface-v1.md`       | Stream 0                                                 |
| `packages/core/src/genlayer.ts`       | Stream 0                                                 |
| `packages/contracts-genlayer/`        | Stream 1 (impl largely started — finish deploy + harden) |
| `packages/adapter-genlayer/`          | Streams 2 + 3                                            |
| `scripts/genlayer-agent-tank-demo.ts` | Stream 3                                                 |
| Thin web UI                           | Stream 4                                                 |
