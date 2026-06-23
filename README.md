# Ligis

> **Portable on-chain identity and verifiable credentials for agents on the Pharos Network.**
>
> Built for the [Pharos Skill-to-Agent Dual Cascade Hackathon](https://dorahacks.io/hackathon/pharos-phase1) — Phase 1 (Skill Hackathon).
>
> 41 Foundry tests passing (including fuzz tests). 6 reference docs. 4 on-chain Skills + 2 helpers. MCP server. CLI. Director-routing `SKILL.md`. MIT.

---

## What this is

**Ligis** is the portable identity and credential layer for AI agents on the Pharos Network. It ships as four on-chain **Skills** that other agents and contracts can compose:

| Skill | What it does | On-chain action |
|---|---|---|
| `ligis-issue` | Mint a portable Agent ID NFT; issue an EIP-712 capability credential | `PharosAgentID.mintSelf/mint`, `CredentialRegistry.issue` |
| `ligis-verify` | Read-only check: does a subject hold a valid credential for a capability? | `CredentialRegistry.isCapable` |
| `ligis-revoke` | Issuer revokes a previously-issued credential | `CredentialRegistry.revoke` |
| `ligis-rotate` | Move the Agent ID to a new controller key (compromised-key recovery) | `PharosAgentID.rotate` |

Plus two helpers:

| Helper | What it does |
|---|---|
| `ligis-hash` | `keccak256("agent.commerce.escrow")` → `0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8` |
| `ligis-sign` | Issuer-side helper: build and sign an EIP-712 credential off-chain |

## Why this matters

Every other Phase 1 Skill in the hackathon (Aegis, FaroLink, Maestro, Pact, Pharos NFT Manager, AgentFOS) has the same hidden problem: **the agent's identity is implicit**. The wallet holds the key, the key holds the funds, and the Skill trusts the wallet.

This Skill makes identity **explicit, portable, and rotatable**:

- **Explicit** — the agent has an on-chain `PharosAgentID` NFT bound to its controller wallet. Look it up via `walletOfAgent(addr)`.
- **Portable** — credentials are EIP-712 signed off-chain by the issuer (a KYC provider, a DAO, a marketplace operator) and stored on-chain. They survive across Skills: a single `kyc.basic` credential is recognized by Aegis, FaroLink, and Maestro without re-KYCing.
- **Rotatable** — when a key is compromised, the agent calls `rotate()` to move the ID NFT to a new controller. The ID NFT is preserved, but wallet-bound credentials do not automatically follow; issuers should re-issue any required credentials to the new controller.
- **Composable** — `CredentialRegistry.isCapable(subject, capHash)` is a `view` call that any contract can use to gate access. One line of Solidity: `require(creds.isCapable(payer, KYC_HASH), "not KYCed")`.

## What's deployed

Both contracts are live on **Pharos Atlantic testnet** (chainId 688689):

| Contract | Address | Pharos Scan |
|----------|---------|-------------|
| `PharosAgentID` | `0xBAab32536368bBD97BD9410CCE6b7d075CdcAcF8` | [View](https://atlantic.pharosscan.xyz/address/0xBAab32536368bBD97BD9410CCE6b7d075CdcAcF8) |
| `CredentialRegistry` | `0xf583421A8e11aEB42d26798F285dc590A992e488` | [View](https://atlantic.pharosscan.xyz/address/0xf583421A8e11aEB42d26798F285dc590A992e488) |

Deploy with `bash scripts/deploy.sh atlantic` (requires testnet PHRS in the deployer
wallet). The source of truth for chain config and deployment addresses is
`assets/networks.json` (the `deployment.atlantic-testnet` block).

## Repository layout

```
.
├── SKILL.md                        # director entry point (the file Agents read first)
├── README.md                       # you are here
├── LICENSE                         # MIT
├── package.json                    # Node CLI + MCP server
├── tsconfig.json
├── foundry.toml                    # Foundry config (Pharos Atlantic + mainnet)
├── remappings.txt
├── install.sh                      # install into Claude Code / Codex skills dir
│
├── assets/
│   ├── networks.json               # Pharos Atlantic + mainnet config
│   ├── credentials.example.json    # starter capability list
│   └── deployment.json             # filled in by scripts/deploy.sh
│
├── references/                     # per-Skill command specs (what Agents read)
│   ├── issue.md
│   ├── verify.md
│   ├── revoke.md
│   ├── rotate.md
│   ├── hash.md
│   └── sign.md
│
├── scripts/
│   ├── deploy.sh                   # forge script Deploy.s.sol → writes assets/deployment.json
│   ├── verify.sh                   # submit source for verification on Pharos Scan
│   └── demo.sh                     # end-to-end mint → issue → verify → revoke → rotate
│
├── src/
│   ├── PharosAgentID.sol           # ERC-721 portable agent identity
│   ├── CredentialRegistry.sol      # EIP-712 verifiable credential registry
│   ├── mcp/server.ts               # MCP server (6 tools)
│   └── cli/index.ts                # CLI (ligis)
│
├── test/
│   ├── PharosAgentID.t.sol         # 19 tests (including Transfer events + safeTransferFrom)
│   └── CredentialRegistry.t.sol    # 22 tests (including fuzz tests + exact nonce)
│
└── script/
    └── Deploy.s.sol                # forge deployment script
```

## Quick start (deployed)

If the contracts are already deployed (the `assets/deployment.json` has real addresses):

```bash
# Install
./install.sh

# Mint an Agent ID for the current wallet
PRIVATE_KEY=0x<YOUR_TESTNET_PRIVATE_KEY> npx tsx src/cli/index.ts issue --token-uri "ipfs://bafy.../meta"

# Verify a credential (read-only)
npx tsx src/cli/index.ts verify --subject 0x<SUBJECT_WALLET_ADDRESS> --capability "agent.commerce.escrow"

# Sign and submit a credential (issuer-side)
PRIVATE_KEY=0x<YOUR_TESTNET_PRIVATE_KEY> npx tsx src/cli/index.ts sign \
  --issuer-key 0x<YOUR_TESTNET_PRIVATE_KEY> \
  --subject 0x<SUBJECT_WALLET_ADDRESS> \
  --capability "agent.commerce.escrow" \
  --expires-in 2592000
```

## Quick start (from scratch)

```bash
# 1. Install Foundry (skip if you have it)
curl -L https://foundry.paradigm.xyz | bash && source ~/.zshenv && foundryup

# 2. Install Node deps
npm install

# 3. Get testnet PHRS from the Pharos Atlantic faucet
#    https://atlantic.pharosscan.xyz (look for the Faucet tool)
#    or ask in the Pharos Discord / Telegram

# 4. Set your private key
export PRIVATE_KEY=0x<YOUR_TESTNET_PRIVATE_KEY>   # your testnet wallet, NEVER commit this

# 5. Build and test
forge build
forge test -vvv
npx tsc

# 6. Deploy
bash scripts/deploy.sh atlantic

# 7. Verify on Pharos Scan
export SOCIALSCAN_API_KEY=...   # get from https://etherscan.io/apis
bash scripts/verify.sh atlantic

# 8. Run the end-to-end demo
bash scripts/demo.sh

# 9. (Optional) Install the skill into Claude Code / Codex
./install.sh
```

## Architecture

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

The two contracts are **independent** but **compose**:
- The `PharosAgentID` is the agent's portable identity.
- The `CredentialRegistry` is the agent's portable reputation (signed by third-party issuers).
- A downstream Skill (e.g., Aegis) gates a function on `isCapable(buyer, KYC_BASIC)`. The agent's identity is implicit in `buyer`'s controller.

The composition is one-directional: `CredentialRegistry` doesn't know about `PharosAgentID` (so its surface is small and audit-friendly). Downstream Skills that want to enforce "the subject is a registered agent" call `PharosAgentID.walletOfAgent(subject)` AND `CredentialRegistry.isCapable(subject, capHash)`.

## Security model

Both contracts are **non-custodial**. They never hold funds. They never call external contracts on write paths. There is **no admin, no owner, no backdoor**:

- `PharosAgentID.mint/rotate/revoke` is gated on the controller being the caller.
- `CredentialRegistry.issue` is permissionless: anyone can submit a signed attestation, but only the issuer's signature passes the EIP-712 check.
- `CredentialRegistry.revoke` is gated on `msg.sender == issuer`.

EIP-712 replay protection: `DOMAIN_SEPARATOR` binds `chainId` and the `CredentialRegistry` address, and each `(issuer, nonce)` is monotonic.

CertiK pre-scan: the Skill package invokes only documented `cast`/`forge` commands, reads no secrets, makes no unauthorized network/shell/filesystem calls. Verified against the same scanner the Aegis team passed.

## Hackathon judging-criteria mapping

| Criterion | How this Skill addresses it |
|-----------|-----------------------------|
| **Originality** | No other Phase 1 submission is shipping a portable identity + credential layer. Aegis/Warden/Maestro/Pact/Pharos NFT Manager are all payment rails; this is the missing trust substrate. |
| **Technical quality** | 41 Foundry tests (including fuzz tests), 100% pass; 0 OpenZeppelin deps (minimal, auditable Solidity); ERC-721 Transfer event compliance; `safeTransferFrom` receiver safety; bounded credential registry scans; EIP-712 replay protection. |
| **Practical use** | Every other Skill in the field can call `isCapable(subject, capHash)` in one line of Solidity. This is the **glue** that makes the agent economy work. |
| **Reusability** | 4 composable Skills + 2 helpers, each independently usable. Director pattern in `SKILL.md` makes routing obvious for AI agents. |
| **Deployed on Pharos** | Both contracts deployed to Atlantic (chain 688689), verified via the socialscan API. |
| **Documentation** | Director entry point + 6 reference docs with `cast` command templates, error tables, and integration patterns. README with quickstart. |
| **Pharos alignment** | Direct support for the AI Agent economy thesis: portable identity, portable credentials, key rotation, no admin. Phase 2 (Agent Arena) composes directly: a Procurement Steward Agent uses this Skill to verify counterparties before engaging Aegis / FaroLink / Maestro. |

## Phase 2 — Trust Steward Agent (Agent Arena + 0G)

Phase 2 builds **one Agent** that qualifies for both the Pharos Agent Arena and the
0G AI-native tournament. The Agent is the **Trust Steward**: an autonomous agent
whose natural-language → capability reasoning runs as an LLM call on **0G Compute**
(TEE-verified inference; the attestation is captured and recorded as evidence) and
whose state and credential evidence live on **0G Storage**, gated end-to-end by
this Skill's on-chain identity and credentials.

> **0G does real work (not a bolt-on).** The goal→capability mapping is performed
> by an LLM running on 0G Compute, not by a hardcoded lookup — the TEE attestation
> is captured and recorded as evidence. Remove 0G Compute and the Agent loses its
> reasoning step; remove 0G Storage and it loses its verifiable evidence store.
> Either way it cannot complete the loop.

### Steward loop

1. **Boot** → `mintSelf` its own `PharosAgentID`.
2. **Take a natural-language goal** (e.g. "open an escrow with counterparty X").
3. **Reason on 0G Compute** → map the goal to the required capabilities.
4. **Gate on-chain** → `isCapable(subject, cap)` via this Skill before any action.
5. **Act** → execute one on-chain vertical. The primary demo path is
   **self-contained**: the Steward issues itself a capability credential, gates a
   self-test action via `isCapable`, then records it — no external contract
   dependency. Composing with another team's escrow / x402 on Atlantic is a stretch
   goal, not the demo path.
6. **Record** → write the decision + evidence manifest to 0G Storage; anchor its
   root hash on-chain via the Agent's `tokenURI` (no contract change required).

### Architecture (domain-driven, built on `src/lib` as the single source of truth)

```
src/
  lib/        SSOT — on-chain primitives shared by CLI, MCP, and the Agent
    client.ts    viem client bootstrap (consolidated from CLI + MCP)
    identity.ts  issue/verify/revoke/rotate/sign (consolidated from CLI + MCP)
    abi.ts  types.ts  util.ts  index.ts
  zerog/      0G integration — the "real work"
    compute.ts   0G Compute broker: TEE-verified inference (the brain)
    storage.ts   0G Storage: agent state + credential evidence (anchored on-chain)
  agent/      autonomous Trust Steward
    steward.ts   boot → reason(0G) → gate(isCapable) → act → record(0G)
    policy.ts    capability → action gating table (single source)
  cli/index.ts   thin: parse args → call lib/agent
  mcp/server.ts  thin: tools → call lib/agent
```

The Agent **reuses** `lib/identity` rather than re-implementing chain logic; the
CLI and MCP server are refactored to share the same `lib` functions first
(consolidation), so there is exactly one implementation of each on-chain
operation across all three surfaces.

### 0G dependencies (verified)

| Layer | Package | Notes |
|-------|---------|-------|
| Compute | `@0glabs/0g-serving-broker` | Programmatic serving-broker SDK for TEE-verified inference. One-time setup via `0g-compute-cli` (login → deposit → acknowledge-provider). |
| Storage | `@0gfoundation/0g-ts-sdk` (v1.2.1) | 0G Storage SDK for uploading/retrieving agent state and evidence manifests. |

> `@0gfoundation/0g-cc` is an **MCP server**, not an importable library — it is
> not used as a dependency. The Agent calls the underlying SDKs directly.

### Build phases

| Phase | Work | Verification |
|-------|------|--------------|
| 0 | Consolidate CLI + MCP on-chain ops into `lib/client.ts` + `lib/identity.ts`; delete duplicates | `forge test`, `npx tsc`, live CLI run |
| 1 | `zerog/compute.ts` — TEE-verified inference as the Agent's brain | mocked unit test + live inference |
| 2 | `zerog/storage.ts` — agent state/evidence on 0G Storage, root in `tokenURI` | mocked unit test + live upload/retrieve |
| 3 | `agent/steward.ts` + `agent/policy.ts` — full loop, self-contained vertical (self-issue → `isCapable` gate → record) on Atlantic | end-to-end demo run |
| 4 | `agent run` CLI cmd + `run-steward` MCP tool; `node:test` units (new second runner alongside `forge`); Pharos Scan verify badge | full suite |

### Design constraints (Core Principles)

- **Enhancement first / DRY** — consolidate shared ops into `lib` and delete the
  CLI/MCP duplicates before adding the Agent; no third copy of chain logic.
- **No contract changes** — 0G Storage is anchored via the existing `tokenURI` /
  `MetadataUpdated` path, so the 41 Foundry tests stay green.
- **Clean / modular** — `zerog` and `agent` are independent domains depending only
  on `lib`; 0G clients sit behind interfaces so they are testable offline.
- **Testable** — `forge test` for contracts (41 tests); `node:test` for `zerog/`
  and `agent/` (clients behind interfaces, mocked offline — a new second runner
  alongside Foundry).
- **Performant** — reuse one viem client and one 0G broker/account; cache provider
  metadata and 0G Storage retrievals by root hash.

## License

MIT — see [LICENSE](./LICENSE).
