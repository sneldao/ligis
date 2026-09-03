# Ligis — Monid "We Kill" Hackathon 2026 Submission Plan

> **Hackathon**: Monid "We Kill" — Sep 1 to Sep 10, 2026
> **Guide**: https://hacks.monid.ai/guide.html
> **Registration**: https://docs.google.com/forms/d/e/1FAIpQLSfsKR6v65DEWKdANmVHzt2978xzaMjAYl5RTV-v6B0d7eujCw/view
> **Status**: plan — code and video to be built inside the submission window

---

## Title

**Ligis** — Trust gate that kills the payments-risk dashboard

## Tagline (one-liner)

My agent checks a stranger's credentials before it pays — replacing the manual risk review step with a measured, agent-native GO/STOP call.

## What we are killing

A **payments-risk / counterparty-KYC SaaS workflow** that agents cannot use today because it is built for human analysts: login, dashboard, per-seat pricing, manual review.

**Primary target workflow**: the "go/no-go pre-clearance" before releasing funds to a new counterparty.

**Chosen target**: **Persona Essential**.  
Backup: **Stripe Identity** if Persona's pricing changes before the deadline.

| Product | Published plan / price | Workflow we replace |
|---|---|---|
| **Persona** (chosen) | Essential: $250/mo (12-month minimum), 500 verifications/reports included, $1.50 per additional verification. Sources: https://withpersona.com/pricing, https://help.withpersona.com/articles/6oZbzp7jb7AWGClF5vpY3K/ | KYC-style credential pre-clearance on a new counterparty |
| Stripe Identity | First 50 verifications free, then ~$1.50 per document+selfie verification. Source: https://stripe.com/pricing | Same as above — backup only |

**Action item before submission**: screenshot the Persona pricing page at the time of filming, in case the price changes.

## Why this fits Monid

- The workflow is **currently human-first**: a compliance person opens a dashboard, runs a check, then tells the payments team "release" or "hold."
- Agents cannot buy a seat. They cannot click a dashboard. The product is priced for human teams.
- Ligis turns that same signal into an **agent-native GO/STOP step** in front of an x402 payment.
- Monid is the discovery + metering layer: the agent asks `monid discover` which risk/identity endpoints exist, calls the cheapest one, and the per-call cost is measured by Monid.

## The kill in 60–90 seconds

### 5-second hook

"I killed Persona's $250-a-month identity dashboard — and its $1.50 per verification fee. This is my agent deciding whether to pay a stranger."

### Storyboard

| Time | Shot / text | Audio |
|---|---|---|
| 0–5s | Black screen + big text: "What died: Persona's $250/mo + $1.50/verification identity dashboard." | "I killed Persona's $250-a-month dashboard." |
| 5–15s | Before: screen recording of a human logging into a SaaS, clicking through a counterparty check. | "Before, a human had to log in, run a check, and tell the payment system to release." |
| 15–30s | Agent wants to pay a stranger. Terminal: `monid discover` runs, returns risk/identity endpoints. | "Now my agent asks Monid what's available." |
| 30–55s | Trust Steward runs: `boot -> reason -> gate -> act -> record`. On-chain credentials checked on Casper / Pharos. Then `GET /premium` returns `402 Payment Required` or `200 OK` with data. | "Ligis checks credentials on-chain, then the payment gate says GO or STOP." |
| 55–70s | Receipt on screen: Persona $250/mo + $1.50/verification vs. $0.0X Monid call. | "Persona wanted $250 a month plus $1.50 a check. This call cost $0.0X, measured." |
| 70–80s | CTA + repo URL + `#monid`. | "Link in bio." |

**Captions mandatory** (auto-caption in CapCut, centered, bold, fix product names). Export 1080p or higher.

## Live flow we will build

```
AI agent wants to pay a stranger
        │
        ▼
  monid discover --for "counterparty risk"
        │
        ▼
  choose cheapest live endpoint (e.g., public address history + issuer reputation)
        │
        ▼
  call endpoint through Monid, get raw signal
        │
        ▼
  Ligis Trust Steward: boot → reason → gate
  ├─ mint/identify agent
  ├─ check CredentialRegistry.isCapable on Casper / Pharos
  └─ combine Monid signal + on-chain credentials
        │
        ▼
  GO   → proceed to x402 payment → GET /premium returns 200 + payload
  STOP → 401 / 402 with reason → no payment
        │
        ▼
  Receipt: per-call cost from Monid + on-chain tx cost
```

## Monid integration points

We will add `packages/monid-adapter` or extend `packages/agent-logic` with a `MonidRiskResolver`.

| Step | Monid capability | What it gives us |
|---|---|---|
| 1. Discovery | `monid discover` for `risk`, `identity`, `kyc` | Live endpoints we can call without writing scrapers or reading API docs |
| 2. Orchestration | `monid use <endpoint>` or MCP server call | One measured call per counterparty check |
| 3. Cost readout | `monid spend` or dashboard | The real per-call number for the receipt |

**What we get from Monid that we cannot get elsewhere**: an agent-native metering and discovery layer for the off-chain risk signal. Without it, we would be hand-integrating one API or scraping one site.

## Tech to reuse from existing repo

- `packages/adapter-casper` / `packages/adapter-evm` for `CredentialRegistry` reads
- `packages/x402-server` for the GO/STOP payment gate
- `packages/croo-adapter` provider for the per-call risk service pattern
- `packages/agent-logic` for the `boot → reason → gate → act → record` loop
- `scripts/casper-e2e-demo.ts` as the base for the judge repro

## Measured cost (to fill in after running)

| Cost item | How measured | Expected / actual |
|---|---|---|
| Incumbent SaaS monthly price | Screenshot of public pricing page | $250/mo (Persona Essential, 12-month minimum) |
| Incumbent per-check price | Screenshot or docs | $1.50 per additional verification |
| Monid per-call cost | `monid spend` or dashboard after 5 runs | $0.0X — **run and insert** |
| On-chain gas (Casper Testnet) | `cspr.live` tx cost | negligible testnet CSPR |

**Submission form will ask for the real measured cost, including failed runs. We must run at least 5 end-to-end attempts and average them.**

## Judge repro

```bash
git clone https://github.com/sneldao/ligis && cd ligis && pnpm install

# Configure environment
cp .env.d/monid.env.example .env.d/monid.env
# edit .env.d/monid.env: set MONID_API_KEY and MONID_COUNTERPARTY

set -a && source .env.d/casper.env && source .env.d/monid.env && set +a

pnpm demo:monid
```

The CLI will:

1. **Discover** — call `POST /v1/discover` with the counterparty address.
2. **Inspect + run** — pick the cheapest endpoint, inspect its input schema, run it, and poll `GET /v1/runs/:runId` for the result.
3. **Boot + reason** — mint the agent and map the goal to required capabilities.
4. **Gate** — combine on-chain `CredentialRegistry.isCapable` with the Monid risk score.
5. **Emit** — print the JSON result, including `gated`, `risk.score`, `risk.level`, and `risk.costUsd`.

The receipt is a side-by-side of Persona $1.50/verification vs. the actual Monid call cost.

## Implementation status

Shipped in this branch:

- `packages/agent-logic/src/monid.ts` — `MonidClient` and `CounterpartyRiskResolver` wrapping `discover`, `inspect`, `run`, and `GET /v1/runs/:runId` polling.
- `packages/agent-logic/src/steward.ts` — `TrustSteward` now runs a `RISK` step between `REASON` and `GATE` when `--counterparty` is provided. Final `gated` is `capabilities_ok && risk_ok`.
- `packages/core/src/evidence.ts` — `EvidenceManifest` stores `counterparty` and the `risk` signal.
- `packages/cli/src/index.ts` — `ligis agent run` supports `--counterparty <addr>` and `--risk-threshold <n>`, auto-loading `MONID_API_KEY`.
- `package.json` — `pnpm demo:monid` script and `.env.d/monid.env.example` template.
- `pnpm build` passes for the full workspace.

## Holistic trust roadmap (post-hackathon)

The immediate Monid integration wires a counterparty risk call into the Steward loop. Long-term the product becomes one trust surface instead of scattered demos.

### North star

One operational intent: **trust a counterparty before a payment is released.**

### Unified model

Introduce in `@ligis/core`:

- `TrustSignal` — a provider-agnostic risk/capability/identity/policy signal.
- `TrustDecision` — the final `go` / `stop` verdict plus signals, receipt, and expiry.
- `RiskProvider` interface — Monid is the first implementation; CROO, Chainalysis, and local heuristics plug in the same way.

`TrustSteward` orchestrates `boot → reason → risk → gate → act → record` and returns a `TrustDecision` with an embedded `EvidenceManifest`.

### Product surface: `/trust`

Instead of adding `/monid`, `/receipt`, `/risk`, collapse operational UX into one route:

- **Composer**: counterparty, intent, amount, capability, risk-provider.
- **Signal stack**: ledger of risk, credential, and policy signals.
- **Verdict**: `GO` / `STOP`.
- **Receipt**: anchored manifest + side-by-side cost comparison (Persona vs. Monid).

### New design primitives

Extend `DESIGN.md` with three primitives composed from the existing system:

| Primitive | Role |
|---|---|
| `TrustComposer` | One form for the trust intent. |
| `SignalStack` | `Rule`-delimited signal ledger. |
| `TrustReceipt` | Final ledger with decision, cost, savings, anchor hash. |

No cards, no dashboards, no new shadow/gradient vocabulary.

### Phases

1. **Core trust model** — add `TrustSignal` / `TrustDecision` / `RiskProvider` to `@ligis/core`, refactor `TrustSteward` and `EvidenceManifest`.
2. **CLI trust flow** — canonical `ligis trust check` command with `--counterparty`, `--intent`, `--amount`, `--risk-provider`; `ligis agent run` becomes an alias; output a human + JSON `TrustReceipt`.
3. **Web trust composer** — `/app/trust/page.tsx` and `/api/trust` streaming; reuse `GateVerdict`, `Rule`, `AddressDisplay`, `ChainBadge`.
4. **Operational layer** — `/agents`, `/ledger`, `/settings` as ledger rows, not dashboards: active agents, decision history, policy thresholds.
5. **Ecosystem wiring** — `x402-server` consumes `TrustDecision` before serving paid resources; MCP exposes `trust_check`; CROO provider registers `ligis.risk`.

This keeps the existing `/steward` as a narrative demo and `/gate` as a focused capability check, while `/trust` becomes the primary product CTA.

## Honest scoping (for the submission form)

- **What we killed**: the manual pre-payment KYC / credential pre-clearance step inside a Persona-style identity dashboard — specifically the $1.50 per-verification decision before releasing funds.
- **What we did not kill**: full KYC adjudication, legal compliance, dispute resolution, or the underlying regulated service. Those remain with the incumbent.
- **Network scope**: live on Casper Testnet and Pharos Atlantic Testnet. Mainnet is not in scope.
- **Data source scope**: the off-chain signal comes from whatever public/verified APIs Monid discovers for the chosen workflow; we are not building a new risk database.

## Submission checklist

- [ ] Target SaaS chosen (Persona) and current public price verified + screenshot
- [ ] `monid` integration added to the agent loop
- [ ] End-to-end runs on live data, not mock data
- [ ] `monid discover` / actual call visible in the demo video
- [ ] Real measured per-call cost from Monid, including failed runs
- [ ] Demo video 60–90s, 1080p, captioned, receipt on screen
- [ ] `#monid` in every social post and post URLs registered within 24 hours
- [ ] Repo public with commits inside the submission window

## Links

- Monid guide: https://hacks.monid.ai/guide.html
- Monid rules / points: https://hacks.monid.ai/index.html#rules
- Monid Discord: https://discord.gg/rQzztcgJV8
- Ligis repo: https://github.com/sneldao/ligis
