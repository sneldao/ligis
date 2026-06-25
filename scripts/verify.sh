#!/usr/bin/env bash
# Verify the deployed contracts on Pharos Scan (via socialscan API).
# Requires the SOCIALSCAN_API_KEY env var (free at https://etherscan.io/apis for
# Etherscan-family explorers, or contact Pharos for a key).
#
# Usage:
#   SOCIALSCAN_API_KEY=... ./scripts/verify.sh atlantic
#   SOCIALSCAN_API_KEY=... ./scripts/verify.sh mainnet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${1:-atlantic}"

case "$NETWORK" in
  atlantic|atlantic-testnet)
    API_URL="https://api.socialscan.io/pharos-atlantic-testnet/v1/explorer/command_api/contract"
    CHAIN_NAME="atlantic"
    COMPILER="0.8.24"
    OPTIMIZER_RUNS=200
    ;;
  mainnet)
    API_URL="https://api.socialscan.io/pharos-mainnet/v1/explorer/command_api/contract"
    CHAIN_NAME="mainnet"
    COMPILER="0.8.24"
    OPTIMIZER_RUNS=200
    ;;
  *)
    echo "Unknown network: $NETWORK" >&2
    exit 1
    ;;
esac

if [[ -z "${SOCIALSCAN_API_KEY:-}" ]]; then
  echo "ERROR: SOCIALSCAN_API_KEY is not set. The Socialscan API requires an API key." >&2
  echo "Get one at https://developer.socialscan.io/" >&2
  echo "Then: export SOCIALSCAN_API_KEY=..." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/assets/networks.json" ]]; then
  echo "ERROR: assets/networks.json not found. Run scripts/deploy.sh first." >&2
  exit 1
fi

NETWORK_KEY="$NETWORK"
if [[ "$NETWORK" == "atlantic" || "$NETWORK" == "atlantic-testnet" ]]; then
  NETWORK_KEY="atlantic-testnet"
fi

DEPLOY_BLOCK=$(jq -r ".deployment[\"$NETWORK_KEY\"]" "$ROOT_DIR/assets/networks.json")
PAID=$(echo "$DEPLOY_BLOCK" | jq -r '.pharosAgentId')
CREG=$(echo "$DEPLOY_BLOCK" | jq -r '.credentialRegistry')

if [[ -z "$PAID" || "$PAID" == "null" || "$PAID" == "PENDING_DEPLOYMENT" ]]; then
  echo "ERROR: PharosAgentID address missing in deployment.json" >&2
  exit 1
fi
if [[ -z "$CREG" || "$CREG" == "null" || "$CREG" == "PENDING_DEPLOYMENT" ]]; then
  echo "ERROR: CredentialRegistry address missing in deployment.json" >&2
  exit 1
fi

# Use Foundry's forge directly (avoids shadowing by other `forge` CLIs)
FORGE="$HOME/.foundry/bin/forge"
if [[ ! -x "$FORGE" ]]; then
  FORGE="forge"
fi

verify_contract() {
  local name="$1"
  local address="$2"
  local source_file="$3"
  local contract_path="$4"

  echo "Verifying $name at $address..."

  # Generate standard JSON input via Foundry (includes optimizer, evmVersion, remappings)
  local std_json
  std_json=$("$FORGE" verify-contract "$address" "$contract_path" \
    --chain 688689 \
    --verifier etherscan \
    --verifier-url "$API_URL" \
    --etherscan-api-key dummy \
    --compiler-version "v$COMPILER+commit.e11b9ed9" \
    --show-standard-json-input 2>/dev/null | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")

  if [[ -z "$std_json" ]]; then
    echo "  ERROR: forge verify-contract --show-standard-json-input failed" >&2
    return 1
  fi

  local response
  response=$(curl -s -X POST "$API_URL?apikey=$SOCIALSCAN_API_KEY" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "module=contract" \
    --data-urlencode "action=verifysourcecode" \
    --data-urlencode "contractaddress=$address" \
    --data-urlencode "sourceCode=$std_json" \
    --data-urlencode "codeformat=solidity-standard-json-input" \
    --data-urlencode "contractname=$name" \
    --data-urlencode "compilerversion=v$COMPILER+commit.e11b9ed9" 2>&1)

  echo "  Response: $response"

  local status
  status=$(echo "$response" | jq -r '.status // empty')
  if [[ "$status" == "1" ]]; then
    echo "  ✓ $name verified"
    return 0
  fi

  echo "  ERROR: verification failed" >&2
  return 1
}

cd "$ROOT_DIR"

verify_contract "PharosAgentID" "$PAID" "packages/contracts-evm/src/PharosAgentID.sol" "packages/contracts-evm/src/PharosAgentID.sol:PharosAgentID" || true
verify_contract "CredentialRegistry" "$CREG" "packages/contracts-evm/src/CredentialRegistry.sol" "packages/contracts-evm/src/CredentialRegistry.sol:CredentialRegistry" || true

echo
echo "Done. Check the explorer for the green 'Verified' badge next to each contract."
