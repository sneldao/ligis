# Ligis — BUIDL Submission Draft

> Copy/paste this into the DoraHacks BUIDL form for the
> **Pharos Skill-to-Agent Dual Cascade Hackathon (Phase 1)**.
> Submission URL: https://dorahacks.io/hackathon/pharos-phase1/buidl

---

## Title

**Ligis** — on-chain agent ID + EIP-712 capability credentials, on Atlantic testnet

## Tagline (one-liner)

Give every AI agent a portable, revocable identity and signed capability
attestations, on Pharos Atlantic — so the rest of the agent economy can finally
ask "who are you, and who vouches for that?"

## Track

- [x] Pharos Skill Engine
- [x] Agent & x402 (composability)

## Repo

`https://github.com/sneldao/pharos-agent-identity`

## Live demo (Loom / YouTube)

`<Loom URL>` (record after deploy)

## Deployed contracts (Pharos Atlantic testnet — live)

- **PharosAgentID** (ERC-721 soulbound-style): `0xBAab32536368bBD97BD9410CCE6b7d075CdcAcF8`
  - Deploy tx: `0x9d9577900e7328f6eb71f2c9d6bc92e18ffbdf23d34d6a9a3efdc659e56b6105`
  - Block: 24369310 (2026-06-17 05:52:31 UTC)
  - Pharos Scan: https://atlantic.pharosscan.xyz/address/0xBAab32536368bBD97BD9410CCE6b7d075CdcAcF8
- **CredentialRegistry** (EIP-712 attestations): `0xf583421A8e11aEB42d26798F285dc590A992e488`
  - Deploy tx: `0x559824557548e16366412ece341a507b2fad27064a9fe85567bd506bbc68c9b9`
  - Block: 24369311 (2026-06-17 05:52:33 UTC)
  - Pharos Scan: https://atlantic.pharosscan.xyz/address/0xf583421A8e11aEB42d26798F285dc590A992e488
- **Source verification**: pending. The Pharos Atlantic explorer uses a socialscan API endpoint
  that returned `{"detail": "Not Found"}` at submission time (2026-06-17). The contracts are
  functionally verified via the 35 Foundry unit tests; the on-chain source-verification badge
  can be added by re-running `bash scripts/verify.sh atlantic` once the socialscan service is
  back online (same Etherscan-family flow, requires `SOCIALSCAN_API_KEY` in env).

## End-to-end demo txs (executed live on Atlantic)

The full `scripts/demo.sh` flow ran on the live testnet:

| Step | Action | Tx hash | Result |
|------|--------|---------|--------|
| 1 | `mintSelf` for the demo subject | `0x88dd4d47bb1fcde8f8f00500d630b653a2c38a4f0410b52b364ff49367036cda` | tokenId 1 minted |
| 2 | `issue` (EIP-712) for `agent.commerce.escrow` | `0x5998675b5fee8168ef16356ff188f33165a8c2f5aa9e8129d8470a1c0ebf4e9a` | CredentialIssued |
| 3 | `isCapable(subject, capability)` | view call | `true` |
| 4 | `revoke` (issuer action) | `0x80cdb76d536a837927a0a56886533a9671542c67d1b9654ce1aa6d7559f9143b` | CredentialRevoked |
| 5 | `isCapable(subject, capability)` | view call | `false` |
| 6 | `rotate(tokenId, newController)` | `0xdaa74640c505c2b6c4ad0c848875beeb5a153c9494bcfb6e50b6fd511b908484` | ownerOf(1) = newController |

## Deployer wallet (for reference)

`0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec` — used to broadcast all six demo txs. Key is in
`.env.d/deployer.env` (gitignored). This wallet is NOT a hot wallet, do not reuse for mainnet.

## Category

**Agent Identity & Credentials** (uncommon in the field, foundation for other Skills)

## Description (long-form, ~600 words)

### Problem

Every other Skill in the hackathon asks "is this agent allowed to do X?" and
answers with nothing. There is no portable, on-chain way for a Pharos agent
to say *who* it is, *which wallet controls it*, and *who vouches for which
capability*. Without that, escrow, KYC, accredited-investor gating, rate
limits, and reputation are all built on a trust-me-bro foundation.

### What we built

A two-contract Skill that gives every Pharos agent:

1. **A portable, soulbound Agent ID** — an ERC-721 NFT minted to a controller
   address, with no transfer approvals and a one-way `rotate()` for key
   recovery. The same agent identity survives wallet migrations.

2. **EIP-712 capability credentials** — third-party issuers (KYC provider,
   marketplace, regulator) sign off-chain attestations of the form
   `(issuer, subject, capability, expiresAt, nonce)`. The `CredentialRegistry`
   verifies the signature and stores the credential. A second
   `isCapable(subject, capability)` view checks the *latest* valid credential
   for that pair, including revocation.

### Why this matters for the Dual Cascade

Phase 2's bounty payout and x402 stack all want to gate flows by agent
identity. Aegis (escrow), Pact (cross-chain), Farolink (data feeds), and the
x402 facilitators in the hackathon all currently use
"wallet address as identity" — which breaks the moment a key rotates, and
which has no way to revoke a leaked wallet. This Skill is the missing trust
layer.

### What's actually shipped

- **2 Solidity contracts** (`PharosAgentID.sol`, `CredentialRegistry.sol`)
  on Pharos Atlantic (chainId 688689), 100% Foundry test coverage (41 tests, including fuzz tests).
- **CLI** (`dist/cli/index.js`): 8 commands (info, hash, issue, verify, revoke,
  rotate, sign, agent run) — every command prints JSON for downstream Skills to consume.
- **MCP server** (`dist/mcp/server.js`): 7 tools that an agent can call
  directly from Claude Code or any MCP-aware IDE.
- **Trust Steward Agent** (`src/agent/`): an autonomous agent that runs the full
  loop — boot (mint Agent ID) → reason (0G Compute TEE-verified LLM maps a
  natural-language goal to required capabilities) → gate (`isCapable`) → act
  (self-issue missing credentials) → record (write evidence manifest to 0G
  Storage, anchor the Merkle root on-chain via `setTokenURI`). 17 TypeScript
  unit tests (node:test) with mocked clients verify the full loop offline.
- **0G integration** (`src/zerog/`): `compute.ts` wraps the 0G Compute serving
  broker for TEE-verified inference; `storage.ts` wraps the 0G Storage SDK for
  verifiable evidence storage. Both sit behind interfaces (`Reasoner`,
  `EvidenceStore`) so the agent is testable offline.
- **Shared library** (`src/lib/`): single source of truth for all on-chain
  operations — `issueId`, `verify`, `revoke`, `rotate`, `signCredential`,
  `getAgentId`, `submitCredential`, `updateTokenUri`. CLI, MCP, and Agent all
  import from here (no duplicated chain logic).
- **SKILL.md + 7 references** (issue/verify/revoke/rotate/hash/sign/composability) following
  the Pharos Skill Engine's director pattern. The composability reference is the
  integration playbook for Aegis, Pact, FaroLink, Maestro, and x402 facilitators.
- **install.sh** that wires the CLI + MCP into Claude Code and Codex in 30 s.
- **bash scripts** (deploy, verify, demo) that go from `git clone` to a
  live demo on Atlantic testnet in under 5 minutes.

### Composability with the other Skills

Every Phase 1 Skill in the hackathon needs the same answer to the same
question: "should this agent be allowed to do X?" Today, every Skill
implements its own ad-hoc allowlist. With this Skill, the answer is one
external call:

```solidity
require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed");
```

- **Aegis** (escrow, BUIDL 45339) → check `isCapable(counterparty, "agent.commerce.escrow")`
  before opening an escrow; the registry can revoke a compromised counterparty
  without touching open escrows. See `references/composability.md` for the 3-line
  Aegis contract patch.
- **Pact** (cross-chain, BUIDL 45334) → bind an agent ID on each chain to the same
  off-chain DID; the registry's `DOMAIN_SEPARATOR` is chain-specific so a signed
  attestation is non-replayable across chains.
- **FaroLink** (data feeds) → gate premium feeds behind
  `isCapable(subscriber, "data.premium")` and RWA swaps behind
  `isCapable(trader, "rwa.accredited")`.
- **Maestro** (recurring mandates) → recurring mandate flows need
  `isCapable(payer, "agent.commerce.recurring")`.
- **Any x402 facilitator** (Phase 2) → check
  `isCapable(payer, "agent.commerce.x402")` before signing a 402 challenge.

The dual cascade works like this: the **identity cascade** is this Skill
(the registry + the agent ID). The **commerce cascade** is Aegis/Pact/FaroLink
calling `isCapable(subject, capabilityHash)` to gate their flows. With this
Skill shipping, the other 5+ Phase 1 Skills can stop re-implementing access
control and start composing.

### Final hardening pass (post-review)

After an internal audit, the following improvements were applied without changing any public function signatures:

- **ERC-721 compliance**: `PharosAgentID` now emits standard `Transfer` events on `mint`, `rotate`, `revoke`, and `transferFrom`, making the NFT fully trackable by indexers, marketplaces, and wallet UIs.
- **`safeTransferFrom` safety**: Added `IERC721Receiver` checks so transfers to contracts that do not implement `onERC721Received` revert cleanly (previously it was just a passthrough to `transferFrom`).
- **ABI event alignment**: The TypeScript ABI (`src/lib/abi.ts`) now matches the exact Solidity event names (`AgentMinted`, `AgentRotated`, `AgentRevoked`, `MetadataUpdated`), fixing silent event-decoding failures.
- **Bounded registry scans**: `CredentialRegistry.revoke` now scans at most 50 nonces when recomputing the latest valid credential, preventing unbounded gas griefing. `latestCredential` and `getCredential` no longer iterate backward — they use O(1) existence flags and exact nonce lookups.
- **O(1) issuer-specific checks**: `isCapableFromIssuer` now reads from a per-issuer latest-valid nonce tracker instead of iterating backward, making it safe for on-chain callers.
- **Fuzz tests**: Added 3 Foundry fuzz tests covering valid signature issuance, wrong-nonce rejection, and revocation edge cases (256 runs each).
- **Documentation fix**: `SKILL.md` and `README.md` now correctly state that credentials are wallet-bound and must be re-issued after key rotation.
- **Capability hashes**: `assets/credentials.example.json` now contains actual `keccak256` hashes instead of placeholder values.

### Security posture

- Soulbound: `setApprovalForAll`, `approve`, and `transferFrom` to non-owners
  are blocked. The only way to change controller is `rotate(tokenId, newAddr)`.
- Replay protection: every credential has an issuer-scoped nonce; `issue`
  reverts on duplicates.
- Cross-chain safety: `DOMAIN_SEPARATOR` mixes the chainId, so a signed
  attestation for Atlantic can't be replayed on mainnet.
- Revocation: only the original issuer can revoke; revocation is
  irreversible; `isCapable` correctly handles the "newer valid credential
  exists" case.

### What's intentionally NOT in scope (Phase 2 candidates)

- Smart-account issuers (the registry today expects an EOA signer; a
  Safe-module wrapper is the obvious Phase 2 add).
- Zero-knowledge capability proofs (a user can already prove "I have a
  valid `kyc.accredited` credential" by showing a Merkle path; this is a
  Halo2 / Noir follow-up).
- On-chain reputation scoring (we expose the raw data; Aegis/Pact can
  build the score).
- Phase 1 → mainnet migration script is included as a one-liner
  (`./scripts/deploy.sh mainnet` once we have a mainnet deployer key).
- ENS / off-chain identity bridging: agent metadata can resolve an ENS name
  for human-readable issuer identification; web3.bio and similar services can
  enrich agent profiles with social reputation without touching the on-chain
  credential layer.

## Demo script (60–90s Loom)

```
# 0:00  Intro: "Every agent economy needs an identity layer. Today we ship
        one for Pharos Atlantic."

# 0:10  Show the live contracts on Pharos Scan
open https://atlantic.pharosscan.xyz/address/<PharosAgentID>

# 0:20  In a terminal:
PRIVATE_KEY=$PHAROS_DEPLOYER_KEY node dist/cli/index.js info
        → shows the live addresses

# 0:30  Mint an Agent ID for a fresh wallet
node dist/cli/index.js issue --token-uri "ipfs://demo-agent"
        → returns {tokenId: 1, txHash: "0x..."}

# 0:40  Sign a capability off-chain
node dist/cli/index.js sign --issuer-key $ISSUER_KEY \
    --subject 0x... --capability "agent.commerce.escrow" --expires-in 3600
        → prints the EIP-712 envelope with submitCommand

# 0:50  Submit the credential on-chain (the `cast send` line from the envelope)
        → returns the CredentialIssued event with a Pharos Scan link

# 1:00  Verify
node dist/cli/index.js verify --subject 0x... --capability "agent.commerce.escrow"
        → capable: true, valid: true

# 1:10  Revoke (issuer action)
node dist/cli/index.js revoke --subject 0x... --capability "agent.commerce.escrow" --nonce 0
        → returns CredentialRevoked

# 1:20  Re-verify
node dist/cli/index.js verify --subject 0x... --capability "agent.commerce.escrow"
        → capable: false (latest credential is revoked)

# 1:30  Show the same flow in an MCP-aware IDE (Claude Code or Cursor) calling
        the issue-id, sign-credential, and verify tools
```

## License

MIT

## Team

Solo submitter: `<your name>`

## Bounty alignment

- **Skill Engine** — full SKILL.md + 6 references + install.sh + 2 contracts
  following the Pharos Skill Engine director pattern.
- **Agent & x402** — a foundational identity layer that x402 facilitators
  can compose with.
- **Composability with other Skills** — Aegis, Pact, Farolink can all call
  `isCapable(subject, capabilityHash)` in their flow.

## Submission checklist

- [x] 2 Solidity contracts (ERC-721 + EIP-712 registry)
- [x] 41/41 Foundry tests passing (including fuzz tests)
- [x] 17/17 TypeScript unit tests passing (node:test, mocked clients)
- [x] Solidity 0.8.24, no warnings, optimizer on
- [x] Deployed to Pharos Atlantic testnet (chainId 688689) — see tx hashes above
- [ ] Source verified on Pharos Scan (socialscan API returned 404 at submission; re-run `bash scripts/verify.sh atlantic` once it's back)
- [x] CLI: 8 commands, JSON output — verified live on Atlantic
- [x] MCP server: 7 tools (including `ligis-run-steward`)
- [x] Trust Steward Agent: full loop (boot → reason → gate → act → record) with 0G Compute + 0G Storage
- [x] Shared library (`src/lib/`): single source of truth for CLI, MCP, and Agent
- [x] SKILL.md + 7 references
- [x] install.sh (Claude Code + Codex)
- [x] Bash deploy/verify/demo scripts (all `bash -n` clean, demo executed end-to-end on Atlantic)
- [x] End-to-end demo runs in < 5 minutes from `git clone` — verified (mint → issue → verify → revoke → verify → rotate)
- [x] README with architecture diagram
- [x] Pre-commit secret-scan hook (gitleaks 8.30.1 + pure-bash fallback)
- [x] 100% of secrets in `.env.d/`, gitignored
- [x] Git initialized, initial commit created
- [ ] Loom demo (record from the tx hashes above)
- [ ] GitHub repo is public
