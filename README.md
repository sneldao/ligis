# Ligis

> **Portable on-chain identity and verifiable credentials for AI agents.**
> **Live on Pharos + Casper Testnet. Autonomous steward loop + x402 payments + CROO CAP commerce working end-to-end.**

## Demo video

[Watch the 1:35 walkthrough (MP4, 5.6 MB)](https://github.com/sneldao/ligis/releases/download/buildathon-2026/ligis-demo.mp4)
— also viewable on the [release page](https://github.com/sneldao/ligis/releases/tag/buildathon-2026).

The video is composed in [`video/ligis-demo/`](video/ligis-demo/) using
[HyperFrames](https://github.com/heygen-com/hyperframes) with live terminal
captures of `casper-e2e-demo.ts` and `casper-x402-demo.ts`, real cspr.live
transaction screenshots, and a 9-segment TTS voiceover. The composition
source (`index.html`) is committed; the rendered MP4 ships in the
`buildathon-2026` GitHub Release.

A chain-agnostic agent identity runtime: one `ChainAdapter` interface, two
implementations (EVM/Pharos live, Casper/Odra live), and a Trust
Steward that runs the same loop on either chain. Credentials are chain-neutral
by design — `capabilityHash("kyc.basic")` produces the same 32-byte hash on
every chain, which is what makes cross-chain credential portability possible.

**The full autonomous loop on Casper:**
1. **BOOT** — Agent mints its own identity (`AgentId.mint_self`) on Casper Testnet
2. **REASON** — 0G Compute (or local fallback) maps the goal to required capabilities
3. **GATE** — Checks `CredentialRegistry.is_capable` for each capability
4. **ACT** — Self-issues missing credentials via signed EIP-712 `issue` calls
5. **RECORD** — Anchors evidence manifest to 0G Storage + Casper (`set_token_uri`)

**Then the agent pays for premium RWA data via x402:**
1. Agent requests `GET /premium` → **402 Payment Required** (credential verified, payment needed)
2. Agent signs `TransferWithAuthorization` (EIP-712 with Casper domain)
3. Agent resubmits with `X-PAYMENT` header → **200 OK** with tokenized real-estate market data
4. Settlement on Casper Testnet (on-chain tx)

41 Foundry tests + 12 Odra tests + 17 TypeScript tests passing. 4 on-chain Skills + 2 helpers
+ Trust Steward Agent. CLI. MCP server. x402 Trust Gate. MIT.

---

## What this is

Ligis gives every AI agent a portable, revocable on-chain identity (`PharosAgentID` ERC-721 on EVM, `AgentId` Odra contract on Casper) and EIP-712 capability credentials (`CredentialRegistry`). Credentials are signed off-chain with secp256k1; the EVM contracts verify signatures on-chain, and the Casper port now recovers the issuer address on-chain for both `issue` and `revoke` using the pure-Rust `k256` crate. Any contract can gate access in one line: `require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed")`.

It ships **live on Pharos** — the identity layer the Pharos agent economy composes on today (Aegis, Pact, FaroLink, Maestro, x402). The Casper adapter (`@ligis/adapter-casper`) is fully implemented and **live on Casper Testnet** — all 8 `ChainAdapter` operations talk to Odra contracts via `casper-client`, the WASM contracts are deployed, and the smoke test passes end-to-end (mint → sign → submit → verify → revoke). The web frontend is chain-aware on all pages (`?chain=casper-testnet` is live). See [`docs/casper-buildathon.md`](docs/casper-buildathon.md) for the submission plan.

## Skills

| Skill | What it does |
|---|---|
| `ligis-issue` | Mint an Agent ID NFT; issue an EIP-712 capability credential |
| `ligis-verify` | Read-only: does a subject hold a valid credential? |
| `ligis-revoke` | Issuer revokes a credential (permanent) |
| `ligis-rotate` | Move Agent ID to a new controller key (recovery) |
| `ligis-hash` | Helper: keccak256 a capability name |
| `ligis-sign` | Helper: build + sign an EIP-712 credential off-chain |
| `ligis agent run` | Trust Steward: boot → reason (0G Compute) → gate → act → record (0G Storage) |

## Deployed contracts

First deployment is live on **Pharos Atlantic testnet** (chainId 688689):

| Contract | Address |
|----------|---------|
| `PharosAgentID` | `0xbd163Be6882CF6DE54bA10d726F4f619Bdc28a89` |
| `CredentialRegistry` | `0x9E6eC93200E185c11423eb3A5150449D49d3473A` |

## Web frontend

A Next.js app (`web/`) deployed on Vercel provides a live Steward interface
with SSE streaming of the full boot → reason → gate → act → record loop.

**Three modes:**
- **Simulated** — no env vars needed, uses realistic timing + fake tx hashes
- **Live reads** — real `isCapableMulti` calls against Pharos Atlantic
- **Live writes** — real `mintSelf`, `issue` (EIP-712), `setTokenURI` on-chain

When `ZEROG_PRIVATE_KEY` is set, the REASON phase calls 0G Compute (Qwen 2.5 7B,
TEE-verified LLM) and the RECORD phase uploads evidence manifests to 0G Storage.
Write transactions bypass `eth_sendTransaction` (unsupported by the default
Pharos RPC) by signing locally and sending via `eth_sendRawTransaction`.

Agent profile pages (`/agent/<address>`) show capability history from
`AgentCapabilityChanged` events with clickable PharosScan links.

See [`docs/setup.md`](docs/setup.md) for Vercel env var configuration.

## Chain support

Ligis is **chain-agnostic by design.** Every chain implements the same
`ChainAdapter` interface from `@ligis/core`; the Trust Steward, CLI, and
MCP server consume the interface, not the implementation.

| Chain | Adapter | Contracts | Status |
|-------|---------|-----------|--------|
| **Pharos Atlantic** (EVM) | `@ligis/adapter-evm` | `packages/contracts-evm` (Solidity) | Live — deployed, tested, steward running |
| **Casper Testnet** | `@ligis/adapter-casper` | `packages/contracts-casper` (Odra) | **Live** — contracts deployed, smoke test passing, web UI live |

**Why this works across chains:**
- **Capabilities are chain-neutral**: `capabilityHash("kyc.basic")` produces
  the same `0x...32` on every chain because `@ligis/core` computes keccak256
  off-chain and passes it to each adapter. The hash is the canonical id.
- **Agent identity uses DIDs**: `did:ligis:<chain-id>:<chain-native-id>`.
- **EIP-712 domain separation is per-chain**: the domain separator binds
  the chain name + contract package hash, so a credential signed for one
  chain cannot be replayed on another.
- **The same secp256k1 key** can sign credentials for both chains — the
  off-chain EIP-712 signature verifies against the same issuer address on
  either chain.

To bring up another chain: implement `ChainAdapter`, add the chain branch
to `getAdapter()` in the CLI and MCP server, and (optionally) create
`packages/contracts-<chain>`. See [`MONOREPO_STRUCTURE.md`](MONOREPO_STRUCTURE.md)
for the full architecture.

## Quick start

```bash
pnpm install

# Mint an Agent ID on Pharos (default chain)
PRIVATE_KEY=0x... pnpm start -- issue --token-uri "ipfs://bafy.../meta"

# Verify a credential (read-only)
pnpm start -- verify --subject 0x... --capability "agent.commerce.escrow"

# Run the Trust Steward Agent
PRIVATE_KEY=0x... ZEROG_PRIVATE_KEY=0x... \
  pnpm start -- agent run --goal "open an escrow with counterparty X"

# Casper (contracts deployed on Testnet — see docs/setup.md)
pnpm setup:casper                    # generate 3 testnet wallets
# → fund deployer at https://testnet.cspr.live/tools/faucet
# → transfer CSPR to agent + issuer
source .env.d/casper.env
pnpm deploy:casper                   # install WASM contracts to Casper Testnet
pnpm start -- --chain casper info
pnpm start -- --chain casper verify --subject <account-hash> --capability kyc.basic
npx tsx scripts/casper-smoke-test.ts   # end-to-end credential lifecycle test
```

## Demo: Autonomous Agent + x402 Payment on Casper

```bash
# 1. Run the Trust Steward loop (boot → reason → gate → act → record)
source .env.d/casper.env
source .env.d/zerog.env
export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
export LIGIS_CASPER_PUBLIC_KEY=$LIGIS_CASPER_DEPLOYER_PUBKEY
npx tsx scripts/casper-e2e-demo.ts

# 2. Start the x402 Trust Gate server
export LIGIS_GATE_PAY_TO="00<your-account-hash>"
export LIGIS_GATE_CAPABILITY="data.premium"
npx tsx packages/x402-server/src/index.ts &

# 3. Run the x402 payment demo (402 → sign → pay → 200 + RWA data)
npx tsx scripts/casper-x402-demo.ts
```

The steward loop produces 3-4 on-chain transactions on Casper Testnet:
- `mint_self` — Agent mints its own identity
- `issue` — Self-issues each missing capability credential
- `set_token_uri` — Anchors evidence manifest to 0G Storage

The x402 flow produces 1 additional on-chain transaction (a direct CSPR transfer in the demo's local-settlement fallback). Local settlement verifies the X-PAYMENT payload shape; full CEP-18 `transfer_with_authorization` settlement via the CSPR.cloud facilitator is wired but requires `CSPR_CLOUD_TOKEN`.

## CROO Agent Protocol (CAP) integration

Ligis is listed as a callable agent on the [CROO Agent Store](https://agent.croo.network).
Before one agent pays another, it can hire Ligis to run a **counterparty risk
check** and receive a pass/warn/fail verdict plus a 0–100 risk score.

```bash
# Run the CAP provider (listens for CROO negotiations, accepts, checks risk, delivers)
export $(grep -v '^#' .env.d/croo.env | grep -v '^$' | xargs)
pnpm croo
```

| Service | What you get | Input |
|---|---|---|
| `ligis.risk` | **Counterparty risk check** — pass/warn/fail + score | `{ subject, capabilities, issuer?, minTtlSeconds? }` |
| `ligis.verify` | On-chain credential verification | `{ subject, capability, issuer? }` |
| `ligis.issue` | Signed capability credential issuance | `{ subject, capability, expiresInSeconds? }` |

See [`docs/croo-integration.md`](docs/croo-integration.md) and [`packages/croo-adapter/`](packages/croo-adapter/).

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Architecture](docs/architecture.md) | Contract design, module structure, repository layout |
| [Monorepo structure](MONOREPO_STRUCTURE.md) | Package layout, dependency graph, ChainAdapter interface, adding a new chain |
| [Casper Buildathon](docs/casper-buildathon.md) | Submission plan, product story, day-by-day roadmap, demo storyboard |
| [Trust Steward Agent](docs/trust-steward-agent.md) | The autonomous loop, 0G integration, build phases |
| [CROO Integration](docs/croo-integration.md) | CAP adapter, Agent Store listing, provider/requester usage |
| [Security](docs/security.md) | Non-custodial design, EIP-712 replay protection |
| [Setup](docs/setup.md) | From-scratch install, env vars, 0G wallet, Casper wallet, x402 server, deploy, verify |
| [SKILL.md](SKILL.md) | Director entry point for AI agents |
| [References](references/) | Per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability) |

## License

MIT — see [LICENSE](./LICENSE).
