# Ligis

> **Portable on-chain identity and verifiable credentials for AI agents.**
> **Live on Pharos. Portable to any EVM chain.**

41 Foundry tests + 17 TypeScript tests passing. 4 on-chain Skills + 2 helpers + Trust Steward Agent. CLI. MCP server. MIT.

---

## What this is

Ligis gives every AI agent a portable, revocable on-chain identity (`PharosAgentID` ERC-721) and signed capability credentials (`CredentialRegistry` EIP-712). Any contract can gate access in one line: `require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed")`.

It ships **live on Pharos** — the identity layer the Pharos agent economy composes on today (Aegis, Pact, FaroLink, Maestro, x402). The contracts are plain EVM Solidity with no chain-specific dependencies, so the same two contracts deploy on any EVM chain, and credentials are chain-scoped and replay-safe by design.

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

Ligis is **Pharos-first, EVM-portable by design.**

- **No chain-specific dependencies.** Both contracts are plain Solidity (`^0.8.24`) — no custom precompiles or opcodes. The same source deploys unchanged on any EVM chain.
- **Per-chain, replay-safe credentials.** The EIP-712 `DOMAIN_SEPARATOR` binds `block.chainid` and the registry address, so a credential signed for one chain cannot be replayed on another. Multi-chain is a property of the design, not a later bolt-on.
- **Data-driven runtime.** Chains live in [`assets/networks.json`](assets/networks.json) and are selected with `PHAROS_NETWORK`; the CLI, MCP server, and agent build the chain at runtime (viem `defineChain`) — no code change to read a new network.
- **Already multi-network.** The Trust Steward uses Pharos for identity/credentials and **0G** for verifiable compute and storage.

To bring up another EVM chain: add it to [`assets/networks.json`](assets/networks.json) and to the network map in [`scripts/deploy.sh`](scripts/deploy.sh) (which currently has entries for `atlantic`, `mainnet`, and `local`), then run `bash scripts/deploy.sh <network>`. Each deployment is independent and gets its own EIP-712 domain.

## Quick start

```bash
npm install

# Mint an Agent ID
PRIVATE_KEY=0x... npx tsx src/cli/index.ts issue --token-uri "ipfs://bafy.../meta"

# Verify a credential (read-only)
npx tsx src/cli/index.ts verify --subject 0x... --capability "agent.commerce.escrow"

# Run the Trust Steward Agent
PRIVATE_KEY=0x... ZEROG_PRIVATE_KEY=0x... \
  npx tsx src/cli/index.ts agent run --goal "open an escrow with counterparty X"
```

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Architecture](docs/architecture.md) | Contract design, module structure, repository layout |
| [Trust Steward Agent](docs/trust-steward-agent.md) | The autonomous loop, 0G integration, build phases |
| [Security](docs/security.md) | Non-custodial design, EIP-712 replay protection |
| [Setup](docs/setup.md) | From-scratch install, env vars, 0G wallet, deploy, verify |
| [SKILL.md](SKILL.md) | Director entry point for AI agents |
| [References](references/) | Per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability) |

## License

MIT — see [LICENSE](./LICENSE).
