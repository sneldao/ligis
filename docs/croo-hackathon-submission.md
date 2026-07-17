# Ligis — BUIDL Submission for the CROO Agent Hackathon 2026

> Copy/paste this into the DoraHacks BUIDL form for the
> **CROO Agent Hackathon**.
> Submission portal: https://dorahacks.io/hackathon/croo-hackathon/buidl

---

## Title

**Ligis** — Trust layer for agent-to-agent commerce on CROO

## Tagline (one-liner)

Don't pay another agent until Ligis proves it holds the on-chain credentials required for the job — callable on CROO via CAP, verified on Casper Testnet.

## Tracks

- [x] **Data & Verification Agents** (primary)
- [x] **Open – Any A2A Agents** (composability — other agents hire Ligis before releasing funds)

## Demo video (public, ≤ 5 min)

**MP4:** https://github.com/sneldao/ligis/releases/download/croo-hackathon-2026/ligis-croo-demo.mp4

The video shows:

1. Ligis listed on the [CROO Agent Store](https://agent.croo.network) with `ligis.risk`
2. Full CAP lifecycle: negotiate → pay USDC → deliver JSON verdict
3. On-chain proof: `CredentialRegistry.isCapable` read on **Casper Testnet** (same contracts as our Casper Buildathon submission)

Composition source: [`videos/ligis-croo-hackathon/`](../videos/ligis-croo-hackathon/)

## Repo

`https://github.com/sneldao/ligis`

Public. MIT licensed. CAP provider + requester in `packages/croo-adapter/`.

## Services on CROO Agent Store

| Service ID | Price | What it does |
|---|---|---|
| `ligis.risk` | $0.75 | Counterparty risk check — pass/warn/fail + 0–100 score |
| `ligis.verify` | $0.50 | On-chain credential verification — capable boolean + credential details |
| `ligis.issue` | $1.00 | Credential issuance — signs + submits on-chain credential to CredentialRegistry |

All three services are live and tested end-to-end. The full loop works:
issue → verify (`capable: true`) → risk check (`warn`, maturing to `pass`).

Manifest: [`packages/croo-adapter/croo-store-manifest.json`](../packages/croo-adapter/croo-store-manifest.json)

## Judge repro (60 seconds)

The Ligis provider runs 24/7 in production (`pm2`-managed), so judges only
need to run a requester — no provider terminal required:

```bash
git clone https://github.com/sneldao/ligis && cd ligis && pnpm install

# Hire Ligis as a requester (needs USDC on requester agent wallet) — hits the live provider
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a
pnpm demo:croo

# On-chain-only fallback (no CROO keys): direct Casper registry read
set -a && source .env.d/casper.env && set +a
pnpm demo:croo -- --on-chain-only
```

To run your own provider instance instead of hitting the live one:

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a
pnpm croo
```

> `set -a` / `set +a` is required around `source` — a plain `source
> file.env` only sets shell-local variables, not exported ones, so `pnpm
> croo` fails immediately with `Missing required environment variable:
> CROO_SDK_KEY` otherwise.

Unit tests: `pnpm -r --filter @ligis/croo-adapter run test`

## CAP / SDK methods used

| SDK method | Role |
|---|---|
| `AgentClient.connectWebSocket()` | Provider listens for negotiations |
| `acceptNegotiation()` | Provider accepts `ligis.*` orders |
| `deliverOrder()` | Provider delivers JSON verdict |
| `negotiateOrder()` | Requester hires Ligis |
| `payOrder()` | Requester pays USDC on Base |
| `getDelivery()` | Requester reads fulfillment |

## Why Ligis + Casper together

Ligis is **one product, two hackathon proofs**:

| Layer | Casper Buildathon | CROO Hackathon |
|---|---|---|
| **Identity** | `AgentId.mint_self` on Casper Testnet | Subject DID in CAP requirements |
| **Credentials** | EIP-712 `CredentialRegistry.issue` + on-chain secp256k1 recovery | `ligis.risk` reads the same registry |
| **Commerce** | x402 Trust Gate (credential + CSPR payment) | CAP hire flow (USDC on Base via CROO) |

The Casper contracts are the **source of truth**; CROO is how other agents **pay for verification** before commerce.

## Long-form description

### Problem

Agent-to-agent commerce on CROO breaks when a buyer agent cannot prove a seller agent holds the credentials it claims. Wallets are not identities. Prompts are not permissions.

### What we built

Ligis is a callable CAP provider on the CROO Agent Store. Before your agent releases funds, shares data, or relies on a counterparty, hire `ligis.risk` to:

1. Read `CredentialRegistry.isCapable` on Casper (or Pharos) for every required capability
2. Compute TTL-until-expiry and a 0–100 risk score across all of them
3. Return a structured pass/warn/fail verdict

### Differentiation

- **On-chain enforcement** — signatures recovered and issuers enforced by contract, not a server promise
- **Cross-chain credentials** — same `capabilityHash()` and issuer key on Casper and Pharos
- **Transparent risk scoring** — every verdict includes a breakdown of sub-scores and signals, not a black-box score
- **A2A composability** — DeFi, escrow, and research agents hire Ligis as a pre-payment dependency
- **Aggregation roadmap** — `ligis.issue` will bridge external verifiers (Self, World ID, EAS) into unified credentials, solving the chicken-and-egg problem by importing trust
- **Idempotent CAP delivery** — duplicate `OrderPaid` events do not double-deliver; retry with exponential backoff

### Integration notes

- Provider: `packages/croo-adapter/src/provider.ts`
- Requester SDK: `packages/croo-adapter/src/requester.ts`
- Store listing: `packages/croo-adapter/croo-store-manifest.json`
- Docs: [`docs/croo-integration.md`](croo-integration.md)

## Links

- Web UI: https://ligis.vercel.app (`?chain=casper-testnet`)
- Casper demo video: https://github.com/sneldao/ligis/releases/tag/buildathon-2026
- Agent Store: https://agent.croo.network
