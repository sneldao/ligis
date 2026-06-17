#!/usr/bin/env bash
# End-to-end demo: mint an Agent ID, issue a credential, verify, revoke.
# Assumes contracts are deployed (assets/deployment.json has the addresses) and the
# deployer has testnet PHRS.
#
# Usage:
#   PRIVATE_KEY=0x... ./scripts/demo.sh
#
# Optional: SUBJECT_KEY and ISSUER_KEY env vars to use separate wallets for the subject
# and the issuer. If not set, the same $PRIVATE_KEY is used for all three roles (so the
# demo works with a single test wallet).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RPC=$(jq -r '.networks["atlantic-testnet"].rpcUrl' "$ROOT_DIR/assets/networks.json")
PAID=$(jq -r '.deployment["atlantic-testnet"].pharosAgentId' "$ROOT_DIR/assets/networks.json")
CREG=$(jq -r '.deployment["atlantic-testnet"].credentialRegistry' "$ROOT_DIR/assets/networks.json")

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "ERROR: PRIVATE_KEY is not set" >&2
  exit 1
fi
if [[ "$PAID" == "PENDING_DEPLOYMENT" || -z "$PAID" ]]; then
  echo "ERROR: contracts not deployed. Run scripts/deploy.sh first." >&2
  exit 1
fi

# Use separate wallets if provided, otherwise the same key for everything
ISSUER_KEY="${ISSUER_KEY:-$PRIVATE_KEY}"
SUBJECT_KEY="${SUBJECT_KEY:-$PRIVATE_KEY}"

ISSUER=$(cast wallet address --private-key "$ISSUER_KEY")
SUBJECT=$(cast wallet address --private-key "$SUBJECT_KEY")

echo "=================================================="
echo "Pharos Identity Skill — End-to-end Demo"
echo "=================================================="
echo "RPC:        $RPC"
echo "Agent ID:   $PAID"
echo "Registry:   $CREG"
echo "Issuer:     $ISSUER"
echo "Subject:    $SUBJECT"
echo

# Capability hash for "agent.commerce.escrow"
CAP=$(cast keccak "agent.commerce.escrow")
echo "Capability hash (agent.commerce.escrow): $CAP"
echo

# === 1. Mint an Agent ID ===
echo "1) Minting Agent ID for $SUBJECT..."
MINT_TX=$(cast send "$PAID" "mintSelf(string)(uint256)" "ipfs://demo-agent" \
  --private-key "$SUBJECT_KEY" --rpc-url "$RPC" --json | jq -r '.transactionHash')
echo "   tx: $MINT_TX"

TOKEN_ID=$(cast call "$PAID" "walletOfAgent(address)(uint256)" "$SUBJECT" --rpc-url "$RPC")
echo "   tokenId: $TOKEN_ID"
echo

# === 2. Issue a credential ===
echo "2) Issuing credential..."
ISSUED_AT=$(date +%s)
EXPIRES_AT=$((ISSUED_AT + 2592000))  # 30 days
NONCE=$(cast call "$CREG" "issuerNonce(address)(uint256)" "$ISSUER" --rpc-url "$RPC")
echo "   issuer nonce: $NONCE"

DIGEST=$(cast call "$CREG" "hashTypedData(address,address,bytes32,uint256,uint256,uint256)(bytes32)" \
  "$ISSUER" "$SUBJECT" "$CAP" "$ISSUED_AT" "$EXPIRES_AT" "$NONCE" --rpc-url "$RPC")
echo "   digest: $DIGEST"

SIG=$(cast wallet sign --private-key "$ISSUER_KEY" --no-hash "$DIGEST")
echo "   signature: ${SIG:0:20}..."

ISSUE_TX=$(cast send "$CREG" "issue(address,address,bytes32,uint64,uint64,uint256,bytes)(uint256)" \
  "$ISSUER" "$SUBJECT" "$CAP" "$ISSUED_AT" "$EXPIRES_AT" "$NONCE" "$SIG" \
  --private-key "$ISSUER_KEY" --rpc-url "$RPC" --json | jq -r '.transactionHash')
echo "   tx: $ISSUE_TX"
echo

# === 3. Verify ===
echo "3) Verifying credential..."
IS_CAPABLE=$(cast call "$CREG" "isCapable(address,bytes32)(bool)" "$SUBJECT" "$CAP" --rpc-url "$RPC")
echo "   isCapable(subject, 'agent.commerce.escrow') = $IS_CAPABLE"
echo

# === 4. Revoke ===
echo "4) Revoking credential..."
REVOKE_TX=$(cast send "$CREG" "revoke(address,bytes32,uint256)" \
  "$SUBJECT" "$CAP" "$NONCE" \
  --private-key "$ISSUER_KEY" --rpc-url "$RPC" --json | jq -r '.transactionHash')
echo "   tx: $REVOKE_TX"
echo

# === 5. Re-verify (should be false) ===
echo "5) Re-verifying after revoke..."
IS_CAPABLE_AFTER=$(cast call "$CREG" "isCapable(address,bytes32)(bool)" "$SUBJECT" "$CAP" --rpc-url "$RPC")
echo "   isCapable(subject, 'agent.commerce.escrow') = $IS_CAPABLE_AFTER"
echo

# === 6. Rotate (key rotation) ===
echo "6) Rotating controller (mint a fresh ID for the demo recipient)..."
# We rotate to a brand-new wallet so we don't break the existing setup.
# In a real scenario, you'd rotate to a new key you control.
ROTATE_TARGET=$(cast wallet new --json 2>/dev/null | jq -r '.[0].address' || python3 -c "import secrets; print('0x' + secrets.token_hex(20))")
echo "   new controller: $ROTATE_TARGET"
ROTATE_TX=$(cast send "$PAID" "rotate(uint256,address)" "$TOKEN_ID" "$ROTATE_TARGET" \
  --private-key "$SUBJECT_KEY" --rpc-url "$RPC" --json | jq -r '.transactionHash')
echo "   tx: $ROTATE_TX"

NEW_OWNER=$(cast call "$PAID" "ownerOf(uint256)(address)" "$TOKEN_ID" --rpc-url "$RPC")
echo "   new ownerOf($TOKEN_ID) = $NEW_OWNER"
echo

echo "=================================================="
echo "Demo complete"
echo "=================================================="
echo
echo "On-chain state:"
echo "  Agent ID:   $PAID (token $TOKEN_ID)"
echo "  Registry:   $CREG"
echo "  Subject:    $SUBJECT (originally) → $ROTATE_TARGET (after rotate)"
echo "  Capability: $CAP"
echo "  Issued:     $ISSUED_AT"
echo "  Expires:    $EXPIRES_AT"
echo "  Status:     REVOKED (revoke at nonce $NONCE)"
echo
echo "View the contracts on Pharos Scan:"
echo "  https://atlantic.pharosscan.xyz/address/$PAID"
echo "  https://atlantic.pharosscan.xyz/address/$CREG"
