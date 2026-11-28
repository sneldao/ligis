# Ligis — proofs

> The evidence bench. Three artifacts, each verifiable by a skeptic in
> under five minutes, each with a freshness date. Below them: the honest
> ledger of what does not work, then the historical record. When a
> positioning claim needs a measured number, the measurement lives here.
> Structure per `docs/consolidation-2026-11.md` — the post-hackathon
> consolidation plan.

## The bench — three artifacts

### 1. The production gate — live verification with enforcement

`https://ligis.vercel.app/gate` — pick the `casper-testnet · verified agent`
sample: the v2 credential renders with issuer link and expiry, and the
`rwa accredited` sample passes under **on-chain accreditation enforcement**
(namespace policy `rwa` requires an accredited issuer since 2026-11-28).
Falsifiable: the Monday CI smoke (`demo-credentials.yml`) reads every
fixture live and fails on regression. Freshness: continuous — verified by
CI on every push and weekly cron.

### 2. The procurement controller — order-bound payment control

`pnpm demo:airwallex` — order in, payment decision (GO/STOP/REVIEW),
executor holds Airwallex credentials, decision linked to transfer and
settlement. Last verified run: 2026-11-27
(`scripts/lastrun/airwallex-procurement-demo.lastrun.txt`).
**Freshness rule: re-run before citing in any external document.**

### 3. The Jev intent layer — reflexes on the payment path

Every gate decision carries a typed GO/STOP intent verdict (75–160 ms on
production). Falsifiable: the daily `jev-watchdog` workflow probes the
provenance line and fails when the route silently dies. Freshness:
continuous — green runs daily through 2026-11-27.

## The honest ledger — what does not work

| What                                                          | State                                                                                                                                                | Since                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| GatedVault deposit/withdraw demo                              | Broken at protocol level (pre-2.x Odra vs Casper 2.x value semantics). Never verifiably completed end-to-end. Repair path documented, not scheduled. | discovered 2026-11-28 |
| x402-server                                                   | Runs nowhere — no hosted instance. Dev-local only (`pnpm x402:dev`). Merchants cannot integrate against a live endpoint.                             | always                |
| GenLayer / Zcash / arena showcase surfaces                    | Frozen — venues closed without wins. Kept for the code, removed from the active proof bench.                                                         | 2026-11-28            |
| Monad/Pharos demo evidence                                    | Fixtures pass in smoke, but the demo scripts' lastrun artifacts are 2+ months stale. Not citation-grade.                                             | since ~2026-09        |
| `adapter-genlayer/interface`, `circuits-zcash/demo` typecheck | Broken builds excluded from the critical path (showcase freeze).                                                                                     | 2026-11-28            |

If anything above is wrong, the ledger is wrong — fix the ledger first,
then the thing.

## Venue history

**Closed without wins (2026):** Zecathon, GenLayer Agent Tank, Metropolis
(Monad). Postmortem and the shape lesson in
[`docs/consolidation-2026-11.md`](consolidation-2026-11.md). Submission
docs archived in [`docs/archive/`](archive/).

## Hackathon submissions (historical record)

| Hackathon                          | Track                               | Demo                                                                                                                                                                     | Submission doc                                                            |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **The Agent Arena (Vultr) 2026**   | Agent infrastructure & containment  | [ligis.vercel.app/arena](https://ligis.vercel.app/arena) — prompt-injected $60k payment stopped live by Jev + Vultr Serverless Inference judges                          | [`docs/agent-arena.md`](agent-arena.md)                                   |
| **GenLayer Agent Tank 2026**       | Agent launch & commerce infra       | [60s demo (YouTube)](https://youtu.be/goACAqXjUxY) · [ligis.vercel.app/genlayer](https://ligis.vercel.app/genlayer) · JobEscrow `0x64eF9e...D0cB0F` on Studio Next 61997 | [`docs/archive/genlayer-agent-tank.md`](archive/genlayer-agent-tank.md)   |
| **Metropolis (Monad) 2026**        | Trust, Identity & AI Infrastructure | Live gate (GO / revoked STOP / none), Envio full history, `pnpm demo:monad` on testnet _(browser writes pending)_                                                        | [`docs/archive/metropolis-hackathon.md`](archive/metropolis-hackathon.md) |
| **Monid "We Kill" Hackathon 2026** | Agent-native SaaS replacement       | _(status unconfirmed — verify before citing)_                                                                                                                            | [`docs/monid-hackathon.md`](monid-hackathon.md)                           |
| **OKX.AI Genesis Hackathon 2026**  | General ASP — Trust & Verification  | _(status unconfirmed — verify before citing)_                                                                                                                            | [`docs/okx-ai.md`](okx-ai.md)                                             |
| **Zecathon 2026**                  | Shielded Payments (+ Grand Prize)   | `pnpm demo:zcash` on testnet (disclosure → GO → nullifier replay STOP; `.lastrun.txt`)                                                                                   | [`docs/archive/zecathon-entry.md`](archive/zecathon-entry.md)             |

**Completed (submitted, not winning):** Casper Agentic Buildathon 2026 — final
round, see [`docs/archive/casper-final-round.md`](archive/casper-final-round.md);
CROO Agent Hackathon 2026 — provider still live on the Agent Store, see
[`docs/archive/croo-hackathon-submission.md`](archive/croo-hackathon-submission.md).
0G Bridge by AKINDO 2026 was never submitted — dropped.

**One product, multiple proofs:** Casper contracts are the on-chain
source of truth; CROO and OKX.AI are how other agents pay for
verification before A2A commerce. GenLayer is the adjudication venue
when delivery is disputed (Ligis still gates who may trade). 0G Compute
and 0G Storage power the trust infrastructure. Same `CredentialRegistry`
backs every marketplace.

## GenLayer JobEscrow — gate → escrow → dispute → settle

**Live on Studio Next (chain 61997):**
[`0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F`](https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F)

```bash
# Full flow: Ligis gate → GenLayer create → deliver → dispute → resolve → claim
pnpm demo:genlayer

# Gate only (no GenLayer / Python):
pnpm demo:genlayer --dry-run

# GenLayer-only with labeled mock GO (no Casper credential required):
pnpm demo:genlayer --mock-gate

# Ligis gate proof (GO + STOP shapes, no RPC needed):
pnpm demo:genlayer-gate
LIGIS_LIVE_GATE=1 pnpm demo:genlayer-gate  # live Casper verifyCapability
```

Web UI: [ligis.vercel.app/genlayer](https://ligis.vercel.app/genlayer) —
reads the deployed contract live (job state, gate receipt, lifecycle,
verdict).

Implementation:
`packages/contracts-genlayer/contracts/JobEscrow.py` (Intelligent
Contract) + `packages/adapter-genlayer/src/check-gate.ts` (Ligis gate
bridge). Schema locked in
[`docs/genlayer-interface-v1.md`](genlayer-interface-v1.md); full plan in
[`docs/archive/genlayer-agent-tank.md`](archive/genlayer-agent-tank.md).

## Demo videos

### GenLayer Agent Tank (gate → escrow → dispute → settle)

[Watch the 60s demo (YouTube)](https://youtu.be/goACAqXjUxY)

- Ligis gate on Casper → GenLayer JobEscrow → dispute → AI-jury verdict,
  with live captures of the deployed contract UI and the Studio Next
  explorer. Composition source formerly at `videos/ligis-genlayer-tank/`
  (removed from the repo; in git history before 2026-11-27).

### Casper Agentic Buildathon (on-chain identity + x402)

[Watch the 1:05 walkthrough (YouTube)](https://youtu.be/eoOQmAx7U7s)
— also viewable on the
[release page](https://github.com/sneldao/ligis/releases/tag/buildathon-2026).

### CROO Agent Hackathon (CAP commerce + verification)

[Watch the CROO walkthrough](https://github.com/sneldao/ligis/releases/download/croo-hackathon-2026/ligis-croo-demo.mp4)
— CAP negotiate → pay → deliver, with Casper on-chain proof. Composition
source formerly at `videos/ligis-croo-hackathon/` (removed from the repo;
in git history before 2026-11-27).

The Casper video was composed using
[HyperFrames](https://github.com/heygen-com/hyperframes) with live
terminal captures of `casper-e2e-demo.ts` and `casper-x402-demo.ts`,
real cspr.live transaction screenshots, and a 10-segment TTS voiceover —
composition source formerly at `videos/ligis-buildathon-2026/` (removed
from the repo; in git history before 2026-11-27).

## On-chain deployment evidence

`docs/strategy.md` "Status" lists the deployed addresses per chain.
Each address in the live deployment row has a corresponding explorerscan
link and a `scripts/` reproducer that proves the on-chain state at the
time of writing. When the live numbers shift (e.g., a new GatedVault
deployment, a Casper upgrade), this doc moves with them so the measured
claims in `docs/positioning.md` stay backed.

| Chain               | Contracts                                                                        | Source of truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pharos Atlantic** | `PharosAgentID`, `CredentialRegistry`                                            | `packages/contracts-evm/` + Vercel env vars                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Casper Testnet**  | `AgentId`, `CredentialRegistry`, `GatedVault`                                    | `packages/contracts-casper/wasm/`, deploy recipe in [`docs/agent-notes/casper.md`](agent-notes/casper.md). **Caveat 2026-11-28:** the GatedVault deposit/withdraw demo is broken at the protocol level and never verifiably completed end-to-end — do not cite it as working evidence. The working Casper evidence is the v2 credential registry: live `/gate` verification with on-chain accreditation enforcement (smoke-tested weekly in CI, incl. the `rwa.accredited` fixture) |
| **Monad Testnet**   | `CredentialRegistry`, `AgentId`, `PasskeyIssuer`, ERC-8004 registries, x402 USDC | `assets/networks.json` → `deployment["monad-testnet"]` + `docs/integrate-monad.md`                                                                                                                                                                                                                                                                                                                                                                                                  |
| **GenLayer Studio** | `JobEscrow` (Intelligent Contract)                                               | `packages/contracts-genlayer/` + `docs/genlayer-interface-v1.md`                                                                                                                                                                                                                                                                                                                                                                                                                    |

## How to add a new proof

When a new submission lands:

1. Add a row to "Active hackathon submissions" with the venue, track,
   demo URL, and submission doc path.
2. Add the deployment evidence row to "On-chain deployment evidence" if
   it touches a chain.
3. Update [`docs/positioning.md`](./positioning.md) "Claims, with
   sources" if a measurable number lives here.
4. Cross-link from the relevant app page (e.g.,
   `/arena` → Vultr Agent Arena row; `/genlayer` → GenLayer row).

When a submission is finalized without winning, move it to the
"Completed" line under the active table; archive the detailed doc under
`docs/archive/`.
