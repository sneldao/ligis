# GenLayer — JobEscrow contract and web UI

> **Status:** Showcase — kept working, not extended. See the [tier table](../../README.md#what-is-core-and-what-is-showcase).

### GenLayer Intelligent Contract (Agent Tank)

The GenLayer `JobEscrow` contract lives in `packages/contracts-genlayer/` and is
the adjudication half of the Ligis × GenLayer compose story. It targets
**Studio Next (studio_devnet, chain ID 61997)** — the network the Agent Tank
portal requires for the explorer-link field. Interface is frozen in
`docs/genlayer-interface-v1.md`; shared TS types in `@ligis/adapter-genlayer` → `interface.ts`.

**Setup (one-time, in a venv):**

```bash
cd packages/contracts-genlayer
pip install -r requirements.txt   # genlayer-py>=0.19.0rc2 (studio_devnet), genlayer-test, genvm-linter
```

**Lint:**

```bash
cd packages/contracts-genlayer
genvm-lint check contracts/JobEscrow.py
```

**Direct-mode tests (no Docker/Studio needed, ~1s):**

```bash
cd packages/contracts-genlayer
pytest tests/direct/ -v
```

Direct mode downloads the GenVM runtime tarball on first run (~216MB) into
`~/.cache/gltest-direct/`. If the sandbox blocks the SSL download, pre-fetch
with `curl -skL -o ~/.cache/gltest-direct/genvm-universal-v0.2.12.tar.xz
https://github.com/genlayerlabs/genvm/releases/download/v0.2.12/genvm-universal.tar.xz`.

**Deploy + full flow to Studio Next:**

```bash
cd packages/contracts-genlayer
export GENLAYER_PRIVATE_KEY=0x...   # optional; fresh account created if unset
python deploy.py                     # deploy + create -> deliver -> dispute -> resolve -> claim
python deploy.py --stop              # also show the STOP gate path
python deploy.py --no-deploy         # reuse existing contract (set JOBEscrow_ADDRESS)
# -> scripts/lastrun/genlayer-agent-tank-demo.lastrun.txt (address, job id, explorer URL)
```

**Live deployment (2026-09-16):**

- Contract: `0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F`
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F
- 5 transactions, all GenVM Result = SUCCESS
- `resolve` returned "undetermined" (AI-jury could not reach consensus — a valid GenLayer outcome)

Key points:

- **GenLayer v0.3.0 API** — the Studio dev runner uses v0.3.0 which has breaking
  changes: `gl.Contract` → `gl.contract.Contract`, `@allow_storage` →
  `@gl.storage.allow`, `from genlayer import *` → `import genlayer as gl` +
  `from genlayer.types import *`. Contract is fully migrated.
- **GenVM runner hash** — the magic comment must pin the current runner:
  `# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }`
  (old hash `1jb45aa8...` causes `invalid_contract runner malformed`).
- **Address fields** — the v0.3.0 GenVM does not auto-convert `str` to `Address`
  in storage dataclasses. Methods take `seller: str` and convert with
  `Address(seller)` internally.
- `studio_devnet` (chain 61997) requires `genlayer-py>=0.19.0rc2`; the stable
  `studionet` preset is a different network and does NOT satisfy the portal.
- **Fee estimation** — Studio dev requires fee distribution; `deploy.py` calls
  `client.estimate_transaction_fees()` and passes fees to all writes.
- **Receipt decoding** — `read_contract` with `raw_return=True` is needed for
  v0.3.0 contracts; the SDK's default u256/string decoder doesn't match the
  new GenVM calldata encoding. Decode hex manually: `bytes.fromhex(ret[2:]).decode()`.
- **Wait for finalization** — `wait_until="finalized"` (not just "decided") so
  reads see the post-transaction state. The `resolve` step may return
  "undetermined" — that's a valid GenLayer consensus outcome, not a bug.
- Contract uses `gl.nondet.web.render()` + `gl.nondet.exec_prompt(response_format="json")`
  inside `gl.eq_principle.strict_eq()` for the intelligent `resolve()`.
- Reverts use `raise Exception(msg)` (via `_require`), not `assert`, because
  `genlayer-test` direct mode's `expect_revert` re-raises `AssertionError`.
- `TreeMap` fields auto-initialize; do NOT assign `self.x = TreeMap()` in
  `__init__` (causes a type-desc mismatch).
- Default capability: `agent.commerce.escrow`. Gate is Option A (off-chain
  Ligis pre-flight; receipt stored on-chain via `gate_receipts[id]`).
- **Direct tests** — `genlayer-test` 0.29.2 downloads GenVM v0.2.12 which
  doesn't support the v0.3.0 API. Tests pass only when `genlayer-test` ships a
  v0.3.0-compatible runtime. The contract is verified working on-chain.

### GenLayer Web UI (Stream 4)

The thin observer UI lives at `web/app/genlayer/` and reads the deployed
JobEscrow IC on Studio Next (chain 61997) via `genlayer-js`.

**Pages:**

- `/genlayer` — contract address, job state, lifecycle visualization, gate
  receipt, verdict, architecture walkthrough
- Falls back gracefully when no contract is deployed (shows "deploy pending"
  - demo instructions from `pnpm demo:genlayer`)

**Key files:**

- `web/lib/genlayer.ts` — genlayer-js client with inline Studio Next chain
  definition (genlayer-js 1.1.x ships `studionet`, not 61997); reads
  `get_job`, `get_gate_receipt`, `job_count`, `is_eligible`
- `web/app/genlayer/actions.ts` — server action; resolves contract address
  from `GENLAYER_JOBEscrow_ADDRESS` env var or `lastrun.txt`
- `web/app/genlayer/page.tsx` — server component, reads contract state

**Navigation:** "Escrow" added to GlobalDock + CommandPalette (⌘K).

**Typecheck:**

```bash
cd web && npx tsc --noEmit
```

**Dev:**

```bash
cd web && pnpm dev   # http://localhost:3000/genlayer
```

Key points:

- genlayer-js 1.1.x supports custom chain configs via `createClient({ chain })`,
  so Studio Next (61997) is defined inline — reads work without a preset.
- The UI is read-only (observer). Write lifecycle (create → deliver → dispute
  → resolve → claim) is owned by `pnpm demo:genlayer` (Stream 3, shells to
  `deploy.py`).
- Contract address resolution: `GENLAYER_JOBEscrow_ADDRESS` env var →
  `scripts/lastrun/genlayer-agent-tank-demo.lastrun.txt` → null (shows fallback).
