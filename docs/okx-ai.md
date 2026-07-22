# OKX.AI Agent Service Provider (ASP) Integration

> Ligis as the counterparty risk oracle for the OKX.AI agent economy.
> Same credentials as CROO; new marketplace distribution.

## The opportunity

[OKX.AI](https://www.okx.ai) is building an agent-native platform where users
discover and hire AI-powered services from Agent Service Providers (ASPs).
The OKX.AI Genesis Hackathon onboards the first wave of high-quality ASPs.

Ligis fits OKX.AI as **foundational trust infrastructure**, not as a
specialised trading agent. Before an OKX DeFi agent delegates capital to a
Yield agent, or before a user lets an Trading agent act on their behalf, the
hiring agent can call Ligis to answer one question: _is this counterparty
safe to transact with?_

We are **not** submitting to the TxLINE sports/betting track. TxLINE asks for
agents that consume real-time sports odds and execute betting strategies.
That is a data-strategy track, far from Ligis's identity-and-credentials core.
Instead, Ligis registers as a **general ASP** offering verification,
risk scoring, and credential issuance to every other agent on OKX.AI.

## Why Ligis wins on OKX.AI

1. **Real problem.** OKX.AI agents will hire each other for high-value tasks.
   Without trust infrastructure, every hire is blind.
2. **Reusable stack.** The same `ChainAdapter`, risk model, and credential
   registry that power the CROO provider power the OKX.AI provider.
3. **Cross-marketplace network effect.** A credential issued via CROO is
   verifiable on OKX.AI, and vice versa. Ligis becomes the universal trust
   layer, not a single-marketplace feature.
4. **Defensible moat.** OKX.AI could build native reputation, but it will not
   aggregate Self Protocol, World ID, EAS, wallet history, and Casper/Pharos
   tenure into one neutral credential. Ligis does.

## ASP services offered

Mirror the CROO CAP services, adapted to OKX.AI naming:

| Service ID         | Price | What it proves                           | On-chain action                                 | Deliverable                                                                                                      |
| ------------------ | ----- | ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `okx.ligis.risk`   | $0.75 | Counterparty risk check                  | `CredentialRegistry.isCapable` read(s)          | `{ overallVerdict, riskScore, checks, summary, breakdown, signals, checkedAt }`                                  |
| `okx.ligis.verify` | $0.50 | On-chain credential verification         | `CredentialRegistry.isCapable` read             | `{ service, capable, subject, capability, capabilityHash, latestCredential, checkedAt }`                         |
| `okx.ligis.issue`  | $1.00 | Credential issuance; optional EAS import | EAS read, then `CredentialRegistry.issue` write | `{ service, subject, capability, capabilityHash, issuer, issuedAt, expiresAt, txHash, submittedAt, provenance }` |

Pricing mirrors CROO. OKX.AI may take its own fee on top; we will adjust
once the ASP fee schedule is public.

## Architecture

```
OKX Requester Agent          OKX.AI ASP Matrix              Ligis Provider
    │                                │                         @ligis/okx-adapter
    ├─ requestTask(okx.ligis.risk)─┤
    │                                ├─ pushTaskEvent() ───────►
    │                                │                           verifyCapability()
    │◄──────── deliverResult() ──────┼─ submitResult() ◄────── compute risk score
```

The OKX adapter reuses the same backend as the CROO adapter:

- `@ligis/core` — chain-neutral credentials, hashing, DIDs
- `@ligis/adapter-casper` / `@ligis/adapter-evm` — on-chain reads/writes
- `@ligis/agent-logic` — risk scoring model

Only the transport layer changes: OKX.AI SDK instead of CROO CAP SDK.

## Technical integration path

1. **Register Ligis as an ASP** on the OKX.AI developer platform.
2. **Define service schemas** for `okx.ligis.risk`, `okx.ligis.verify`,
   and `okx.ligis.issue`.
3. **Create `packages/okx-adapter/`** following the `@ligis/croo-adapter`
   pattern:
   - `provider.ts` — listen for OKX task events, dispatch to ChainAdapter
   - `requester.ts` — helper for OKX agents to hire Ligis
   - `manifest.json` — ASP listing manifest
4. **Run the provider** 24/7 (same PM2 convention as CROO).
5. **Demo** the end-to-end flow: OKX agent → hires Ligis → gets verdict →
   executes transaction only after `pass`.

## 90-second demo script

| Time      | Beat                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | **Problem.** An OKX DeFi agent wants to delegate funds to a Yield agent. "How do we know it won't rug?"                                                                          |
| 0:15–0:40 | **Risk check.** The DeFi agent hires `okx.ligis.risk`. Ligis reads the Yield agent's credentials on Casper/Pharos and returns `fail` (score 12) because it lacks `defi.audited`. |
| 0:40–1:05 | **Issuance.** The Yield agent pays for `okx.ligis.issue`, submits an audit attestation, and Ligis mints the credential on-chain.                                                 |
| 1:05–1:30 | **Resolution.** The DeFi agent re-runs the risk check. Score is now `pass` (95). The transaction executes safely.                                                                |

## Submission plan (OKX.AI Genesis)

- [ ] Register Ligis ASP on OKX.AI developer portal
- [ ] Submit service schemas and pass internal OKX review
- [ ] Deploy `packages/okx-adapter` provider to production infrastructure
- [ ] Record 90-second demo video showing OKX agent → Ligis → on-chain proof
- [ ] Post on X with `#OKXAI` linking the demo and repo
- [ ] Ensure public repo, working endpoint, and brief technical docs are ready

## Why this is on-mission

This submission advances Ligis's core monopoly: **portable trust for agent
commerce**. CROO proves the model in one marketplace; OKX.AI proves it
scales to another. The credential is the same. The risk model is the same.
Only the distribution channel changes.

## Risks and mitigations

| Risk                                      | Mitigation                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OKX.AI builds native reputation           | Emphasise cross-chain, multi-platform aggregation that OKX cannot replicate quickly               |
| OKX.AI settlement API is slow or unstable | Implement strict timeouts and idempotency (SQLite ledger, same as CROO provider)                  |
| Low initial OKX agent volume              | Treat as strategic positioning; credentials and provider code are reusable for other marketplaces |
| ASP review rejects Ligis                  | Position as general infrastructure, not a narrow trading tool; highlight live CROO track record   |

## 0G Bridge by AKINDO: a better-aligned accelerator

While OKX.AI Genesis is a valuable distribution channel, the **0G Bridge by
AKINDO** is an even stronger strategic fit for Ligis. Ligis already uses
0G Compute for the Trust Steward's reasoning step and 0G Storage for
evidence manifests. The 0G Bridge provides a structured 10-week path to
add **0G Chain** as the third 0G pillar.

### Why 0G Bridge comes first

| Factor                   | OKX.AI Genesis           | 0G Bridge by AKINDO                        |
| ------------------------ | ------------------------ | ------------------------------------------ |
| **Core alignment**       | Medium (general ASP)     | Very high (Trust & Safety / AI Agents)     |
| **Existing integration** | None                     | 0G Compute + Storage already live          |
| **New engineering**      | OKX SDK adapter          | 0G Chain adapter (EVM-compatible)          |
| **Time horizon**         | 1–2 weeks                | 10 weeks, wave-by-wave                     |
| **Rewards**              | Prizes TBD               | Up to $50k 0G credits + Token2049 Demo Day |
| **Strategic value**      | Marketplace distribution | Ecosystem + infrastructure + distribution  |

### 10-week wave plan

| Wave       | Focus                 | Deliverable                                                                        |
| ---------- | --------------------- | ---------------------------------------------------------------------------------- |
| **Wave 1** | 0G Chain deployment   | `PharosAgentID` + `CredentialRegistry` on 0G Chain; `@ligis/adapter-0g` scaffolded |
| **Wave 2** | Steward on 0G         | Full boot→reason→gate→act→record loop on 0G Chain                                  |
| **Wave 3** | Marketplace traction  | CROO risk checks read from 0G Chain; real transaction volume                       |
| **Wave 4** | External attestations | EAS/Self Protocol provenance verified inside 0G Compute TEE                        |
| **Wave 5** | Demo Day              | Token2049 pitch: cross-marketplace trust gated by 0G                               |

### Relationship to OKX.AI

The 0G Bridge and OKX.AI are **complementary**, not competing:

- **0G Bridge** provides the _infrastructure_ (0G Chain, Compute, Storage).
- **OKX.AI** provides _distribution_ (Agent Service Provider marketplace).
- A credential issued on 0G Chain during the Bridge program is
  verifiable by OKX.AI agents, and vice versa.

Ligis should pursue **both**, but prioritise the 0G Bridge for the
10-week accelerator because it is the highest-leverage next step.

## See also

- [`docs/croo-integration.md`](croo-integration.md) — the CROO integration that OKX mirrors
- [`docs/strategy.md`](strategy.md) — roadmap, 0G Bridge plan, and business model
- [`packages/croo-adapter/`](../packages/croo-adapter/) — reference implementation
