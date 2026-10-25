# Ligis

> **Evidence-based payment control for autonomous finance.**
> **Ligis makes sure finance agents pay for what the business actually authorized, not simply what an agent requests.**
> **Order-bound checks (supplier destination, price tolerance, duplicate invoice, unresolved retry, mandate) enforced on the Airwallex payout path.**
> **Airwallex hackathon:** see [`docs/airwallex-submission.md`](docs/airwallex-submission.md).
> **Also live:** the stateless pre-payment gate on Pharos + Casper + Monad (right payee, right amount, in scope, verified payee).
> **PayBox Ch.1:** see [`docs/paybox-ch1.md`](docs/paybox-ch1.md) — money-with-a-conscience vision.

[![CI](https://github.com/sneldao/ligis/actions/workflows/ci.yml/badge.svg)](https://github.com/sneldao/ligis/actions/workflows/ci.yml)

**The product.** A business records what it agreed to buy. Its agent asks
Ligis to pay against that order, and `packages/procurement` checks the
request against the order and its payment history, returning `GO`, `STOP`
or `REVIEW`. Ligis's executor holds the Airwallex credentials and calls
`transfers/create` only on `GO`. Each decision is linked to its transfer
and final settlement state. Run it: `pnpm demo:airwallex`.

**The stateless gate.** A single API call — `POST /api/gate` — returns `GO` or
`STOP` before your agent's wallet pays a stranger. Decisions are built
from four signals — right payee, right amount, in scope, verified payee —
evaluated concurrently, with the chain-agnostic credential read as one
of them, never the whole answer. Positioning, glossary, and measured
claims: [`docs/positioning.md`](docs/positioning.md).

## Quick start

```bash
pnpm install

# Mint an Agent ID on Pharos (default chain)
PRIVATE_KEY=0x... pnpm start -- issue --token-uri "ipfs://bafy.../meta"

# Read-only: does this agent hold a valid credential?
pnpm start -- verify --subject 0x... --capability "agent.commerce.escrow"

# Trust check before paying a stranger
MONID_API_KEY=monid_... PRIVATE_KEY=0x... \
  pnpm start -- trust check --counterparty 0x... \
    --intent "pay for premium RWA data" --amount "10 USD" \
    --capability data.premium

# Run the autonomous Steward loop (boot → reason → gate → act → record)
PRIVATE_KEY=0x... ZEROG_PRIVATE_KEY=0x... \
  pnpm start -- agent run --goal "open an escrow with counterparty X"
```

**Try the live gate:** <https://ligis.vercel.app/gate> — the same
decision service, exposed as a UI with measured verdict headers.

### Zecathon — Shielded Zcash Gate & Zero-Knowledge Credentials

> **Zecathon 2026 Submission:** Shielded Payments ($15,000) · Grand Prize ($20,000) · Cross-Chain ($15,000)  
> **Build Window:** Sep 28 – Oct 28, 2026 · 23:59 UTC  
> **Net-new Zcash code authored during the build window:** `packages/circuits-zcash/` (Noir UltraHonk circuit, Poseidon Merkle tree, verifier), `packages/core/src/zcash.ts` (ZIP-316 Bech32m/F4Jumble, lightwalletd client, Pallas ECDH note trial-decryption, 512B memo codec), and `web/app/zcash/` (guided 4-step privacy demo). Pre-existing EVM/Casper registries serve strictly as upstream libraries.

Before an agent releases shielded ZEC to a `utest1…` / `u1…` address, the payee proves in zero knowledge (Noir + Barretenberg UltraHonk, depth-16 Poseidon Merkle tree) that it holds an unexpired, unrevoked Ligis credential bound to its own Zcash address inside a steward-signed, on-chain-anchored `CredentialRegistry` root — without revealing its EVM/Casper wallet, which issuer vouched for it, or which leaf it owns.

```bash
# 1. Guided 4-step web demo (/zcash): no proof STOP → UltraHonk proof GO → replay STOP → revoked STOP
pnpm demo:zcash-web          # open http://localhost:3000/zcash (or visit https://ligis.vercel.app/zcash)

# 2. One-command CLI ZK gate demo (publish root → prove → GO → replay/redirect/revoke STOP)
pnpm demo:zcash-zk           # writes scripts/zcash-zk-demo.lastrun.txt

# 3. Viewing-key selective disclosure & live Zcash Testnet memo decryption demo
pnpm demo:zcash              # writes scripts/zcash-shielded-demo.lastrun.txt
```

See [`docs/zecathon-entry.md`](docs/zecathon-entry.md) for the circuit spec, Monad root-anchor transaction ([`0x91f64222...`](https://testnet.monadscan.com/tx/0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f), block `74058241`), live Zcash Testnet transaction ([`d2b389c8...`](https://fauzec.com/api/v1/status/testnet/01M5SKS8EGMJ3MK633ED1ZJ02P), block `4,540,356`), and honest risks.

## What this is

Ligis is a pre-payment decision service for AI agents. The wedge is the
gate; credentials, cross-chain portability, the Steward loop, CROO
distribution, and the OKX.AI listing are the moat that makes one of the
four signals — _verified payee_ — hold up under scrutiny. The full
positioning (what we say, what we don't, what the words mean) lives in
[`docs/positioning.md`](docs/positioning.md). This README is the
operational entry point — install, run, deploy.

### Jev intent layer — the gate has reflexes

The x402 Trust Gate annotates every decision (401/402/200) with a typed
GO/STOP intent verdict from **Jev** (TypeSafe's System One model — the AI
Gateway's free window ended 2026-09-25, so production runs the **direct** route
via `TYPESAFE_API_KEY`): scope consistency, amount plausibility, payee match,
and request normality — four questions, one parallel call, 75–160 ms on prod,
billed at ~$0.00005 per call. Fail-open: a missing model becomes `SKIPPED`,
never a silent GO.

```bash
# Terminal 1 — gate with the intent layer on
set -a; source .env.d/casper.env .env.d/typesafe.env; set +a
LIGIS_JEV_ENABLED=1 LIGIS_GATE_CREDENTIAL_TTL_MS=30000 pnpm x402:dev

# Terminal 2 — stress it
pnpm demo:jev
```

Every response carries `x-jev-verdict`, `x-jev-confidence`, `x-jev-flags`,
`x-jev-latency-ms`, `x-jev-cost-usd`. `/gate` renders the live telemetry
waterfall. Fail-open means an outage is invisible, so two checks exist — the
transport smoke test, and a watchdog that asks production's own gate whether
its provenance reports a `jev` line that answered
(`.github/workflows/jev-watchdog.yml`, daily 06:30 UTC):

```bash
set -a; source .env.d/typesafe.env; set +a
LIGIS_JEV_ENABLED=1 pnpm smoke:jev   # the route, from here
pnpm watchdog:jev                    # prod itself, no key needed
```

## Decisioning stack

When Jev is unavailable, the gate keeps serving payments and the verdict
silently becomes `SKIPPED`. Reasoning falls back to **0G Compute**
(default: Qwen 2.5 7B on Galileo) and, when that's also unavailable, to
the in-process `LocalReasoner` (keyword-matched, labeled
`model: "local-keyword-match"` in the deliverable). Prompts and model
identifiers are read from `@ligis/core` config — there is no separate
Runware endpoint in the live stack. See
[`AGENTS.md`](AGENTS.md) "0G Compute" for the ledger-top-up command
(Qwen 2.5 7B requires ≥ 1.0 OG in the provider's reserve before the first
call).

## Skills

| Skill               | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `ligis-issue`       | Mint an Agent ID NFT; issue an EIP-712 capability credential |
| `ligis-verify`      | Read-only: does a subject hold a valid credential?           |
| `ligis-revoke`      | Issuer revokes a credential (permanent)                      |
| `ligis-rotate`      | Move Agent ID to a new controller key (recovery)             |
| `ligis-hash`        | Helper: keccak256 a capability name                          |
| `ligis-sign`        | Helper: build + sign an EIP-712 credential off-chain         |
| `ligis trust check` | GO/STOP pre-payment decision for a counterparty              |
| `ligis agent run`   | Trust Steward: boot → reason → risk → gate → act → record    |

## Deployed contracts

First deployment is live on **Pharos Atlantic testnet** (chainId 688689):

| Contract             | Address                                      |
| -------------------- | -------------------------------------------- |
| `PharosAgentID`      | `0xbd163Be6882CF6DE54bA10d726F4f619Bdc28a89` |
| `CredentialRegistry` | `0x9E6eC93200E185c11423eb3A5150449D49d3473A` |

Casper Testnet: `AgentId` + `CredentialRegistry` + `GatedVault` —
deployed and smoke-tested. See [`docs/setup.md`](docs/setup.md) for the
deploy recipe.

## Chain support

Ligis is **chain-agnostic by design.** Every chain implements the same
`ChainAdapter` interface from `@ligis/core`; the Trust Steward, CLI, and
MCP server consume the interface, not the implementation.

| Chain                     | Adapter                             | Contracts                                                | Status                                                                                                              |
| ------------------------- | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Pharos Atlantic** (EVM) | `@ligis/adapter-evm`                | `packages/contracts-evm` (Solidity)                      | Live — deployed, tested, steward running                                                                            |
| **Casper Testnet**        | `@ligis/adapter-casper`             | `packages/contracts-casper` (Odra)                       | **Live** — contracts deployed, smoke test passing, web UI live                                                      |
| **Monad Testnet**         | `@ligis/adapter-evm`                | `packages/contracts-evm` (Solidity)                      | Live — passkey issuer demo, GateStates walk                                                                         |
| **Zcash Testnet**         | `@ligis/core` (`ZcashChainAdapter`) | `packages/circuits-zcash` (Noir + UltraHonk) + 512B memo | **Live** — `/zcash` guided demo, payee-bound ZK membership + nullifier, viewing-key disclosure (Zecathon Weeks 1–3) |

**Why this works across chains:**

- Capabilities are chain-neutral: `capabilityHash("kyc.basic")` produces
  the same `0x...32` on every chain because `@ligis/core` computes
  keccak256 off-chain and passes it to each adapter. The hash is the
  canonical id.
- Agent identity uses DIDs: `did:ligis:<chain-id>:<chain-native-id>`.
- EIP-712 domain separation is per-chain: the domain separator binds
  the chain name + contract package hash, so a credential signed for
  one chain cannot be replayed on another.
- The same secp256k1 key can sign credentials for both chains — the
  off-chain EIP-712 signature verifies against the same issuer address
  on either chain.

To bring up another chain: implement `ChainAdapter`, add the chain
branch to `getAdapter()` in the CLI and MCP server, and (optionally)
create `packages/contracts-<chain>`. See
[`MONOREPO_STRUCTURE.md`](MONOREPO_STRUCTURE.md) for the full
architecture.

## CROO Agent Protocol (CAP) integration

Ligis is listed as a callable agent on the [CROO Agent
Store](https://agent.croo.network). Before one agent pays another, it
can hire Ligis to run a **counterparty check** and receive a pass/warn/fail
verdict with a 0–100 risk score. The provider runs 24/7 in production
(`pm2`-managed), so judges only need a requester — no need to run a
provider yourself.

**Judge repro (CROO Hackathon):**

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm demo:croo
```

| Service         | Price | What you get                                                                                              | Input                                                                                                |
| --------------- | ----- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ligis.risk`    | $0.50 | Counterparty check — pass/warn/fail + 0–100 score                                                         | `{ subject, capabilities, issuer?, minTtlSeconds? }`                                                 |
| `ligis.verify`  | $0.25 | On-chain credential verification                                                                          | `{ subject, capability, issuer? }`                                                                   |
| `ligis.issue`   | $2.00 | Signed capability credential issuance — requires external evidence unless allowlisted                     | `{ subject, capability, expiresInSeconds?, externalAttestation? }`                                   |
| `ligis.gate`    | $0.25 | Payment check — Jev intent verdict (GO/STOP + confidence + flags) alongside the on-chain credential check | `{ subject, capability, priceSmallestUnit, payTo, payment?, issuer?, tokenSymbol?, tokenDecimals? }` |
| `ligis.qualify` | $2.50 | One order from not-credentialed to credentialed — check, issue, re-check, return both verdicts            | `{ subject, capabilities, evidence?, issuer?, minTtlSeconds?, expiresInSeconds? }`                   |

Pricing reflects the live CROO Dashboard; rates move with `services.ts`.
Phase 5 keeps `services.ts`, `croo-store-manifest.json`, and the CROO
Dashboard in lockstep.

All five services are live and tested end-to-end. **`ligis.qualify`
collapses the funnel into one order** — payment alone never mints
trust, every issuance is evidence-gated or allowlist-gated, and a refusal
is a structured deliverable (`{ issued: false, reason, detail }`), not
an error. See [`AGENTS.md`](AGENTS.md) "CROO Provider Deployment" for
the refusal shape and the `LIGIS_SELF_ISSUABLE_CAPABILITIES` semantics.

A `fail` verdict doesn't dead-end the buyer: `ligis.risk` returns a
`pathToTrust` block — missing capabilities, the recommended
one-order route (`ligis.qualify`, cheaper than risk + issue separately),
the fallback issuance route, and the chain the credential will land on.

See [`docs/croo-integration.md`](docs/croo-integration.md),
[`docs/okx-ai.md`](docs/okx-ai.md),
[`docs/attestation-integrations.md`](docs/attestation-integrations.md),
[`docs/strategy.md`](docs/strategy.md), and
[`packages/croo-adapter/`](packages/croo-adapter/).

## Proofs

See [`docs/proofs.md`](docs/proofs.md) for hackathon submissions, demo
videos, and the on-chain deployment evidence chain — the Ligis → venue →
outcome trail that backs every measured claim in
[`docs/positioning.md`](docs/positioning.md).

## Documentation

| Doc                                                              | What's in it                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Positioning](docs/positioning.md)                               | Source of truth: pitch, signals, glossary, claims, privacy, pricing                                           |
| [Strategy](docs/strategy.md)                                     | Product strategy, competitive landscape, differentiation, roadmap, business model                             |
| [Architecture](docs/architecture.md)                             | Contract design, module structure, repository layout                                                          |
| [Agent Arena](docs/agent-arena.md)                               | Vultr Agent Arena submission: `/arena` demo, judges, env vars, checklist                                      |
| [CROO Integration](docs/croo-integration.md)                     | CAP adapter, Agent Store listing, provider/requester usage                                                    |
| [OKX.AI Integration](docs/okx-ai.md)                             | ASP strategy, services, demo plan, and submission checklist                                                   |
| [Proofs](docs/proofs.md)                                         | Hackathon submissions, demo videos, on-chain deployment evidence                                              |
| [Attestation integrations](docs/attestation-integrations.md)     | Self Protocol and EAS provenance, privacy boundaries, and rollout                                             |
| [Zecathon entry](docs/zecathon-entry.md)                         | Zecathon submission: Shielded Payments track, viewing-key selective disclosure, ZK presentation, demo spec    |
| [Zcash shielded credentials](docs/zcash-shielded-credentials.md) | Additive primitive: shielded credential presentation, costs, risks, and architecture                          |
| [ZK reputation evidence](docs/zk-reputation-evidence.md)         | Research note: private, ZK-proven counterparty history as a second evidence mode — **not built, not claimed** |
| [Monorepo structure](MONOREPO_STRUCTURE.md)                      | Package layout, dependency graph, ChainAdapter interface, adding a new chain                                  |
| [API Reference](docs/api.md)                                     | Service schemas, input/output examples, capability names, chains                                              |
| [Archive](docs/archive/)                                         | Completed hackathon submissions + unpublished drafts                                                          |
| [Trust Steward Agent](docs/trust-steward-agent.md)               | The autonomous loop, 0G integration, build phases                                                             |
| [Security](docs/security.md)                                     | Non-custodial design, EIP-712 replay protection                                                               |
| [Setup](docs/setup.md)                                           | From-scratch install, env vars, 0G wallet, Casper wallet, x402 server, deploy, verify                         |
| [SKILL.md](SKILL.md)                                             | Director entry point for AI agents                                                                            |
| [References](references/)                                        | Per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability)                            |

## License

MIT — see [LICENSE](./LICENSE).

## Links

- **Web app:** [ligis.vercel.app](https://ligis.vercel.app) (live, chain-aware)
- **GitHub:** [github.com/sneldao/ligis](https://github.com/sneldao/ligis)
