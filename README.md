# Ligis

> **Portable on-chain identity and verifiable credentials for AI agents.**
> **Live on Pharos. Casper in progress for the Casper Agentic Buildathon.**

A chain-agnostic agent identity runtime: one `ChainAdapter` interface, two
implementations (EVM/Pharos today, Casper/Odra in progress), and a Trust
Steward that runs the same loop on either chain. Credentials are chain-neutral
by design — `capabilityHash("kyc.basic")` produces the same 32-byte hash on
every chain, which is what makes cross-chain credential portability possible.

41 Foundry tests + 17 TypeScript tests passing. 4 on-chain Skills + 2 helpers
+ Trust Steward Agent. CLI. MCP server. x402 Trust Gate. MIT.

---

## What this is

Ligis gives every AI agent a portable, revocable on-chain identity (`PharosAgentID` ERC-721 on EVM, `AgentId` Odra contract on Casper) and signed capability credentials (`CredentialRegistry` EIP-712 on both chains). Any contract can gate access in one line: `require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed")`.

It ships **live on Pharos** — the identity layer the Pharos agent economy composes on today (Aegis, Pact, FaroLink, Maestro, x402). The Casper adapter + Odra contracts are scaffolded and building for the [Casper Agentic Buildathon](https://dorahacks.io/hackathon/2202/detail); see [`docs/casper-buildathon.md`](docs/casper-buildathon.md) for the submission plan.

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

## Chain support

Ligis is **chain-agnostic by design.** Every chain implements the same
`ChainAdapter` interface from `@ligis/core`; the Trust Steward, CLI, and
MCP server consume the interface, not the implementation.

| Chain | Adapter | Contracts | Status |
|-------|---------|-----------|--------|
| **Pharos Atlantic** (EVM) | `@ligis/adapter-evm` | `packages/contracts-evm` (Solidity) | Live — deployed, tested, steward running |
| **Casper Testnet** | `@ligis/adapter-casper` | `packages/contracts-casper` (Odra) | Scaffolded — `signCredential` live, ops pending contract deploy |

**Why this works across chains:**
- **Capabilities are chain-neutral**: `capabilityHash("kyc.basic")` produces
  the same `0x...32` on every chain. The hash is the canonical id.
- **Agent identity uses DIDs**: `did:ligis:<chain-id>:<chain-native-id>`.
- **EIP-712 domain separation is per-chain**: the domain separator binds
  the chain name + contract package hash, so a credential signed for one
  chain cannot be replayed on another.
- **The same secp256k1 key** can issue credentials on both chains — the
  signature is valid wherever the issuer's address is recognized.

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

# Casper (after contracts are deployed — see docs/setup.md)
pnpm start -- --chain casper info
pnpm start -- --chain casper verify --subject <account-hash> --capability kyc.basic
```

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Architecture](docs/architecture.md) | Contract design, module structure, repository layout |
| [Monorepo structure](MONOREPO_STRUCTURE.md) | Package layout, dependency graph, ChainAdapter interface, adding a new chain |
| [Casper Buildathon](docs/casper-buildathon.md) | Submission plan, product story, day-by-day roadmap, demo storyboard |
| [Trust Steward Agent](docs/trust-steward-agent.md) | The autonomous loop, 0G integration, build phases |
| [Security](docs/security.md) | Non-custodial design, EIP-712 replay protection |
| [Setup](docs/setup.md) | From-scratch install, env vars, 0G wallet, Casper wallet, x402 server, deploy, verify |
| [SKILL.md](SKILL.md) | Director entry point for AI agents |
| [References](references/) | Per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability) |

## License

MIT — see [LICENSE](./LICENSE).
