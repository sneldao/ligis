# Build & Deploy Flow

Quick reference for local development, testing, and deployment workflows.

## Project Structure

```
ligis/
├── packages/
│   ├── core/              # Chain-neutral primitives (only dep: @noble/hashes)
│   ├── adapter-evm/       # EVM ChainAdapter (viem)
│   ├── zerog/             # 0G Compute (Reasoner) + 0G Storage (EvidenceStore)
│   ├── agent-logic/       # Trust Steward — chain-agnostic agent loop
│   ├── cli/               # CLI entry point (--chain evm|casper)
│   ├── mcp-server/        # MCP server (per-tool `chain` arg)
│   └── contracts-evm/     # Solidity source (CredentialRegistry, PharosAgentID)
├── web/                   # Next.js frontend
├── test/                  # Foundry Solidity tests
├── scripts/               # Bash helpers (deploy, verify, demo, forge)
├── foundry.toml           # Solidity config (src → packages/contracts-evm/src)
├── tsconfig.json          # Root project references
├── pnpm-workspace.yaml    # Workspace roots: packages/* + web
├── package.json           # Root scripts (pnpm workspaces)
└── MONOREPO_STRUCTURE.md  # Detailed restructuring notes
```

## Prerequisites

- Node.js >= 20
- pnpm >= 8
- Foundry (forge, cast)

## Setup

```bash
pnpm install
cd web && pnpm install
```

## Development

### TypeScript (watch all packages)

```bash
pnpm dev
```

### CLI

```bash
pnpm start -- --help
# or after build:
node --enable-source-maps packages/cli/dist/index.js --info
```

### MCP Server

```bash
pnpm mcp:dev
```

### Next.js Frontend

```bash
cd web
pnpm dev              # http://localhost:3000
pnpm typecheck
pnpm build
```

## Building

```bash
pnpm build            # Builds all TS packages in dependency order
```

Each package outputs to its own `packages/<name>/dist/`:
- `packages/core/dist/`
- `packages/adapter-evm/dist/`
- `packages/zerog/dist/`
- `packages/agent-logic/dist/`
- `packages/cli/dist/index.js`
- `packages/mcp-server/dist/index.js`

## Testing

### Solidity (Foundry)

```bash
pnpm test                 # forge test -vvv
pnpm test:coverage        # forge coverage
```

### TypeScript

```bash
pnpm test:ts              # packages/*/test/**/*.test.ts
```

### Combined

```bash
pnpm test:all             # Solidity + TS
```

## Deployment

### Atlantic Testnet (default)

```bash
export PRIVATE_KEY=0x...
pnpm run deploy:atlantic
pnpm run verify:atlantic   # requires SOCIALSCAN_API_KEY
```

### Pharos Mainnet

```bash
export PRIVATE_KEY=0x...
pnpm run deploy:mainnet
```

Contracts are saved in `broadcast/` and addresses are logged by the deploy script.

## Cleanup

```bash
pnpm run clean
# Removes: packages/*/dist, out/, cache/, broadcast/
```

## Environment Variables

| Var | Purpose | Required | Example |
|-----|---------|----------|---------|
| `PRIVATE_KEY` | Deployer / issuer wallet | Yes (deploy, write ops) | `0xabcd...` |
| `SOCIALSCAN_API_KEY` | Contract verification | Yes (verify) | Etherscan/Pharos API key |
| `RPC_ATLANTIC` | Custom Atlantic RPC | No | Defaults to dplabs |
| `RPC_MAINNET` | Custom Pharos mainnet RPC | No | Defaults to pharos.xyz |
| `ZEROG_PRIVATE_KEY` | 0G Compute / Storage | Yes (steward features) | 0x... |

## Configuration Files

| File | Purpose |
|------|---------|
| `foundry.toml` | Solidity compiler settings (0.8.24, optimizer) |
| `tsconfig.json` | Root TS project references |
| `web/tsconfig.json` | Next.js + path aliases (`@ligis/core`, `@ligis/adapter-evm`, ...) |
| `pnpm-workspace.yaml` | Workspace package globs |
| `MONOREPO_STRUCTURE.md` | Monorepo architecture & dependency graph |

## Key Commands

```bash
pnpm build              # All packages
pnpm test               # Solidity only
pnpm test:ts            # TypeScript only
pnpm test:all           # Both
pnpm clean              # Remove all build artifacts
pnpm dev                # Watch mode for all TS packages
pnpm start -- --info    # Run CLI info command
```

## Notes

- The `@ligis/*` packages use `workspace:*` dependencies — no external registry needed.
- Foundry resolves contracts from `packages/contracts-evm/src/`.
- `web/` imports from `@ligis/core`, `@ligis/adapter-evm`, etc. via TS path alias; Next.js resolves at build time.
