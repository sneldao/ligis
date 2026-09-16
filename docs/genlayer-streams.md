# GenLayer Agent Tank — Parallel Workboard

> **Interface freeze:** [`genlayer-interface-v1.md`](genlayer-interface-v1.md) **(LOCKED)**  
> Product plan: [`genlayer-agent-tank.md`](genlayer-agent-tank.md)

| Stream | Focus                   | Owner | Status                             | Done when                                                 |
| ------ | ----------------------- | ----- | ---------------------------------- | --------------------------------------------------------- |
| **0**  | Interface freeze        | lead  | **DONE** 2026-09-16                | Types + docs + stubs; Streams 1–4 unblocked               |
| **1**  | `JobEscrow` Studio Next | _TBD_ | **code-complete** — deploy pending | Live `61997` explorer URL                                 |
| **2**  | `checkLigisGate`        | —     | **DONE** 2026-09-16                | Live Casper/Pharos `GateReceipt`; GO + STOP               |
| **3**  | Demo orchestrator       | lead  | **DONE** 2026-09-16                | `pnpm demo:genlayer` → gate + `deploy.py` → `lastrun.txt` |
| **4**  | Thin UI                 | _TBD_ | **code-complete** 2026-09-16       | Calls deployed IC                                         |
| **5**  | Portal + video          | _TBD_ | blocked on live address + demo     | Portal submit + YouTube/X                                 |
| **6**  | Stretch                 | —     | after 1–4                          | Option B / reputation mapping                             |

## Stream 0 deliverables (done)

- [x] Track + Studio Next 61997 + status enum + GateReceipt + shared types + workboard

## Stream 1 deliverables (code-complete 2026-09-16)

- [x] `JobEscrow.py`, `deploy.py`, tests, lint, README
- [ ] Deploy to Studio Next 61997 — needs funded account + network
- [ ] Fill explorer address in README + `lastrun.txt` after deploy

## Stream 2 deliverables (done 2026-09-16)

- [x] `checkLigisGate` / `refuseIfNotCapable` / `gateFromVerifyResult`
- [x] Unit tests + `pnpm demo:genlayer-gate`

## Stream 3 deliverables (done 2026-09-16)

- [x] `pnpm demo:genlayer` — Ligis gate then injects `LIGIS_GATE_RECEIPT_JSON` into `deploy.py`
- [x] `runJobEscrowDemoViaPython` in `@ligis/adapter-genlayer`
- [x] Flags: `--mock-gate`, `--dry-run`, `--stop`, `--no-deploy`, `--help`
- [x] `deploy.py` accepts live receipt via env (no longer hardcodes mock only)
- [x] Unit tests for `parseLastrun` + `createJobEscrowClient` fail-fast
- [ ] Live end-to-end on Studio Next (needs Python deps + network + optionally capable Ligis subject)

```bash
set -a && source .env.d/casper.env && set +a
pnpm demo:genlayer --dry-run       # Ligis only
pnpm demo:genlayer --mock-gate     # GenLayer with mock GO
pnpm demo:genlayer                 # live Ligis + GenLayer
```

**Note:** genlayer-js 1.1.x ships `studionet`, not Studio Next (61997). The web UI defines the chain inline via `createClient({ chain: ... })` — reads work. Write lifecycle (create → deliver → dispute → resolve → claim) uses genlayer-py via `deploy.py` (Stream 3).

## Stream 4 deliverables (code-complete 2026-09-16)

- [x] `web/lib/genlayer.ts` — genlayer-js client for Studio Next (chain 61997); reads `get_job`, `get_gate_receipt`, `job_count`, `is_eligible`
- [x] `web/app/genlayer/page.tsx` — thin observer UI: contract address, job state, lifecycle visualization, gate receipt, verdict, architecture walkthrough
- [x] `web/app/genlayer/actions.ts` — server action with graceful fallback (shows "deploy pending" + demo instructions when no contract deployed)
- [x] Deep-links to explorer + `/gate?chain=casper-testnet` for the Ligis half
- [x] Reads `scripts/genlayer-agent-tank-demo.lastrun.txt` for contract address + last run summary
- [x] Navigation: "Escrow" added to GlobalDock + CommandPalette (⌘K)
- [x] `genlayer-js@^1.1.8` dependency; Studio Next chain defined inline (genlayer-js ships `studionet`, not 61997)
- [x] Typecheck passes
- [ ] Live reads against deployed contract (needs Stream 1 deploy first)

## Kickoff (remaining)

**Stream 1:** Deploy + paste explorer `0x…`  
**Stream 5:** Portal + video
