# `ligis-rotate` — Rotate the Controller Key

Move the agent's `PharosAgentID` NFT from the current controller wallet to a new
controller wallet. This is the canonical "key rotation" path: a compromised key can be
rotated out without losing the agent's accumulated credentials (because credentials
resolve by controller wallet address — the ID NFT carries the controller pointer).

## Step 0 — Load addresses and RPC

```bash
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
PAID=$(jq -r '.deployment.atlantic-testnet.pharosAgentId' assets/deployment.json)
```

## Step 1 — Identify the current ID

```bash
CURRENT_CONTROLLER=0x...    # the wallet you currently use
TOKEN_ID=$(cast call $PAID "walletOfAgent(address)(uint256)" $CURRENT_CONTROLLER --rpc-url $RPC)
# Returns 0 if the wallet has no ID
```

If `TOKEN_ID == 0`, the wallet has no ID. Use `ligis-issue` instead.

## Step 2 — Verify the new wallet has no ID

You can only rotate to a wallet that does not already hold an ID. The contract enforces
this, but checking first saves a wasted tx:

```bash
NEW_CONTROLLER=0x...
EXISTING=$(cast call $PAID "walletOfAgent(address)(uint256)" $NEW_CONTROLLER --rpc-url $RPC)
if [ "$EXISTING" != "0" ]; then
  echo "New wallet already has ID: tokenId=$EXISTING"
  echo "Revoke it first (see references/revoke.md for ID, not credential, revocation) or pick a different wallet."
  exit 1
fi
```

## Step 3 — Rotate

```bash
# Caller (msg.sender) MUST be the current controller. Use the current controller's key.
cast send $PAID "rotate(uint256,address)" $TOKEN_ID $NEW_CONTROLLER \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

Equivalent via `transferFrom`:

```bash
cast send $PAID "transferFrom(address,address,uint256)" $CURRENT_CONTROLLER $NEW_CONTROLLER $TOKEN_ID \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

Both emit `AgentRotated(tokenId, from, to)`. Parse the receipt to capture the new
controller's address (for logging).

## Step 4 — Verify

```bash
cast call $PAID "ownerOf(uint256)(address)" $TOKEN_ID --rpc-url $RPC
# Returns the new controller

cast call $PAID "walletOfAgent(address)(uint256)" $NEW_CONTROLLER --rpc-url $RPC
# Returns the tokenId

cast call $PAID "walletOfAgent(address)(uint256)" $CURRENT_CONTROLLER --rpc-url $RPC
# Returns 0
```

## Step 5 — Re-verify credentials on the new controller

Credentials are bound to the **subject wallet address**, not to the ID NFT. So if your
credentials were issued with `subject = OLD_CONTROLLER`, they now resolve to the old
address (which is empty). The agent is "credential-less" until you get new credentials
issued to the new address.

There are two paths:

### Path A — Re-issue all credentials to the new controller (recommended)

Walk through the issuer list (KYC, RWA registry, marketplace, etc.) and call `issue(...)`
for each capability with `subject = NEW_CONTROLLER`. The issuer uses their next nonce.

### Path B — Ask issuers to re-target existing credentials

Some issuers support a "rebind subject" flow. This is off-chain coordination: the issuer
revokes the old credential and issues a new one with `subject = NEW_CONTROLLER`. The
issuer may charge a re-issuance fee.

## Errors

- `NotController(caller, tokenId)` — `msg.sender` is not the current controller. The
  current controller is the only one that can rotate. If the current key is lost, the
  ID is stuck forever — this is by design.
- `AlreadyHasID(controller)` — the new controller already has an ID. Revoke their
  existing ID first (or use a different wallet).
- `DoesNotExist(tokenId)` — the `tokenId` doesn't exist. Check `walletOfAgent` for the
  actual ID.
- `ZeroAddress()` — the new controller is the zero address. Use a real wallet.

## When to rotate

| Trigger | Action |
|---------|--------|
| Suspected key compromise | Rotate immediately, then revoke all credentials issued under the old address, then re-issue on the new address |
| Routine key rotation (e.g. quarterly) | Rotate, re-issue, monitor |
| Migrating from a hot wallet to a hardware wallet | Rotate to the new hardware-wallet address, re-issue |
| Migrating to a Safe / multi-sig | Rotate to the Safe address, re-issue (the Safe becomes the controller) |
| Lost key, no backup | ID is stuck. Mint a new ID from a different wallet, walk the re-issuance flow. **There is no admin recovery by design.** |

## Security notes

- Rotate first, then revoke, then re-issue. If you revoke first, your `isCapable` checks
  will start returning `false` while you still hold the old key — anyone watching the
  chain knows you no longer trust the old key.
- Do not rotate to a wallet you do not fully control (e.g., an exchange deposit address).
  The exchange controls the keys; they could rotate again, leaving you with no recourse.
- For high-value agents, prefer rotating to a Safe multi-sig (Pharos's Safe fork is
  already in the [PharosNetwork/safe-wallet-monorepo](https://github.com/PharosNetwork/safe-wallet-monorepo)).
  Then the rotation moves control to the multi-sig, not a single key.
