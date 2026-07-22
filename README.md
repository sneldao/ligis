# Ligis

> **Portable on-chain identity and verifiable credentials for AI agents.**
> **Live on Pharos + Casper Testnet. Autonomous steward loop + x402 payments + CROO CAP commerce working end-to-end.**

## Active hackathon submissions

| Hackathon                          | Track                                | Demo                                                                                                                               | Submission doc                                                           |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Casper Agentic Buildathon 2026** | Casper Innovation / Agentic AI / RWA | [1:35 Casper walkthrough](https://github.com/sneldao/ligis/releases/download/buildathon-2026/ligis-demo.mp4)                       | [`docs/casper-buidl.md`](docs/casper-buidl.md)                           |
| **CROO Agent Hackathon 2026**      | Data & Verification + Open A2A       | [CROO demo](https://github.com/sneldao/ligis/releases/download/croo-hackathon-2026/ligis-croo-demo.mp4) _(upload before deadline)_ | [`docs/croo-hackathon-submission.md`](docs/croo-hackathon-submission.md) |
| **OKX.AI Genesis Hackathon 2026**  | General ASP — Trust & Verification   | _(in progress)_                                                                                                                    | [`docs/okx-ai.md`](docs/okx-ai.md)                                       |
| **0G Bridge by AKINDO 2026**       | Trust & Safety / AI Agents           | _(in progress)_                                                                                                                    | [`docs/strategy.md`](docs/strategy.md)                                   |

**One product, multiple proofs:** Casper contracts are the on-chain source of truth; CROO and OKX.AI are how other agents pay for verification before A2A commerce. 0G Compute, 0G Storage, and 0G Chain power the trust infrastructure. Same `CredentialRegistry` backs every marketplace.

## Demo videos

### Casper Agentic Buildathon (on-chain identity + x402)

[Watch the 1:35 walkthrough (MP4, 5.6 MB)](https://github.com/sneldao/ligis/releases/download/buildathon-2026/ligis-demo.mp4)
— also viewable on the [release page](https://github.com/sneldao/ligis/releases/tag/buildathon-2026).

### CROO Agent Hackathon (CAP commerce + verification)

[Watch the CROO walkthrough](https://github.com/sneldao/ligis/releases/download/croo-hackathon-2026/ligis-croo-demo.mp4)
— CAP negotiate → pay → deliver, with Casper on-chain proof. Source: [`videos/ligis-croo-hackathon/`](videos/ligis-croo-hackathon/).

The Casper video is composed in [`videos/ligis-buildathon-2026/`](videos/ligis-buildathon-2026/) using
[HyperFrames](https://github.com/heygen-com/hyperframes) with live terminal
captures of `casper-e2e-demo.ts` and `casper-x402-demo.ts`, real cspr.live
transaction screenshots, and a 9-segment TTS voiceover.

A chain-agnostic agent identity runtime: one `ChainAdapter` interface, two
implementations (EVM/Pharos live, Casper/Odra live), and a Trust
Steward that runs the same loop on either chain. Credentials are chain-neutral
by design — `capabilityHash("kyc.basic")` produces the same 32-byte hash on
every chain, which is what makes cross-chain credential portability possible.

**The full autonomous loop on Casper:**

1. **BOOT** — Agent mints its own identity (`AgentId.mint_self`) on Casper Testnet
2. **REASON** — 0G Compute (or local fallback) maps the goal to required capabilities
3. **GATE** — Checks `CredentialRegistry.is_capable` for each capability
4. **ACT** — Issues missing credentials via signed EIP-712 `issue` calls
5. **RECORD** — Anchors evidence manifest to 0G Storage + Casper (`set_token_uri`)

**Then the agent pays for premium RWA data via x402:**

1. Agent requests `GET /premium` → **402 Payment Required** (credential verified, payment needed)
2. Agent signs `TransferWithAuthorization` (EIP-712 with Casper domain)
3. Agent resubmits with `X-PAYMENT` header → **200 OK** with tokenized real-estate market data
4. Settlement on Casper Testnet (on-chain tx)

41 Foundry tests + 12 Odra tests + 47 TypeScript tests passing. 4 on-chain Skills + 2 helpers

- Trust Steward Agent. CLI. MCP server. x402 Trust Gate. MIT.

---

## What this is

Ligis gives every AI agent a portable, revocable on-chain identity (`PharosAgentID` ERC-721 on EVM, `AgentId` Odra contract on Casper) and EIP-712 capability credentials (`CredentialRegistry`). Credentials are signed off-chain with secp256k1; the EVM contracts verify signatures on-chain, and the Casper port now recovers the issuer address on-chain for both `issue` and `revoke` using the pure-Rust `k256` crate. Any contract can gate access in one line: `require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed")`.

It ships **live on Pharos** — the identity layer the Pharos agent economy composes on today (Aegis, Pact, FaroLink, Maestro, x402). The Casper adapter (`@ligis/adapter-casper`) is fully implemented and **live on Casper Testnet** — all 8 `ChainAdapter` operations talk to Odra contracts via `casper-client`, the WASM contracts are deployed, and the smoke test passes end-to-end (mint → sign → submit → verify → revoke). The web frontend is chain-aware on all pages (`?chain=casper-testnet` is live). See [`docs/casper-buildathon.md`](docs/casper-buildathon.md) for the submission plan.

## Skills

| Skill             | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `ligis-issue`     | Mint an Agent ID NFT; issue an EIP-712 capability credential                 |
| `ligis-verify`    | Read-only: does a subject hold a valid credential?                           |
| `ligis-revoke`    | Issuer revokes a credential (permanent)                                      |
| `ligis-rotate`    | Move Agent ID to a new controller key (recovery)                             |
| `ligis-hash`      | Helper: keccak256 a capability name                                          |
| `ligis-sign`      | Helper: build + sign an EIP-712 credential off-chain                         |
| `ligis agent run` | Trust Steward: boot → reason (0G Compute) → gate → act → record (0G Storage) |

## Deployed contracts

First deployment is live on **Pharos Atlantic testnet** (chainId 688689):

| Contract             | Address                                      |
| -------------------- | -------------------------------------------- |
| `PharosAgentID`      | `0xbd163Be6882CF6DE54bA10d726F4f619Bdc28a89` |
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

| Chain                     | Adapter                 | Contracts                           | Status                                                         |
| ------------------------- | ----------------------- | ----------------------------------- | -------------------------------------------------------------- |
| **Pharos Atlantic** (EVM) | `@ligis/adapter-evm`    | `packages/contracts-evm` (Solidity) | Live — deployed, tested, steward running                       |
| **Casper Testnet**        | `@ligis/adapter-casper` | `packages/contracts-casper` (Odra)  | **Live** — contracts deployed, smoke test passing, web UI live |

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

# 2. Start the x402 Trust Gate server (RWA oracle feed)
export LIGIS_GATE_PAY_TO="00<your-account-hash>"
export LIGIS_GATE_CAPABILITY="data.premium"
npx tsx packages/x402-server/src/index.ts &

# 3. Run the x402 payment demo (402 → sign → pay → 200 + real RWA data)
npx tsx scripts/casper-x402-demo.ts

# 4. Run the multi-agent coordination demo (Risk → Issuer → Treasury)
npx tsx scripts/casper-multi-agent-demo.ts
```

The steward loop produces 3-4 on-chain transactions on Casper Testnet:

- `mint_self` — Agent mints its own identity
- `issue` — Self-issues each missing capability credential
- `set_token_uri` — Anchors evidence manifest to 0G Storage

The x402 flow produces 1 additional on-chain transaction. Two settlement modes:
- **Facilitator** (`X402_SETTLEMENT_MODE=facilitator`): Real CEP-18
  `transfer_with_authorization` via the CSPR.cloud x402 facilitator
  (`/verify` → `/settle`). Requires `CSPR_CLOUD_TOKEN` and a CEP-18 token.
- **Local** (`X402_SETTLEMENT_MODE=local`): Direct CSPR transfer (demo fallback).

The RWA oracle feed delivers **real market data** from CoinGecko — live prices
for Ondo, Centrifuge, Pendle, Maple, and Polymesh (tokenized RWA tokens).

The **multi-agent demo** runs a three-agent swarm: Risk Agent evaluates
counterparty risk from on-chain credential history → Issuer Agent issues
credentials based on the risk verdict → Treasury Agent executes the x402
payment. Produces 2+ additional on-chain transactions.

## Browser-side Casper wallet (no relayer, user-funded)

There is now a **browser-native Casper Testnet wallet** wired into the web
steward. Every transaction — `mint_self`, `issue`, `set_token_uri` — is
signed locally in the browser and submitted through a stateless CORS-proxy
(`/api/casper-rpc`) to the public testnet RPC. **No signing relayer. The
user funds their own gas.**

How it works:

1. Visit `?chain=casper-testnet` on the web app. The wallet tree
   (`ConditionalProviders` → `WalletTree`) lazy-mounts only on Casper pages;
   Pharos pages never load `casper-js-sdk`.
2. Click **Connect Wallet** → generate a 32-byte secp256k1 secp256k1 scalar
   in the browser via `@noble/curves/utils.randomSecretKey()`, derive the
   Casper public key + account hash + EVM-style issuer address, and copy the
   key to your clipboard / paste it back later.
3. **Fund** at <https://testnet.cspr.live/tools/faucet> (one-time per account,
   100 CSPR from the faucet).
4. Click **Run Steward** → the `web/lib/casper-browser/steward.ts` loop runs
   `mint_self → verifyCapability → signCredential + submitCredential → anchorEvidence`,
   each one signed in-browser via `@noble/curves/secp256k1.sign(digest, scalar)`.
   The off-chain EIP-712 credential digest is byte-identical to the server
   adapter's (both use `@casper-ecosystem/casper-eip-712`'s `hashTypedData`,
   both sign with secp256k1), so on-chain signature recovery round-trips to
   the same EVM address the server's signer would produce.

Two smoke tests live in `web/scripts/` for pre-judging validation:

```bash
pnpm --filter @ligis/web exec tsx web/scripts/smoke-wallet-crypto.ts
# → asserts @noble/curves r,s,v parity with ethers.Wallet (EVM addr roundtrips)
pnpm --filter @ligis/web exec tsx web/scripts/smoke-wallet-tx.ts
# → builds a CSSPR-2.0 mint_self TransactionV1 and asserts `mint_self` is on
# the wire bytes (does NOT submit; uses a placeholder package hash)
```

**No new Vercel env vars required.** The wallet UI reuses the existing
**server-side** `LIGIS_CASPER_AGENT_ID` + `LIGIS_CASPER_CREDENTIAL_REGISTRY`
(already set on Vercel for Casper reads) through `/api/casper-config`,
a tiny server route that strips the `contract-package-` prefix and
serves the bare hex hashes to the browser. Writes go through
`/api/casper-rpc`, a stateless CORS byte-proxy. The proxy holds no keys
and signs nothing — it's safe to expose publicly. So a wallet click
that round-trips to testnet needs zero new env vars beyond what the
chain-switching section already lists.

Files in `web/lib/casper-browser/{keypair,eip712,operations,rpc,store,steward}.ts(x)`
compose the wallet.

## CROO Agent Protocol (CAP) integration

Ligis is listed as a callable agent on the [CROO Agent Store](https://agent.croo.network).
Before one agent pays another, it can hire Ligis to run a **counterparty risk
check** and receive a pass/warn/fail verdict plus a 0–100 risk score. The
provider runs 24/7 in production (`pm2`-managed), so judges only need a
requester — no need to run a provider yourself.

**Judge repro (CROO Hackathon):**

```bash
# Hire Ligis via CAP (hits the live provider)
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm demo:croo
```

> `source file.env` alone only sets shell-local variables — it does not
> export them to the `node`/`pnpm` child process. `set -a` (allexport) makes
> everything sourced after it exported automatically; `set +a` turns that
> back off. Without it, `pnpm croo` fails immediately with `Missing required
environment variable: CROO_SDK_KEY`.

| Service        | Price | What you get                                                                            | Input                                                              |
| -------------- | ----- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ligis.risk`   | $0.75 | **Counterparty risk check** — pass/warn/fail + 0–100 score                              | `{ subject, capabilities, issuer?, minTtlSeconds? }`               |
| `ligis.verify` | $0.50 | On-chain credential verification                                                        | `{ subject, capability, issuer? }`                                 |
| `ligis.issue`  | $1.00 | Signed capability credential issuance; optionally imports EAS provenance before issuing | `{ subject, capability, expiresInSeconds?, externalAttestation? }` |

All three services are live and tested end-to-end: issue → verify (`capable: true`) → risk check (`warn`, maturing to `pass` after 7 days).

See [`docs/croo-integration.md`](docs/croo-integration.md), [`docs/okx-ai.md`](docs/okx-ai.md), [`docs/attestation-integrations.md`](docs/attestation-integrations.md), [`docs/strategy.md`](docs/strategy.md), and [`packages/croo-adapter/`](packages/croo-adapter/).

## Documentation

| Doc                                                            | What's in it                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Strategy](docs/strategy.md)                                   | Product strategy, competitive landscape, differentiation, roadmap, business model     |
| [Architecture](docs/architecture.md)                           | Contract design, module structure, repository layout                                  |
| [Attestation integrations](docs/attestation-integrations.md)   | Self Protocol and EAS provenance, privacy boundaries, and rollout                     |
| [Monorepo structure](MONOREPO_STRUCTURE.md)                    | Package layout, dependency graph, ChainAdapter interface, adding a new chain          |
| [CROO Integration](docs/croo-integration.md)                   | CAP adapter, Agent Store listing, provider/requester usage                            |
| [OKX.AI Integration](docs/okx-ai.md)                           | ASP strategy, services, demo plan, and submission checklist                           |
| [API Reference](docs/api.md)                                   | Service schemas, input/output examples, capability names, chains                      |
| [CROO Hackathon submission](docs/croo-hackathon-submission.md) | BUIDL copy, judge repro, track alignment                                              |
| [Casper Buildathon](docs/casper-buildathon.md)                 | Submission plan, product story, day-by-day roadmap, demo storyboard                   |
| [Trust Steward Agent](docs/trust-steward-agent.md)             | The autonomous loop, 0G integration, build phases                                     |
| [Security](docs/security.md)                                   | Non-custodial design, EIP-712 replay protection                                       |
| [Setup](docs/setup.md)                                         | From-scratch install, env vars, 0G wallet, Casper wallet, x402 server, deploy, verify |
| [SKILL.md](SKILL.md)                                           | Director entry point for AI agents                                                    |
| [References](references/)                                      | Per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability)    |

## License

MIT — see [LICENSE](./LICENSE).

## Links

- **Web app:** [ligis.vercel.app](https://ligis.vercel.app) (live, chain-aware)
- **GitHub:** [github.com/sneldao/ligis](https://github.com/sneldao/ligis)
- **Twitter / X:** [@ligis_protocol](https://twitter.com/ligis_protocol)
- **Discord:** [discord.gg/ligis](https://discord.gg/ligis)
