# Ligis — proofs

> The Ligis → venue → outcome trail that backs every measured claim in
> [`docs/positioning.md`](./positioning.md). Each row is a single
> submission or deployment with its on-chain footprint, demo link, and
> submission doc. When a positioning claim needs a measured number, the
> measurement lives here.

## Active hackathon submissions

| Hackathon                          | Track                               | Demo                                                                                                                                                                     | Submission doc                                            |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **The Agent Arena (Vultr) 2026**   | Agent infrastructure & containment  | [ligis.vercel.app/arena](https://ligis.vercel.app/arena) — prompt-injected $60k payment stopped live by Jev + Vultr Serverless Inference judges                          | [`docs/agent-arena.md`](agent-arena.md)                   |
| **GenLayer Agent Tank 2026**       | Agent launch & commerce infra       | [60s demo (YouTube)](https://youtu.be/goACAqXjUxY) · [ligis.vercel.app/genlayer](https://ligis.vercel.app/genlayer) · JobEscrow `0x64eF9e...D0cB0F` on Studio Next 61997 | [`docs/genlayer-agent-tank.md`](genlayer-agent-tank.md)   |
| **Metropolis (Monad) 2026**        | Trust, Identity & AI Infrastructure | Live gate (GO / revoked STOP / none), Envio full history, `pnpm demo:monad` on testnet _(browser writes pending)_                                                        | [`docs/metropolis-hackathon.md`](metropolis-hackathon.md) |
| **Monid "We Kill" Hackathon 2026** | Agent-native SaaS replacement       | _(in progress)_                                                                                                                                                          | [`docs/monid-hackathon.md`](monid-hackathon.md)           |
| **OKX.AI Genesis Hackathon 2026**  | General ASP — Trust & Verification  | _(in progress)_                                                                                                                                                          | [`docs/okx-ai.md`](okx-ai.md)                             |

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
[`docs/genlayer-agent-tank.md`](genlayer-agent-tank.md).

## Demo videos

### GenLayer Agent Tank (gate → escrow → dispute → settle)

[Watch the 60s demo (YouTube)](https://youtu.be/goACAqXjUxY)

- Ligis gate on Casper → GenLayer JobEscrow → dispute → AI-jury verdict,
  with live captures of the deployed contract UI and the Studio Next
  explorer. Source:
  [`videos/ligis-genlayer-tank/`](https://github.com/sneldao/ligis/tree/main/videos/ligis-genlayer-tank).

### Casper Agentic Buildathon (on-chain identity + x402)

[Watch the 1:05 walkthrough (YouTube)](https://youtu.be/eoOQmAx7U7s)
— also viewable on the
[release page](https://github.com/sneldao/ligis/releases/tag/buildathon-2026).

### CROO Agent Hackathon (CAP commerce + verification)

[Watch the CROO walkthrough](https://github.com/sneldao/ligis/releases/download/croo-hackathon-2026/ligis-croo-demo.mp4)
— CAP negotiate → pay → deliver, with Casper on-chain proof. Source:
[`videos/ligis-croo-hackathon/`](https://github.com/sneldao/ligis/tree/main/videos/ligis-croo-hackathon).

The Casper video is composed in
[`videos/ligis-buildathon-2026/`](https://github.com/sneldao/ligis/tree/main/videos/ligis-buildathon-2026/)
using [HyperFrames](https://github.com/heygen-com/hyperframes) with live
terminal captures of `casper-e2e-demo.ts` and `casper-x402-demo.ts`,
real cspr.live transaction screenshots, and a 10-segment TTS voiceover.

## On-chain deployment evidence

`docs/strategy.md` "Status" lists the deployed addresses per chain.
Each address in the live deployment row has a corresponding explorerscan
link and a `scripts/` reproducer that proves the on-chain state at the
time of writing. When the live numbers shift (e.g., a new GatedVault
deployment, a Casper upgrade), this doc moves with them so the measured
claims in `docs/positioning.md` stay backed.

| Chain               | Contracts                                               | Source of truth                                                  |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| **Pharos Atlantic** | `PharosAgentID`, `CredentialRegistry`                   | `packages/contracts-evm/` + Vercel env vars                      |
| **Casper Testnet**  | `AgentId`, `CredentialRegistry`, `GatedVault`           | `packages/contracts-casper/wasm/`, deploy recipe in `AGENTS.md`  |
| **Monad Testnet**   | (passkey issuer demo; main registry deployment pending) | `packages/contracts-evm/` + `docs/integrate-monad.md`            |
| **GenLayer Studio** | `JobEscrow` (Intelligent Contract)                      | `packages/contracts-genlayer/` + `docs/genlayer-interface-v1.md` |

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
