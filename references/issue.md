# `ligis-issue` — Mint an Agent ID + Issue a Credential

Two related operations, both anchored on Ligis. Read this before any
"register my agent", "mint me an ID", or "issue a credential" task.

## Step 0 — Load addresses and RPC

```bash
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
PAID=$(jq -r '.deployment.atlantic-testnet.pharosAgentId' assets/deployment.json)
CREG=$(jq -r '.deployment.atlantic-testnet.credentialRegistry' assets/deployment.json)
```

If `PAID` or `CREG` is `PENDING_DEPLOYMENT`, run `bash scripts/deploy.sh atlantic` first.

## Step 1 — Mint an Agent ID

There are two paths. Pick the one that matches the caller's role.

### Path A — Agent mints its own ID (no off-chain paperwork)

The agent's controller wallet calls `mintSelf` with a metadata URI (any string; can be an
IPFS CID, a URL, or empty for the demo).

```bash
# Pre-checks
[ -n "$PRIVATE_KEY" ] && echo "PRIVATE_KEY is set" || { echo "set PRIVATE_KEY"; exit 1; }
AGENT_ADDR=$(cast wallet address --private-key $PRIVATE_KEY)
echo "Will mint to: $AGENT_ADDR"

# Mint
cast send $PAID "mintSelf(string)(uint256)" "ipfs://bafy.../agent-meta" \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

Parse the `AgentMinted(tokenId, controller, tokenURI)` event from the receipt to capture
the `tokenId`. Save it:

```bash
cast call $PAID "walletOfAgent(address)(uint256)" $AGENT_ADDR --rpc-url $RPC
# Returns the tokenId, or 0 if none
```

### Path B — Operator mints an ID on behalf of an agent (with a known controller)

```bash
CONTROLLER=0x1234...
TOKEN_URI="ipfs://bafy.../agent-meta"

# Operator must be the minter. The Skill is permissionless — anyone can call mint().
# If you want to gate minting, fork the contract and add an owner check.
cast send $PAID "mint(address,string)(uint256)" $CONTROLLER $TOKEN_URI \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

### Errors
- `AlreadyHasID(controller)` — the wallet already has an ID. Query
  `walletOfAgent(controller)` to find the existing tokenId.
- `ZeroAddress()` — `controller` is the zero address. Fix the call.
- `DoesNotExist(tokenId)` — `tokenURI` was queried for a non-existent ID.

## Step 2 — Issue a credential (separate transaction, signed by the issuer)

The issuer (e.g. a DAO, a KYC provider, a marketplace operator) signs an EIP-712
attestation and broadcasts the `issue(...)` call. Anyone can submit the signed
attestation — the signature is the authorization. The `nonce` must equal the issuer's
current `issuerNonce` to prevent replay.

### Step 2a — Compute the capability hash

Use the helper Skill to hash a human-readable name:

```bash
cast keccak "agent.commerce.escrow"
# 0x...
```

A starter set is in `assets/credentials.example.json`. The hash is the same on any chain
because keccak256 is content-addressed.

### Step 2b — Build and sign the EIP-712 digest off-chain

The typed-data hash is:
```
keccak256(
  abi.encode(
    keccak256("Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)"),
    issuer,
    subject,
    capabilityHash,
    issuedAt,
    expiresAt,
    nonce
  )
)
```

The full EIP-712 digest is:
```
keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash))
```

You can compute this on-chain for verification:
```bash
cast call $CREG "hashTypedData(address,address,bytes32,uint256,uint256,uint256)(bytes32)" \
  $ISSUER $SUBJECT $CAP_HASH $ISSUED_AT $EXPIRES_AT $NONCE --rpc-url $RPC
```

### Step 2c — Sign and submit

Use the helper CLI or `cast wallet sign`:

```bash
# Issuer-side
ISSUER_KEY=0x...                 # Issuer's private key (or use $PRIVATE_KEY if same wallet)
ISSUER=$(cast wallet address --private-key $ISSUER_KEY)
SUBJECT=0x...                    # Agent's controller wallet
CAP_HASH=0x...                   # keccak256 of capability name
ISSUED_AT=$(date +%s)            # current unix time
EXPIRES_AT=$((ISSUED_AT + 2592000))  # 30 days, for example
NONCE=$(cast call $CREG "issuerNonce(address)(uint256)" $ISSUER --rpc-url $RPC)

# Build the digest
DIGEST=$(cast call $CREG "hashTypedData(address,address,bytes32,uint256,uint256,uint256)(bytes32)" \
  $ISSUER $SUBJECT $CAP_HASH $ISSUED_AT $EXPIRES_AT $NONCE --rpc-url $RPC)

# Sign with the issuer's key
SIG=$(cast wallet sign --private-key $ISSUER_KEY --no-hash $DIGEST | awk '{print $2}')
# If using a hardware wallet, sign the digest with the issuer's address.

# Submit the attestation (any wallet can submit, but the issuer is the signer)
cast send $CREG "issue(address,address,bytes32,uint64,uint64,uint256,bytes)(uint256)" \
  $ISSUER $SUBJECT $CAP_HASH $ISSUED_AT $EXPIRES_AT $NONCE $SIG \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

### Errors
- `InvalidSignature()` — the signature didn't recover to `issuer`. Re-check the digest
  computation. Common cause: signed the wrong nonce (already used) or wrong chainId.
- `InvalidExpiry()` — `expiresAt <= issuedAt`.
- `Expired(expiresAt, now)` — the credential was signed with a past `expiresAt`.
- `ZeroAddress()` — `issuer` or `subject` is the zero address.
- The `nonce` is the **issuer's next nonce** (`issuerNonce[issuer]`). Replay across
  capability hashes for the same issuer is prevented because the nonce advances on every
  call.

## What just happened

1. The agent now has a portable on-chain identity (`PharosAgentID` NFT).
2. The agent's controller holds a credential (off-chain signed, on-chain recorded) from the
   issuer for the given capability.
3. Any downstream Skill that calls `isCapable(subject, capHash)` will see `true` until
   the credential expires or is revoked.
4. The agent can rotate its controller key (via `ligis-rotate`) without losing
   the credential, because the credential is bound to the controller wallet, not the
   private key — the ID NFT carries the controller, and rotating the ID moves the
   "controller" pointer.

## Phase 2 preview (Anvita Flow)

A Procurement Steward Agent, on first start, would:
1. Mint its own `PharosAgentID`.
2. Read the set of capabilities the user wants it to have.
3. For each capability, walk through the corresponding issuer's off-chain flow (e.g.,
   a KYC provider's API) to obtain a signed attestation, then call `issue(...)`.
4. Use `isCapable(...)` before every gated action.
