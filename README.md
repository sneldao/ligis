# Ligis

> **Portable on-chain identity and verifiable credentials for agents on the Pharos Network.**

41 Foundry tests + 17 TypeScript tests passing. 4 on-chain Skills + 2 helpers + Trust Steward Agent. CLI. MCP server. MIT.

---

## What this is

Ligis gives every AI agent a portable, revocable on-chain identity (`PharosAgentID` ERC-721) and signed capability credentials (`CredentialRegistry` EIP-712). Any contract can gate access in one line: `require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed")`.

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

Live on **Pharos Atlantic testnet** (chainId 688689):

| Contract | Address |
|----------|---------|
| `PharosAgentID` | `0xBAab32536368bBD97BD9410CCE6b7d075CdcAcF8` |
| `CredentialRegistry` | `0xf583421A8e11aEB42d26798F285dc590A992e488` |

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
