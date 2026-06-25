# Architecture

## Contract design

Two independent contracts that compose:

```
                          ┌──────────────────────────────────────┐
                          │ AI Agent (Claude Code / Codex / ...) │
                          │ reads SKILL.md → routes to specialist │
                          └──────────────────┬───────────────────┘
                                             │ cast / cast send / MCP
                                             ▼
            ┌──────────────────────────────────────────────────────────────┐
            │                                                              │
   ┌────────▼────────┐                                       ┌─────────────▼──────────────┐
   │ PharosAgentID   │                                       │ CredentialRegistry        │
   │ (ERC-721 NFT)   │                                       │ (EIP-712 attestations)     │
   │                 │                                       │                            │
   │ mint/mintSelf   │                                       │ issue (issuer signs)       │
   │ rotate          │                                       │ revoke (issuer only)       │
   │ revoke          │                                       │ isCapable (view)           │
   │ walletOfAgent   │ ◄────── keys/identity rotation ─────► │ isCapableFromIssuer (view) │
   │ ownerOf         │                                       │ latestCredential (view)    │
   └─────────────────┘                                       │ issuerNonce (view)         │
                                                              │ hashTypedData (view)       │
                                                              └────────────────────────────┘
```

- **`PharosAgentID`** is the agent's portable identity (soulbound ERC-721, one per agent).
- **`CredentialRegistry`** is the agent's portable reputation (EIP-712 signed by third-party issuers).
- The composition is one-directional: `CredentialRegistry` doesn't know about `PharosAgentID` (small audit surface). Downstream Skills that want to enforce "the subject is a registered agent" call `PharosAgentID.walletOfAgent(subject)` AND `CredentialRegistry.isCapable(subject, capHash)`.

## Module structure

```
packages/
  core/           chain-neutral primitives (only dep: @noble/hashes)
    src/types.ts        CredentialView, SignedCredential, TxRef, Network, ...
    src/hash.ts         capabilityHash (keccak256)
    src/did.ts          did:ligis:<chain>:<id>
    src/adapter.ts      ChainAdapter interface (the boundary)
    src/reasoner.ts     Reasoner interface
    src/evidence.ts     EvidenceStore interface + manifest type
    src/config.ts       loadConfig() — reads assets/networks.json
    src/index.ts        barrel
  adapter-evm/    EVM ChainAdapter — viem stays inside this package
    src/adapter.ts      EvmAdapter (public surface)
    src/operations.ts   raw viem ops (issue/verify/sign/revoke/...)
    src/client.ts       viem ClientContext bootstrap
    src/abi.ts          Solidity ABIs
    src/address.ts      EVM address parsing
  zerog/          0G Reasoner + 0G EvidenceStore implementations
    src/compute.ts      TEE-verified LLM inference
    src/storage.ts      content-addressed evidence store
  agent-logic/    Trust Steward — depends only on @ligis/core interfaces
    src/steward.ts      boot → reason → gate → act → record
    src/policy.ts       capability gating table + reasoning prompt/parser
    src/index.ts
  cli/            thin CLI: parse args → call adapter / agent-logic
    src/index.ts
  mcp-server/     thin MCP: tools → call adapter / agent-logic
    src/index.ts
  contracts-evm/  Solidity source
    src/PharosAgentID.sol
    src/CredentialRegistry.sol
```

The Agent depends on three interfaces from `@ligis/core` (`ChainAdapter`, `Reasoner`, `EvidenceStore`) and nothing else. The CLI, MCP server, and Agent all import from `core` + `agent-logic` — exactly one implementation of each on-chain operation per chain, behind the `ChainAdapter` boundary.

## Repository layout

```
.
├── SKILL.md                        # director entry point (the file Agents read first)
├── README.md
├── docs/                           # detailed documentation
│   ├── architecture.md             # this file
│   ├── trust-steward-agent.md
│   ├── security.md
│   └── setup.md
├── LICENSE                         # MIT
├── package.json                    # root scripts (pnpm workspaces)
├── pnpm-workspace.yaml             # workspace roots: packages/* + web
├── foundry.toml                    # Solidity config (src -> packages/contracts-evm/src)
├── install.sh                      # install into Claude Code / Codex skills dir
├── MONOREPO_STRUCTURE.md           # monorepo architecture & dependency graph
├── BUILD_FLOW.md                   # build, test, deploy quick reference
│
├── assets/
│   ├── networks.json               # Pharos Atlantic + mainnet config
│   └── credentials.example.json    # starter capability list
│
├── references/                     # per-Skill command specs (what Agents read)
│   ├── issue.md, verify.md, revoke.md, rotate.md, hash.md, sign.md
│   └── composability.md
│
├── scripts/
│   ├── deploy.sh, verify.sh, demo.sh
│   ├── forge.sh                    # Foundry forge wrapper (avoids PATH shadowing)
│   └── setup-zerog.ts              # one-time 0G Compute ledger setup
│
├── packages/
│   ├── core/                       # @ligis/core — chain-neutral primitives
│   │   └── src/                    # types, hash, did, adapter, reasoner, evidence, config
│   ├── adapter-evm/                # @ligis/adapter-evm — EVM ChainAdapter
│   │   └── src/                    # adapter, operations, client, abi, address
│   ├── zerog/                      # @ligis/zerog — 0G Compute + Storage wrappers
│   │   └── src/                    # compute, storage
│   ├── agent-logic/                # @ligis/agent-logic — Trust Steward
│   │   ├── src/policy.ts           # capability gating + reasoning prompt
│   │   ├── src/steward.ts          # boot -> reason -> gate -> act -> record
│   │   └── src/index.ts
│   ├── cli/                        # @ligis/cli — ligis binary
│   │   └── src/index.ts
│   ├── mcp-server/                 # @ligis/mcp-server — MCP tools
│   │   └── src/index.ts
│   └── contracts-evm/              # Solidity source
│       ├── src/PharosAgentID.sol   # ERC-721 portable agent identity
│       └── src/CredentialRegistry.sol  # EIP-712 verifiable credential registry
│
├── test/
│   ├── PharosAgentID.t.sol         # 19 tests
│   └── CredentialRegistry.t.sol    # 22 tests (including fuzz)
│
└── script/
    └── Deploy.s.sol                # forge deployment script
```

TypeScript unit tests live alongside their package in `packages/<pkg>/test/` (e.g. `packages/agent-logic/test/{policy,steward}.test.ts`) and are picked up by `pnpm test:ts`.
