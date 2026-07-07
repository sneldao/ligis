# Security

> **Casper port note:** The EVM/Solidity contracts enforce every property below.
> The Casper/Odra `CredentialRegistry` now also performs on-chain secp256k1
> signature recovery for both `issue` and `revoke` using the pure-Rust `k256`
> crate. The recovered issuer address is enforced against the supplied issuer
> (`issue`) or the stored credential issuer (`revoke`). A per-issuer nonce and
> expiry/revocation checks provide replay and lifecycle protection.

## Non-custodial

Both contracts never hold funds, never call external contracts on write paths. There is **no admin, no owner, no backdoor**.

- `PharosAgentID.mint/rotate/revoke` — gated on the controller being the caller.
- `CredentialRegistry.issue` — permissionless: anyone can submit a signed attestation, but only the issuer's signature passes the EIP-712 check.
- `CredentialRegistry.revoke` — gated on `msg.sender == issuer`.

## EIP-712 replay protection

- `DOMAIN_SEPARATOR` binds `chainId` and the `CredentialRegistry` address — credentials are non-replayable across chains.
- Each `(issuer, nonce)` is monotonic — the `nonce` must equal the issuer's current `issuerNonce` to prevent replay across contexts.

## Write-path safety

- No reentrancy risk: contracts don't hold funds or call external code on write paths.
- Revocation always succeeds; rotation always succeeds; expiry is checked at read time (not in a push that could lock state).
- Bounded revocation scan (max 50 nonces) prevents gas griefing.
- O(1) lookups via existence flags and per-issuer latest-valid-nonce trackers.

## Key hygiene

- Every `cast send` passes `--private-key` explicitly; no key is committed to disk by the Skill.
- Run keys from an `.env` or shell, never in a notebook.
- Pre-commit secret scanner (gitleaks + pure-bash fallback) catches accidental key exposure.
- All secrets stored in `.env.d/` (gitignored).
