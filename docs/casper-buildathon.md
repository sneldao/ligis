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
├── adapter-casper/      Casper — scaffolded, signCredential live, others stubbed
├── zerog/               0G Compute/Storage (done)
├── agent-logic/         Trust Steward (chain-agnostic, done)
├── cli/                 + --chain casper (wired)
├── mcp-server/          + chain="casper" (wired)
├── contracts-evm/       Solidity (done)
├── contracts-casper/    Odra — scaffolded, compiles, cargo odra build pending toolchain fix
└── x402-server/         Scaffolded — /premium endpoint, 402 response, facilitator forward
```

## Roadmap (5 days, day-by-day)

### Day 1 — TODAY (Jun 25)
- [x] Scaffold `adapter-casper`, `contracts-casper`, CLI/MCP wiring, docs.
- [x] `x402-server` scaffolded (pulled forward from Day 4).
- [x] Multi-chain UI shell on home page (ChainSelector + getChain).
- [x] Workspace builds end-to-end (all 8 TS packages + web).
- [ ] Install Rust toolchain, `cargo-odra`, `just` (budget: 2–3 hours —
      first Odra build often hits trait-bound mismatches needing cargo.toml surgery).
- [ ] Create **three** Casper Testnet wallets: deployer, agent subject, issuer.
      Faucet is single-use per account, so: deployer hits faucet once, then
      deployer → agent + issuer via transfer. Each needs ~10–50 CSPR.
- [ ] `cargo odra build` succeeds locally (proves the toolchain works).

### Day 2 (Jun 26)
- [ ] Flesh out `agent_id.rs` + `credential_registry.rs` with full signature
  verification path. Wire `casper-eip-712` crate.
- [ ] Deploy `agent_id.wasm` + `credential_registry.wasm` to Casper Testnet.
  Record package hashes.
- [ ] Implement `CasperAdapter.getAgentId` + `issueAgentId` against the
  deployed `AgentId` contract. **First Casper transaction lands.**

### Day 3 (Jun 27)
- [ ] Implement `CasperAdapter.signCredential` + `submitCredential` +
  `verifyCapability` against `CredentialRegistry`. Wire `casper-eip-712`
  on the TS side.
- [ ] Implement `revokeCredential` and `anchorEvidence`.
- [ ] Trust Steward end-to-end run on Casper:
  `ligis --chain casper agent run --goal "test"`.
  Steward self-issues **both** `data.premium` **and** `agent.commerce.x402`
  (the gate reads `data.premium`; the agent needs `agent.commerce.x402`
  to authorize the x402 payment flow).

### Day 4 (Jun 28)
- [ ] Wire `x402-server` credential check + 402 + payment settlement via
  the Casper x402 Facilitator (scaffold is already in place).
- [ ] Propagate chain-awareness to remaining web pages (agent profile,
  steward, capabilities, issuers, embed) — same pattern as the home page.
- [ ] Add a CEP-18 test token if needed (or reuse a Buildathon-provided one).

### Day 5 (Jun 29)
- [ ] End-to-end demo run: agent → Steward → Casper credential → x402 paid
  call → 0G evidence anchor.
- [ ] **Run-through + script lock** (NOT the final recording — that's Day 6).
- [ ] Polish README with Casper-first framing.

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
| Odra learning curve eats Day 2.                               | Skeleton already compiles; Day 2 is "fill in bodies + deploy", not "learn from scratch". Budget 2–3 hours for Day 1 toolchain setup, not 1. |
| `casper-eip-712` Rust side has edge cases against TS side.    | The repo ships cross-language test vectors — use them as oracles.                         |
| Casper Testnet faucet rate limits (single-use per account).   | Create three wallets (deployer, agent, issuer) early. Deployer hits faucet once, then transfers to the other two. Each needs ~10–50 CSPR. |
| x402 Facilitator on testnet is finicky.                       | Don't mock settlement. The Steward loop produces 3+ Ligis-native on-chain txs per run — those are the qualification floor. If the facilitator is down, show the Ligis-native txs as proof and note the x402 path is wired but pending the facilitator. |
| Run out of time on Day 5.                                     | Day 5 is run-through + script lock only. Recording is Day 6 morning. Submit at end of Day 6 even if rough. |

## Out of scope (deliberately not building)

- A new x402 facilitator (use Casper's).
- A CEP-18 token (reuse Buildathon-sponsored one if available).
- Cross-chain credential mirror (Pharos ↔ Casper sync). Architecturally
  possible; not needed for qualification. Mention in README as next step.
- Final Round features. Survive qualification first.
