# `ligis-revoke` — Revoke a Credential

Permanent, irreversible. Only the **original issuer** of a credential can revoke it.

## Step 0 — Load addresses and RPC

```bash
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
CREG=$(jq -r '.deployment.atlantic-testnet.credentialRegistry' assets/deployment.json)
```

## Step 1 — Find the credential to revoke

You need `(subject, capabilityHash, nonce)`. If you don't have the nonce, look it up:

```bash
SUBJECT=0x...
CAP_HASH=$(cast keccak "agent.commerce.escrow")

# Returns the latest nonce issued for this (subject, capability) pair
cast call $CREG "latestCredential(address,bytes32)(address,uint64,uint64,bool,bool)" \
  $SUBJECT $CAP_HASH --rpc-url $RPC
```

The result is `(issuer, issuedAt, expiresAt, revoked, valid)`. To get the actual
`nonce`, you can iterate by calling `getCredential` with increasing nonces until the
issuer matches your address:

```bash
for n in 0 1 2 3 4 5; do
  result=$(cast call $CREG "getCredential(address,bytes32,uint256)(address,uint64,uint64,bool,bool)" \
    $SUBJECT $CAP_HASH $n --rpc-url $RPC)
  echo "nonce=$n: $result"
done
```

Look for the row whose first field is your issuer address.

## Step 2 — Revoke

The caller (`msg.sender`) must be the original issuer. So:
- If you're revoking from the issuer's own wallet, use the issuer's `$PRIVATE_KEY`.
- If you're submitting from a relayer, the relayer cannot revoke — only the issuer can.
  This is intentional.

```bash
ISSUER_KEY=0x...    # the issuer's private key
NONCE=0             # from Step 1

cast send $CREG "revoke(address,bytes32,uint256)" \
  $SUBJECT $CAP_HASH $NONCE \
  --private-key $ISSUER_KEY \
  --rpc-url $RPC
```

Parse the `CredentialRevoked(issuer, subject, capabilityHash, nonce, revokedAt)` event
from the receipt.

## Step 3 — Verify

Immediately after, `isCapable` should return `false` for the revoked credential (or
return `true` if a newer valid credential exists for the same capability):

```bash
cast call $CREG "isCapable(address,bytes32)(bool)" $SUBJECT $CAP_HASH --rpc-url $RPC
```

## Errors

- `NotIssuer(caller, expectedIssuer)` — `msg.sender` is not the original issuer. The
  Skill enforces that only the issuer can revoke. If you need a multi-sig issuer, fork
  the contract or use a Smart Account wallet.
- `AlreadyRevoked()` — the credential is already revoked. Revoke is idempotent at the
  event level but reverts to prevent confusion.
- `UnknownCredential()` — the `(subject, capabilityHash, nonce)` tuple has never been
  issued. Verify the inputs.

## What revocation does

- Sets the credential's `revokedAt` to the current block timestamp.
- Marks the credential as invalid for `isCapable(...)`.
- Re-computes the "latest valid" pointer for the `(subject, capabilityHash)` pair: if
  a newer credential exists, the subject may still be capable under it; otherwise, the
  subject is no longer capable.
- Emits `CredentialRevoked(issuer, subject, capabilityHash, nonce, revokedAt)`.

## What revocation does NOT do

- It does **not** affect other credentials the same issuer has issued to the same
  subject for other capabilities.
- It does **not** affect the agent's `PharosAgentID` — the ID is independent of
  credentials. To decommission the agent entirely, use `ligis-rotate` to move
  the ID to a burn address (or add a `burn-from-registry` to the registry contract).
- It does **not** propagate to other Skills. Downstream Skills that have already
  recorded the credential as "valid" (e.g., Aegis logging an escrow with a KYC'd buyer)
  should re-check `isCapable` at the time of the action, not at the time of recording.
  This is the standard EIP-712 credential model.

## Common patterns

**Pause a seller.** The issuer (a marketplace operator) revokes the seller's
`agent.commerce.escrow` credential. The seller's pending escrows in Aegis/Pact can
still settle, but no new ones can be opened against the seller's address.

**Rotate a KYC re-verification.** Revoke `kyc.basic`. The user re-runs the KYC flow,
gets a new signed attestation, and `issue(...)` is called with the next nonce.

**Burn a stolen key.** The user calls `ligis-rotate` to move their ID to a
new wallet, then revokes all old credentials (issued under the old wallet as subject)
by asking the original issuers to revoke. New credentials are issued to the new wallet.
