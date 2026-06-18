# Pharos Agent Identity Skill

> **Portable on-chain identity and verifiable credentials for agents on the Pharos Network.**
>
> Built for the [Pharos Skill-to-Agent Dual Cascade Hackathon](https://dorahacks.io/hackathon/pharos-phase1) — Phase 1 (Skill Hackathon).
>
> 41 Foundry tests passing (including fuzz tests). 6 reference docs. 4 on-chain Skills + 2 helpers. MCP server. CLI. Director-routing `SKILL.md`. MIT.

---

## What this is

The **Pharos Agent Identity Skill** is the portable identity and credential layer for AI agents on the Pharos Network. It ships as four on-chain **Skills** that other agents and contracts can compose:

| Skill | What it does | On-chain action |
|---|---|---|
| `pharos-agent-identity-issue` | Mint a portable Agent ID NFT; issue an EIP-712 capability credential | `PharosAgentID.mintSelf/mint`, `CredentialRegistry.issue` |
| `pharos-agent-identity-verify` | Read-only check: does a subject hold a valid credential for a capability? | `CredentialRegistry.isCapable` |
| `pharos-agent-identity-revoke` | Issuer revokes a previously-issued credential | `CredentialRegistry.revoke` |
| `pharos-agent-identity-rotate` | Move the Agent ID to a new controller key (compromised-key recovery) | `PharosAgentID.rotate` |

Plus two helpers:

| Helper | What it does |
|---|---|
| `pharos-agent-identity-hash` | `keccak256("agent.commerce.escrow")` → `0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8` |
| `pharos-agent-identity-sign` | Issuer-side helper: build and sign an EIP-712 credential off-chain |

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
│   └── cli/index.ts                # CLI (pharos-agent-identity)
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

## Phase 2 preview (Agent Arena)

A Procurement Steward Agent (per OoJae's Aegis Phase 2 plan) would:
1. **Mint its own `PharosAgentID`** on first boot.
2. **Discover required capabilities** for the user (e.g., "I want to trade DEXs, swap tokens, and bridge to Arbitrum").
3. **Walk the issuer list** (KYC provider, RWA registry, marketplace operator) and submit signed attestations via `CredentialRegistry.issue`.
4. **Before any Aegis / FaroLink / Maestro action**, call `isCapable(...)` to gate.
5. **On user request**, call `rotate(...)` to migrate to a hardware wallet or Safe multi-sig.

This Skill is the **onboarding flow** that makes the Phase 2 demo runnable.

## License

MIT — see [LICENSE](./LICENSE).
