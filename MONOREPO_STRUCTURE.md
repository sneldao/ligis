# Ligis monorepo

Ligis is evidence-based payment control for autonomous finance (see
[`docs/positioning.md`](docs/positioning.md)). The monorepo has grown along
two axes: **what depends on a particular chain** (chain-neutral logic in
`core` and `agent-logic`, chain-specific code in `adapter-*`), and **tier**
(product, credential layer, showcase).

## Package tiers

| Package                                  | Tier             | Role                                                                                                 |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `procurement`                            | Product          | Order-bound payment controller on the Airwallex transfers rail                                       |
| `core`                                   | Product          | Chain-neutral primitives, `decide()` inputs, reasoner chain, Jev client                              |
| `x402-server`                            | Product          | Credential-gated x402 resource server (the gate over HTTP)                                           |
| `wallet-plugin`                          | Product          | Guarded payment adapter — signs only on a fresh GO                                                   |
| `metamask-plugin`                        | Product          | MetaMask Agent Wallet packaging of `wallet-plugin`                                                   |
| `web`                                    | Product          | Next.js app: `/gate`, `/api/gate`, issuer desk; also hosts showcase routes                           |
| `adapter-evm`, `contracts-evm`           | Credential layer | Pharos, Monad and other EVM chains                                                                   |
| `adapter-casper`, `contracts-casper`     | Credential layer | Casper                                                                                               |
| `adapter-0g`                             | Credential layer | 0G Chain (wraps `adapter-evm`)                                                                       |
| `zerog`                                  | Credential layer | 0G Compute reasoner + 0G Storage evidence                                                            |
| `agent-logic`                            | Credential layer | Trust Steward loop                                                                                   |
| `cli`, `mcp-server`                      | Credential layer | Operator and agent entry points                                                                      |
| `croo-adapter`                           | Credential layer | CROO Agent Store distribution                                                                        |
| `envio-indexer`                          | Credential layer | Monad `CredentialRegistry` indexer                                                                   |
| `adapter-genlayer`, `contracts-genlayer` | Showcase         | GenLayer JobEscrow (Agent Tank)                                                                      |
| `adapter-zcash`                          | Showcase         | Zcash shielded presentation channel: `ZcashChainAdapter`, address + memo codecs, lightwalletd client |
| `circuits-zcash`                         | Showcase         | Noir circuit for the Zcash shielded gate (Zecathon)                                                  |

**Note on `core`.** `core` holds no chain-specific code. New
event-specific work goes in an adapter or example package, not in `core`.

## Layout

```
ligis/
├── packages/
│   ├── core/              # Chain-neutral primitives (no chain SDKs)
│   │   └── src/
│   │       ├── types.ts       # CredentialView, SignedCredential, Network, ...
│   │       ├── hash.ts        # capabilityHash (keccak256), parseCapability
│   │       ├── did.ts         # did:ligis:<chain>:<id>
│   │       ├── config.ts      # loadConfig() — reads assets/networks.json
│   │       ├── adapter.ts     # ChainAdapter interface
│   │       ├── reasoner.ts    # Reasoner interface (LLM)
│   │       └── evidence.ts    # EvidenceStore interface + manifest type
│   │
│   ├── adapter-evm/       # ChainAdapter impl for EVM (Pharos, anvil, ...)
│   │   └── src/
│   │       ├── adapter.ts     # EvmAdapter class (the public surface)
│   │       ├── operations.ts  # raw viem ops (issue/verify/sign/revoke/...)
│   │       ├── client.ts      # viem ClientContext bootstrap
│   │       ├── abi.ts         # Solidity ABIs
│   │       └── address.ts     # EVM address parsing
│   │
│   ├── adapter-casper/    # ChainAdapter impl for Casper (casper-js-sdk + casper-eip-712)
│   │   └── src/
│   │       ├── adapter.ts     # CasperAdapter class
│   │       ├── operations.ts  # on-chain ops (all 8 implemented via casper-js-sdk)
│   │       ├── signer.ts      # secp256k1 key loading + TransactionV1 building/signing
│   │       ├── deploy.ts      # WASM install script (pnpm deploy:casper)
│   │       ├── client.ts      # casper-js-sdk RpcClient bootstrap
│   │       ├── config.ts      # CasperConfig + loadCasperConfig() from env
│   │       ├── eip712.ts      # EIP-712 digest construction via @casper-ecosystem/casper-eip-712
│   │       └── index.ts
│   │
│   ├── zerog/             # 0G Compute (Reasoner) + 0G Storage (EvidenceStore)
│   │   └── src/
│   │       ├── compute.ts
│   │       └── storage.ts
│   │
│   ├── agent-logic/       # Trust Steward — chain-agnostic agent loop
│   │   └── src/
│   │       ├── policy.ts      # Known capabilities + reasoning prompt
│   │       └── steward.ts     # boot → reason → gate → act → record
│   │
│   ├── cli/               # ligis CLI (--chain evm|casper)
│   ├── mcp-server/        # MCP server (per-tool `chain` argument)
│   ├── contracts-evm/     # Solidity contracts (Foundry)
│   ├── contracts-casper/  # Odra/Rust contracts (agent_id.rs, credential_registry.rs)
│   ├── adapter-0g/        # 0G Chain adapter (EVM-compatible wrapper)
│   ├── adapter-genlayer/  # GenLayer JobEscrow client + Ligis gate bridge (Agent Tank)
│   ├── contracts-genlayer/ # GenLayer JobEscrow Intelligent Contract (Studio Next, chain 61997)
│   ├── circuits-zcash/    # Noir circuit: payee-bound credential Merkle membership + nullifier
│   ├── croo-adapter/      # CROO Agent Protocol (CAP) adapter — Agent Store services
│   ├── envio-indexer/     # Envio HyperIndex for CredentialRegistry on Monad Testnet
│   ├── procurement/       # Procurement payment controller — PO-justified Airwallex payouts
│   ├── wallet-plugin/     # Guarded payment adapter — signs only on a fresh GO
│   ├── metamask-plugin/   # Ligis guarded-pay plugin for MetaMask Agent Wallet
│   ├── adapter-zcash/     # Zcash shielded presentation channel — ZcashChainAdapter, codecs, lightwalletd client
│   └── x402-server/       # Credential-gated x402 resource server (Hono + CasperAdapter)
│
├── web/                   # Next.js app — all pages chain-aware (ChainSelector + getChain(searchParams))
│   ├── app/
│   │   └── api/
│   │       ├── casper-rpc/route.ts           # stateless CORS byte-proxy → public Casper Testnet RPC
│   │       └── casper-config/route.ts        # public read for chain name + deployed package hashes
│   ├── lib/
│   │   └── casper-browser/                   # BROWSER-SIDE Casper wallet (user-funded, no relayer)
│   │       ├── keypair.ts                    # secp256k1 keygen via @noble (scalar under our control)
│   │       ├── eip712.ts                     # EIP-712 typed-data digest (same lib as server adapter)
│   │       ├── operations.ts                 # SDK mirror of @ligis/adapter-casper (mintSelf, submitCredential, anchorEvidence, verifyCapability)
│   │       ├── rpc.ts                        # JSON-RPC client over /api/casper-rpc
│   │       ├── store.tsx                     # React Context + useReducer + sessionStorage + event bus
│   │       └── steward.ts                    # browser boot → reason → gate → act → record generator
│   ├── components/
│   │   ├── ConditionalProviders.tsx          # lazy-mounts WalletTree only when chain=casper*
│   │   ├── WalletTree.tsx                    # dynamic-imported WalletProvider wrapper
│   │   ├── ConnectWallet.tsx                 # next/dynamic wrapper (ssr:false)
│   │   ├── ConnectWalletInner.tsx            # secp256k1 keypair gen + paste import UI
│   │   └── WalletGate.tsx                    # wallet entry point on /steward (five visual states)
│   └── scripts/
│       ├── smoke-wallet-crypto.ts            # @noble/curves ↔ ethers byte-identity (no Casper RPC)
│       └── smoke-wallet-tx.ts                # builds mint_self TransactionV1 and checks wire bytes (no submit)
├── assets/                # Single source of truth: networks.json, credentials.example.json
├── foundry.toml           # Foundry pointed at packages/contracts-evm/src
├── tsconfig.json          # Root project references
└── pnpm-workspace.yaml
```

## Dependency graph

```
@ligis/core               (zero chain SDKs)
   ↑
   ├── @ligis/adapter-evm     (viem)
   ├── @ligis/adapter-casper  (casper-js-sdk + @casper-ecosystem/casper-eip-712)
   ├── @ligis/zerog           (ethers + 0G SDKs)
   └── @ligis/agent-logic     (consumes ChainAdapter, Reasoner, EvidenceStore — never imports a concrete chain)
          ↑
          ├── @ligis/cli         (wires adapters by --chain flag)
          ├── @ligis/mcp-server  (wires adapters by `chain` tool argument)
          ├── @ligis/x402-server (CasperAdapter — credential-gated x402 endpoint)
          └── @ligis/web         (Next.js — imports adapter-evm + core via workspace symlinks)
```

The Trust Steward (`agent-logic`) is the centerpiece. It depends on three
interfaces from `core` and nothing else — swap the adapter and the same loop
runs on a different chain.

## ChainAdapter

Every chain adapter implements `ChainAdapter` from `@ligis/core`:

- **identity**: `getAgentId`, `issueAgentId`, `rotateAgentId`
- **credentials**: `verifyCapability`, `signCredential`, `submitCredential`, `revokeCredential`
- **evidence**: `anchorEvidence`
- **wallet**: `hasWallet`, `walletAddress`
- **metadata**: `chainId`, `chainName`, `explorerUrl`

All methods return chain-neutral JSON-safe shapes (`TxRef`, `SignedCredential`,
`VerifyResult`, ...). No `bigint`, no `viem.Hex`, no Casper SDK types leak
across the interface.

## Conventions

- **Capabilities are chain-neutral**: `capabilityHash("kyc.basic")` produces
  the same `0x...32` on every chain. The hash is the canonical id.
- **Agent identity uses DIDs**: `did:ligis:<chain-id>:<chain-native-id>`. Raw
  addresses are never stored above the adapter boundary.
- **Config is shared**: `assets/networks.json` is the source of truth for
  network endpoints + deployment addresses across all chains.

## Development

```bash
pnpm install
pnpm build                          # build all packages in dependency order
pnpm --filter @ligis/core build     # build a single package
pnpm dev                            # watch mode for all packages

pnpm --filter @ligis/cli start -- --chain evm info
pnpm --filter @ligis/mcp-server dev

pnpm test         # Solidity (Foundry)
pnpm test:ts      # TypeScript tests across packages
pnpm test:all     # both

# Casper Testnet (see docs/setup.md for full walkthrough)
pnpm setup:casper # generate 3 secp256k1 keypairs → .env.d/casper.env
pnpm deploy:casper # install WASM contracts to Casper Testnet
```

## Adding a new chain

1. Create `packages/adapter-<chain>/` with a class implementing `ChainAdapter`.
2. Add the chain branch to the `getAdapter()` switch in `packages/cli/src/index.ts` and `packages/mcp-server/src/index.ts`.
3. (Optional) Create `packages/contracts-<chain>/` for the chain's smart contracts.

The Trust Steward, policy engine, CLI surface, and MCP tools require no
changes — they consume the interface, not the implementation.
