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
src/
  lib/        SSOT — on-chain primitives shared by CLI, MCP, and Agent
    client.ts    viem client bootstrap
    identity.ts  issue/verify/revoke/rotate/sign + getAgentId/submitCredential/updateTokenUri
    abi.ts  types.ts  util.ts  index.ts
  zerog/      0G integration — the "real work"
    compute.ts   0G Compute broker: TEE-verified inference (the brain)
    storage.ts   0G Storage: agent state + credential evidence (anchored on-chain)
  agent/      autonomous Trust Steward
    steward.ts   boot → reason(0G) → gate(isCapable) → act → record(0G)
    policy.ts    capability → action gating table + reasoning prompt/parser
  cli/index.ts   thin: parse args → call lib/agent
  mcp/server.ts  thin: tools → call lib/agent
```

The Agent **reuses** `lib/identity` rather than re-implementing chain logic. CLI, MCP, and Agent all import from `lib` — exactly one implementation of each on-chain operation across all three surfaces.

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
├── package.json
├── foundry.toml
├── install.sh                      # install into Claude Code / Codex skills dir
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
├── src/
│   ├── PharosAgentID.sol           # ERC-721 portable agent identity
│   ├── CredentialRegistry.sol      # EIP-712 verifiable credential registry
│   ├── lib/                        # SSOT — shared on-chain primitives
│   ├── zerog/                      # 0G Compute + Storage integration
│   ├── agent/                      # Trust Steward Agent
│   ├── mcp/server.ts               # MCP server (7 tools)
│   └── cli/index.ts                # CLI (ligis)
│
├── test/
│   ├── PharosAgentID.t.sol         # 19 tests
│   ├── CredentialRegistry.t.sol    # 22 tests (including fuzz)
│   └── ts/                         # TypeScript unit tests (node:test)
│
└── script/
    └── Deploy.s.sol                # forge deployment script
```
