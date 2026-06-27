# Ligis @ Casper Agentic Buildathon 2026 — Submission Plan

> **Window**: today (Jun 25) → Jun 30 qualification deadline → Jul 6-19 finals.
> **Track**: Casper Innovation Track. **Goal**: meet the technical eligibility
> bar (working prototype on Casper Testnet with a transaction-producing
> on-chain component) and tell the strongest possible story for the jury.

## The product

**Ligis Trust Gate** — a credential-gated x402 service where AI agents must
hold a valid Ligis capability credential on Casper to pay for and access a
paid HTTP endpoint.

This composes the three pillars of the Casper AI Toolkit into one product:

| Pillar           | Role in Ligis Trust Gate                                        |
| ---------------- | --------------------------------------------------------------- |
| **Agent ID**     | Each agent has a Casper-native `AgentId` (Odra contract).       |
| **Credentials**  | Capabilities are signed EIP-712 credentials in the Odra registry. |
| **x402**         | The service requires payment + a valid credential per request.  |
| **MCP**          | The MCP server exposes the gate as a discoverable agent tool.   |
| **0G Compute**   | The Trust Steward decides which credentials to self-issue.      |
| **0G Storage**   | Decisions are persisted as verifiable evidence manifests.       |

The narrative: **portable trust across chains, with Casper as the trust
layer for the agent economy.** The demo leads with the credential layer
(the novel part) — the same `(issuer, subject, capability)` recognized
across Pharos and Casper because `capabilityHash` is chain-neutral — and
x402 is one consumption of that trust, not the headline.

## What's transaction-producing on Casper

The qualification rule requires at least one transaction-producing on-chain
component. Ligis Trust Gate produces multiple transaction types on Casper
Testnet:

1. **`AgentId.mint_self`** — boot a new agent identity.
2. **`CredentialRegistry.issue`** — Steward self-issues a capability credential.
3. **`CredentialRegistry.revoke`** — issuer revokes a misbehaving agent.
4. **`AgentId.set_token_uri`** — Steward anchors a 0G evidence root hash.
5. **CEP-18 `transfer_with_authorization`** — x402 payment settled by the
   Casper x402 Facilitator (each paid request is its own on-chain TX).

The first four are Ligis-native (`packages/contracts-casper`). The fifth
reuses the existing Casper x402 Facilitator + CEP-18 token contract — we
don't reimplement x402, we consume it.

**Fallback for on-chain proof if the facilitator is down**: the Steward
loop already produces 3+ on-chain transactions per run
(`CredentialRegistry.issue`, `AgentId.setTokenURI`, plus the agentId
mint). These Ligis-native txs are the qualification floor — the x402
payment is the cherry on top, not the only on-chain activity. We do NOT
mock settlement; if the facilitator is down, we show the Ligis-native
txs as the on-chain proof and note the x402 path is wired but pending
the facilitator coming back online.

## End-to-end flow

```
┌──────────┐  goal: "fetch premium data"  ┌──────────────────┐
│ AI agent │ ───────────────────────────▶ │ Trust Steward    │
│ (Claude, │                              │ (agent-logic)    │
│  Codex)  │                              └────────┬─────────┘
└──────────┘                                       │
     ▲                                             │ 1. reason (0G Compute)
     │                                             │ 2. gate: is agent capable
     │                                             │    of data.premium on Casper?
     │                                             │ 3. if not, self-issue via
     │                                             │    CasperAdapter.signCredential
     │                                             │    + submitCredential
     │                                             ▼
     │                              ┌────────────────────────────┐
     │                              │ Casper Testnet             │
     │                              │  - CredentialRegistry      │
     │                              │  - AgentId                 │
     │                              │  - CEP-18 (x402 token)     │
     │                              └────────────┬───────────────┘
     │                                           │
     │      ┌────────────────────────────────────┘
     │      │
     │      ▼                          ┌─────────────────────────┐
     │  4. GET /premium  ────────────▶ │ Resource Server         │
     │                                 │   - reads Ligis cred    │
     │                                 │     from Casper         │
     │                                 │   - if no cred: 401     │
     │                                 │   - if cred + no pay:   │
     │                                 │     HTTP 402 + price    │
     │                                 └──────────┬──────────────┘
     │                                            │
     │      5. signed x402 authorization          │
     │      ◀─────────────────────────────────────┘
     │      6. resubmit with X-PAYMENT
     │
     └── 7. 200 OK + payload, payment settled on Casper, evidence anchored to 0G
```

## Contract surface (Odra)

In `packages/contracts-casper/src/`:

- `agent_id.rs` — `mint_self`, `mint`, `rotate`, `set_token_uri`, reads
- `credential_registry.rs` — `issue`, `revoke`, `is_capable`, `is_capable_from_issuer`, `issuer_nonce_of`, `latest_credential`

These mirror `PharosAgentID.sol` and `CredentialRegistry.sol` 1:1, with one
critical invariant: **`capabilityHash("kyc.basic")` produces the same 32-byte
hash on both chains**. That's the load-bearing fact that makes "same
credential, two chains" credible to the jury.

## Resource server (the x402 endpoint)

A new package — `packages/x402-server` — implementing:

1. HTTP server with one endpoint, `GET /premium`.
2. Auth check: read `subject` from `X-Subject` header (or x402 `payer`),
   call `CasperAdapter.verifyCapability({ subject, capability: "data.premium" })`.
3. If `capable === false` → `HTTP 401` with a hint: "request capability
   credential first".
4. If `capable === true` and no payment → `HTTP 402` with x402 payment
   requirements (network: `casper:casper-test`, token: CEP-18 address,
   amount: e.g. 1 CSPR).
5. On valid `X-PAYMENT` header → forward to the Casper x402 Facilitator, settle
   on-chain, return `200` with payload.

The Facilitator code we **don't** write — it's the canonical
`make-software/casper-x402` deployment. We point at it.

## What the Steward changes

`packages/agent-logic/src/steward.ts` already takes a `ChainAdapter`. One
addition for the buildathon:

- **x402 awareness**: the capability `agent.commerce.x402` is already in
  `policy.ts`. The Steward self-issues this on Casper before any paid
  call. The Day 3 demo must self-issue **both** `data.premium` **and**
  `agent.commerce.x402` — the gate reads `data.premium`, but the agent
  needs `agent.commerce.x402` to authorize the x402 payment flow.

**Multi-chain `adapter | adapter[]` is cut from the qualification push.**
Single-chain Casper for the demo. The architecture remains compatible
(the `ChainAdapter` interface is unchanged), but the array form, the
gating decision (OR-of-chains vs. ALL-of-chains), and the multi-chain
evidence manifest schema are Final Round work. Keeping the loop
single-adapter for now avoids the riskiest item in the plan.

## Repo layout (current state)

```
packages/
├── core/                Chain-neutral (done)
├── adapter-evm/         Pharos (done)
├── adapter-casper/      Casper — all 8 ops implemented (casper-js-sdk), signer + deploy scripts
├── zerog/               0G Compute/Storage (done)
├── agent-logic/         Trust Steward (chain-agnostic, done) + LocalReasoner fallback
├── cli/                 + --chain casper (wired) + 0G Compute fallback
├── mcp-server/          + chain="casper" (wired)
├── contracts-evm/       Solidity (done)
├── contracts-casper/    Odra — builds + tests pass, WASM in wasm/ (AgentId.wasm, CredentialRegistry.wasm)
└── x402-server/         /premium endpoint, 402 response, EIP-712 client, local + facilitator settlement
scripts/
├── casper-e2e-demo.ts   Full steward loop with rich console output
├── casper-x402-demo.ts  Full x402 payment flow (402→sign→pay→200 + RWA data)
└── casper-smoke-test.ts Credential lifecycle test (mint→sign→submit→verify→revoke)
web/
├── lib/steward-casper.ts  Casper-specific steward loop (same event protocol)
├── app/steward/page.tsx   Chain-aware (Casper + Pharos goals, CLI snippets)
└── components/StewardRunner.tsx  Passes chain param to API
```

## Roadmap (5 days, day-by-day)

### Day 1 — TODAY (Jun 25)
- [x] Scaffold `adapter-casper`, `contracts-casper`, CLI/MCP wiring, docs.
- [x] `x402-server` scaffolded (pulled forward from Day 4).
- [x] Multi-chain UI shell on home page (ChainSelector + getChain).
- [x] Workspace builds end-to-end (all 8 TS packages + web).
- [x] Install Rust toolchain, `cargo-odra`, `just`.
- [x] `cargo odra build` succeeds locally — `AgentId.wasm` + `CredentialRegistry.wasm` generated.
- [x] `cargo odra test` passes (in-memory Odra test env).
- [x] Create **three** Casper Testnet wallets via `pnpm setup:casper` (deployer, agent, issuer).
      Faucet funding + transfers pending manual step.
- [x] Implement all 8 `CasperAdapter` operations (casper-js-sdk):
      `getAgentId`, `issueAgentId`, `rotateAgentId`, `verifyCapability`,
      `signCredential`, `submitCredential`, `revokeCredential`, `anchorEvidence`.
- [x] `signer.ts` — secp256k1 key loading (PEM/hex), TransactionV1 building + signing.
- [x] `deploy.ts` — WASM install script (`pnpm deploy:casper`).
- [x] Chain-awareness propagated to all web pages (agent, issuers, capabilities,
      steward, embed, embed/verify) — `?chain=casper-testnet` shows preview.

### Day 2 (Jun 26)
- [x] Fund deployer wallet from faucet, transfer CSPR to agent + issuer.
- [x] `pnpm deploy:casper` — install WASM contracts to Casper Testnet.
      Record package hashes in `.env.d/casper.env`.
- [x] First Casper transaction: `pnpm start -- --chain casper issue` (mint an AgentId).
- [x] Verify on cspr.live explorer.

### Day 3 (Jun 27)
- [x] Smoke test passes end-to-end on Casper Testnet:
  `npx tsx scripts/casper-smoke-test.ts`
  - mint_self → sign credential → submit on-chain → verify → revoke → verify revoked
- [x] `signCredential` + `submitCredential` produce valid on-chain credentials.
- [x] `verifyCapability` reads them back correctly via Odra dictionary queries.
- [x] `CASPER_TESTNET.live` flipped to `true` in `web/lib/network.ts`.

### Day 4 (Jun 28)
- [x] Wire `x402-server` credential check + 402 + payment settlement.
  - x402 v2 protocol implemented (PaymentRequirements, X-PAYMENT header).
  - EIP-712 `TransferWithAuthorization` signing via `@casper-ecosystem/casper-eip-712`.
  - Two settlement modes: `local` (direct CSPR transfer) and `facilitator`
    (CSPR.cloud x402 facilitator with CEP-18 `transfer_with_authorization`).
  - `casper-x402-demo.ts` runs the full 402→sign→pay→200 flow with RWA data.
- [x] Local settlement mode works end-to-end (on-chain CSPR transfer).
- [x] Facilitator mode wired to `https://x402-facilitator.cspr.cloud` (requires
  `CSPR_CLOUD_TOKEN` for production use).

### Day 5 (Jun 29)
- [x] End-to-end demo run: agent → Steward → Casper credential → x402 paid
  call → 0G evidence anchor.
  - `scripts/casper-e2e-demo.ts` — rich console output, 3-4 on-chain txs.
  - `scripts/casper-x402-demo.ts` — full x402 payment flow with RWA data.
- [x] LocalReasoner fallback when 0G Compute is unavailable.
- [x] Web UI: Casper steward loop wired (`web/lib/steward-casper.ts`).
  - Chain-aware steward page (`?chain=casper-testnet`).
  - StewardRunner passes chain to API; API dispatches to Casper loop.
- [x] Policy prompt enhanced with DeFi/RWA context.
- [x] Premium payload: realistic RWA oracle data (4 properties, yields, LTV).
- [x] README polished with Casper-first framing + demo commands.

### Day 6 (Jun 30) — recording + buffer
- [ ] **Morning**: record + edit demo video (3–5 minutes). Budget 4–8 hours
      for a non-pro recording + edit.
- [ ] **Afternoon**: buffer for whatever broke on Day 5. Do not commit new
      features here.
- [ ] Submit to DoraHacks before deadline.

## Demo video storyboard (5 minutes)

| Minute | Beat                                                                |
| ------ | ------------------------------------------------------------------- |
| 0:00   | The problem: agents have wallets and brains but no portable trust.  |
| 0:30   | Ligis: portable agent identity + verifiable capabilities + Steward. |
| 1:00   | The load-bearing fact: `capabilityHash("kyc.basic")` is the same    |
|        | 32 bytes on Pharos and Casper. Show the code.                       |
| 1:30   | Demo: agent boots on Casper Testnet (live tx on cspr.live).         |
| 2:00   | Demo: Steward self-issues `data.premium` + `agent.commerce.x402`    |
|        | credentials on Casper (live txs).                                    |
| 2:30   | Demo: agent hits paid endpoint — 402 + x402 payment settles on      |
|        | Casper (live tx). Payload returned.                                  |
| 3:30   | Show the 0G evidence manifest with all tx hashes anchored.          |
| 4:00   | The cross-chain pitch: same credential, two chains, one hash.       |
| 4:30   | Vision: Casper as the trust layer for the agent economy.            |

## Risks + mitigations

| Risk                                                          | Mitigation                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Odra toolchain issues.                                        | **Resolved** — contracts built, deployed, and smoke-tested on Casper Testnet.             |
| Casper 2.0 `TransactionV1` `is_install_upgrade` not recognized. | **Resolved** — use legacy `put-deploy` format for contract installation and stored contract calls. TransactionV1's `is_install_upgrade` flag is rejected by the testnet node with `NotAllowedToAddContractVersion [48]`. |
| Casper Testnet faucet rate limits (single-use per account).   | **Resolved** — deployer funded via Casper Wallet faucet. Failed deployments with `standardPayment=false` only cost actual gas consumed. |
| Odra dictionary storage key computation.                      | **Resolved** — `verifyCapability` and `signCredential` correctly compute `blake2b(index_bytes ++ mapping_data)` using the contract's `state` URef. Field indices: `issuer_nonce`=1, `latest`=2. |
| x402 Facilitator on testnet is finicky.                       | **Resolved** — implemented local settlement mode (direct CSPR transfer) as fallback. Facilitator mode wired to CSPR.cloud but requires auth token. Local mode produces real on-chain txs. |
| 0G Compute inference endpoint unreachable.                    | **Resolved** — `LocalReasoner` (keyword-based fallback) implemented in `packages/agent-logic/src/local-reasoner.ts`. CLI tries 0G Compute first (15s timeout), falls back to local. Web steward has the same fallback. |
| Run out of time on Day 5.                                     | Day 5 is run-through + script lock only. Recording is Day 6 morning. Submit at end of Day 6 even if rough. |

## Out of scope (deliberately not building)

- A new x402 facilitator (use Casper's).
- A CEP-18 token (reuse Buildathon-sponsored one if available).
- Cross-chain credential mirror (Pharos ↔ Casper sync). Architecturally
  possible; not needed for qualification. Mention in README as next step.
- Final Round features. Survive qualification first.
