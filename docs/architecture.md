# Architecture

## Browser-side wallet (Casper Testnet, user-funded)

On Casper pages (`?chain=casper-testnet`), the web app lazy-mounts a
browser-native wallet that signs every transaction locally and submits
through a stateless CORS-proxy (`/api/casper-rpc`). No signing relayer; the
user funds their own gas from the Casper Testnet faucet.

```
                  Browser                    │   Server (Next.js)                 │   Casper Testnet
                  ─────────                   │   ────────────────                  │   ──────────────
  ┌──────────────────────────────────┐         │                                  │
  │ Web app (Next.js client)         │         │   /api/casper-rpc                 │   ┌──────────────────┐
  │   ?chain=casper-testnet          │         │   (stateless                      │   │  Casper Testnet │
  │   ConditionalProviders mounts    │  fetch  │    byte-shim —                   │   │   RPC node       │
  │   WalletTree (lazy)              │ ◄───────┤    forwards JSON-RPC             ├──►│  403 on OPTIONS  │
  │     ↓                            │         │    to upstream RPC)              │   │  blocks browser │
  │   ConnectWallet →                │         │   /api/casper-config              │   │  preflight, so   │
  │     generateKeyPair()            │         │   (public env: chain name,        │   │  proxy is the    │
  │     (@noble randomSecretKey)      │         │    AgentId +                      │   │  only bypass)    │
  │     ↓                            │         │    CredentialRegistry package    │   └──────────────────┘
  │   WalletSlot in GlobalDock        │         │    hashes)                        │           │
  │     ↓                            │         │                                  │           │
  │   StewardRunner.run()             │         │                                  │           │
  │     chain=casper + wallet.pair ──│─────────│                                  │           │
  │     → dynamic import             │   JSON  │                                  │           │
  │       web/lib/casper-browser/    │   -RPC  │                                  │           │
  │       steward.ts                 │ ◄───────┤                                  │ ◄─────────┘
  │     → mintSelf (signs in browser) │  bytes │                                  │
  │     → verifyCapability (read)    │         │                                  │
  │     → submitCredential (sign)    │         │                                  │
  │     → anchorEvidence (sign)      │         │                                  │
  │     ↓                            │         │                                  │
  │   Sign with @noble/curves         │         │                                  │
  │     secp256k1.sign(digest,priv)  │         │                                  │
  │     ─► v1.sign(pk) via sdk       │         │                                  │
  │     ─► putTransaction(JSON-RPC)  │         │                                  │
  └──────────────────────────────────┘
```

**Why this works:**
- `@noble/curves/secp256k1.sign(digest, scalar)` produces the **same `r,s,v`**
  as `ethers.Wallet.signingKey.sign`, so the browser-signed EIP-712
  credential digest recovers on chain (via Casper's native `k256` recovery) to
  the **same EVM address** as the server's keystore would produce. Verified
  by `web/scripts/smoke-wallet-crypto.ts`.
- `casper-js-sdk@5.0.12` `TransactionV1Payload.build` + Custom entry-point
  serializes the entry-point NAME onto the wire. Without this, every deploy
  hits the contract with `Call` (the default method) instead of `mint_self`.
  Verified by `web/scripts/smoke-wallet-tx.ts`.
- The CORS-proxy is stateless: holds no keys, has no signing power, just
  forwards JSON-RPC envelopes. Open browser preflight (OPTIONS) is the reason
  this is needed at all — the public Casper RPC returns 403 on preflight.

**Files in `web/lib/casper-browser/`:**
- `keypair.ts` — secp256k1 keygen/derive, `secp256k1.utils.randomSecretKey()` → `PrivateKey.fromHex(scalar)` (the SDK doesn't expose the secret scalar)
- `eip712.ts` — EIP-712 typed-data digest construction (same library the server uses, so digests are byte-identical)
- `operations.ts` — SDK-typed mirror of `@ligis/adapter-casper` operations; builds TransactionV1 + StoredTarget + invokes `account_put_transaction`
- `rpc.ts` — JSON-RPC client over the stateless CORS-proxy
- `store.tsx` — React Context + `useReducer`, persisted to `sessionStorage`, with a module-scoped event-emitter bus
- `steward.ts` — browser-side `boot → reason → gate → act → record` generator, event-compatible with the existing `StewardRunner.tsx` reducer

`web/components/ConditionalProviders.tsx` + `WalletTree.tsx` lazy-mount the
provider only when `?chain=casper*` is present (Pharos pages never load
casper-js-sdk).

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
  contracts-casper/  Odra + Rust source
    src/agent_id.rs
    src/credential_registry.rs
```

The Agent depends on three interfaces from `@ligis/core` (`ChainAdapter`, `Reasoner`, `EvidenceStore`) and nothing else. The CLI, MCP server, and Agent all import from `core` + `agent-logic` — exactly one implementation of each on-chain operation per chain, behind the `ChainAdapter` boundary.

### Web frontend (Next.js)

```
web/
  app/
    api/
      casper-rpc/route.ts       stateless CORS byte-proxy → public Casper RPC
      casper-config/route.ts    public read for chain name + package hashes
      agent/[address]/page.tsx  chain-aware agent profile
      steward/page.tsx          live steward loop
      ...
    lib/
      chain.ts                  EVM read layer (viem + Pharos contracts)
      chain-casper.ts           Casper read layer (CasperAdapter + block scan)
      chain-router.ts           unified dispatch on chain.kind
      web/lib/casper-browser/   BROWSER-SIDE WALLET for user-funded flow:
        keypair.ts              secp256k1 scalar + PrivateKey + EVM address derive
        eip712.ts               EIP-712 digest (same lib as server)
        operations.ts           CasperAdapter mirror via casper-js-sdk TransactionV1
        rpc.ts                  JSON-RPC client over /api/casper-rpc
        store.tsx               Context + useReducer + sessionStorage + event bus
        steward.ts              browser boot→reason→gate→act→record generator
      steward.ts                EVM steward loop (server path)
      steward-casper.ts         Casper steward loop (server path, Node-side)
    components/
      ConditionalProviders.tsx  lazy mount on Casper pages
      WalletTree.tsx            dynamic-imported WalletProvider
      ConnectWallet[Inner].tsx  secp256k1 keypair gen + paste import UI
      WalletSlot.tsx            shows wallet state in GlobalDock
      StewardRunner.tsx         unified flow for both chains
  scripts/
    smoke-wallet-crypto.ts      byte-equality between @noble/curves and ethers
    smoke-wallet-tx.ts          TransactionV1 encoding check (no submit)
```

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
