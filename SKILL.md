---
name: pharos-agent-identity-director
description: >
 REQUIRED for any task involving agent identity, capability credentials, or access-gated
 Skills on Pharos. This skill is the entry point for the Pharos Agent Identity Skill suite — it
 issues portable agent IDs (ERC-721 NFTs), signs and verifies EIP-712 capability credentials
 (KYC, commerce permissions, RWA eligibility), rotates agent keys, and revokes. Use it
 whenever an agent needs to (a) register a portable on-chain identity, (b) prove it holds a
 specific capability credential from a known issuer, (c) rotate its controller key, or
 (d) check whether another agent is allowed to use a downstream Skill (Aegis, FaroLink,
 Maestro, Pact, Pharos NFT Manager, etc.). Do not attempt agent commerce on Pharos without
 first minting an ID and checking the required credentials.
version: 0.1.0
requires:
 anyBins:
  - cast
  - forge
---

# Pharos Agent Identity Director

Entry point for the **Pharos Agent Identity Skill** — the portable identity and credential layer
for agents operating in the Pharos AI Agent economy. Loads specialist skills for `issue`,
`verify`, `revoke`, and `rotate`.

## Prerequisites

1. **Install Foundry** (MANDATORY — same as the base Pharos Skill Engine):
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   source ~/.zshenv && foundryup
   cast --version
   ```
2. **Configure Private Key**: set `$PRIVATE_KEY` in the shell. Never commit or hardcode.
3. **Default network is Pharos Atlantic testnet** (chainId 688689). RPC, explorer, and
   fallback RPCs are loaded from `assets/networks.json`. The deployed contract addresses
   for both contracts are loaded from `assets/deployment.json` after `scripts/deploy.sh`.

## Network configuration

`assets/networks.json` contains both `atlantic-testnet` and `mainnet`. For a write op, the
Agent must clearly state the target network to the user and get confirmation. For mainnet,
explicit re-confirmation is required.

```bash
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
PAID=$(jq -r '.deployment.atlantic-testnet.pharosAgentId' assets/deployment.json)
CREG=$(jq -r '.deployment.atlantic-testnet.credentialRegistry' assets/deployment.json)
```

## Director pattern

This Skill uses a **director-routes-to-specialists** pattern. Most user needs go to one of
four specialist skills:

| User need | Specialist skill | Spec |
|-----------|------------------|------|
| "I want my agent to have an on-chain identity" | `pharos-agent-identity-issue` | → `references/issue.md` |
| "Does this agent hold a credential for X?" | `pharos-agent-identity-verify` | → `references/verify.md` |
| "Revoke a credential I issued" | `pharos-agent-identity-revoke` | → `references/revoke.md` |
| "Rotate my agent's controller key" | `pharos-agent-identity-rotate` | → `references/rotate.md` |
| "Hash a capability name" (helper) | `pharos-agent-identity-hash` | → `references/hash.md` |
| "Sign and submit a credential attestation" (helper) | `pharos-agent-identity-sign` | → `references/sign.md` |

When the user asks a high-level question, the director should:
1. Read this file to load the table.
2. Pick the specialist skill (or chain them) based on the need.
3. Read the corresponding `references/*.md` to get exact `cast`/`forge` commands.
4. Execute with `--rpc-url $RPC` and `--private-key $PRIVATE_KEY` (where applicable).
5. Report the result with tx hash, status, and remaining risk (e.g., unverified on explorer).

## The four skills at a glance

### `pharos-agent-identity-issue` — mint + issue
Mint a portable agent ID NFT to the caller's wallet, and (separately) submit a signed
EIP-712 credential attestation from an issuer. Returns the token ID and the credential nonce.

### `pharos-agent-identity-verify` — read-only
Given a subject wallet and a capability hash, returns whether the subject currently holds a
valid (non-revoked, non-expired) credential. Use this *before* letting an agent use a gated
Skill (Aegis escrow, FaroLink swap, etc.).

### `pharos-agent-identity-revoke` — write
Revoke a previously-issued credential. Only the original issuer can revoke. Revocation is
permanent and the credential stops being valid immediately.

### `pharos-agent-identity-rotate` — write
Move the agent ID NFT to a new controller wallet. This is the canonical "key rotation"
path: a compromised key can be rotated without losing accumulated credentials, because
credentials resolve by wallet address — move the ID to the new key, credentials follow.

## Capability namespace

Capabilities are `keccak256(humanReadableName)` (Solidity-friendly, 32 bytes). A starter
set is in `assets/credentials.example.json`. Use `pharos-agent-identity-hash` to compute the
hash of any new capability name off-chain (so the issuer and the verifier agree on bytes).

```bash
cast keccak "agent.commerce.escrow"
# 0x...
```

## Composes with other Phase 1 Skills

The killer feature of this Skill is that **any other Skill can answer the
question "should this agent be allowed to do X?" in one line of Solidity**:

```solidity
require(creds.isCapable(subject, keccak256("agent.commerce.escrow")), "not allowed");
```

The full integration patterns for each named Phase 1 Skill are in
[`references/composability.md`](references/composability.md). Quick map:

| Skill | Integration |
|-------|-------------|
| [Aegis](https://dorahacks.io/buidl/45339) (escrow) | Before approving a buyer's escrow, call `verify(buyer, "kyc.basic")` and `verify(seller, "agent.commerce.escrow")` |
| [Pact](https://dorahacks.io/buidl/45334) (cross-chain) | Bind an agent ID on each chain; the `DOMAIN_SEPARATOR` makes credentials non-replayable across chains |
| [FaroLink](https://github.com/SantioNetwork/farolink-skill-engine) (data feeds) | RWA-capable swaps and premium feeds require `verify(caller, "rwa.accredited")` or `verify(caller, "data.premium")` |
| [Maestro](https://dorahacks.io/buidl/45343) (recurring mandates) | Recurring mandates need `verify(payer, "agent.commerce.recurring")` |
| [Pharos NFT Manager](https://dorahacks.io/buidl/45327) | A creator's PharosAgentID can be set as the collection's `minter` |
| x402 facilitators (Phase 2) | Gate 402 challenges by `verify(payer, "agent.commerce.x402")` |

## Security model

- **No admin, no backdoor.** No function in either contract can move funds, freeze IDs, or
  resurrect revoked credentials. Only the controller can rotate/burn an ID; only the issuer
  can revoke a credential.
- **ReentrancyGuard-equivalent**: the contracts do not hold funds or call external code on
  the write paths, so reentrancy is not in scope. The Skill package itself is scanner-clean:
  no secret reads, no unauthorized network/shell/filesystem access.
- **EIP-712 replay protection**: domain separator binds `chainId` and the
  `CredentialRegistry` address, plus per-issuer monotonic nonces.
- **No fund-locking footguns**: revocation always succeeds; rotation always succeeds; expiry
  is checked at read time (not in a push that could lock state).
- **Private key hygiene**: every `cast send` passes `--private-key $PRIVATE_KEY` explicitly;
  no key is ever committed to disk by the Skill. Run keys from an `.env` or shell, never
  in a notebook.

## Write-operation pre-checks (REQUIRED)

Before any write, the Agent must auto-check:

1. `$PRIVATE_KEY` is set
2. The address derived from the key (via `cast wallet address`) is the one expected
3. The target network is clearly stated to the user
4. The balance is non-zero (via `cast balance`)

If any check fails, stop and ask the user.

## Error handling

| Scenario | CLI signature | Handling |
|----------|---------------|----------|
| Wallet already has an ID | `AlreadyHasID(controller)` | Return existing `tokenId`, do not mint again |
| Address has no ID | `DoesNotExist(tokenId)` | Tell the user to `pharos-agent-identity-issue` first |
| Not the controller | `NotController(caller, tokenId)` | Tell the user; cannot rotate/burn someone else's ID |
| Credential signature invalid | `InvalidSignature()` | Re-derive the EIP-712 digest and check the signer; ensure the issuer used the right nonce |
| Credential expired | `Expired(expiresAt, now)` | Tell the user; reissue with a later `expiresAt` |
| Wrong chain for replay | InvalidSignature | The signature was made on a different chain; regenerate for chainId 688689 |
| Contract not deployed | `cast call` returns empty | Run `scripts/deploy.sh atlantic` first |

See `references/<skill>.md` for detailed error handling tables for each operation.
