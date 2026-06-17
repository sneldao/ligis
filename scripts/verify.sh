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
    API_URL="https://api.socialscan.io/pharos-atlantic-testnet"
    CHAIN_NAME="atlantic"
    COMPILER="0.8.24"
    OPTIMIZER_RUNS=200
    ;;
  mainnet)
    API_URL="https://api.socialscan.io/pharos-mainnet"
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
  echo "Get one at https://etherscan.io/apis (it's the same Etherscan family)." >&2
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

verify_contract() {
  local name="$1"
  local address="$2"
  local source_file="$3"
  local contract_path="$4"

  echo "Verifying $name at $address..."

  # Flatten the source for the API
  local flattened
  flattened=$(forge flatten "$source_file" 2>/dev/null)

  if [[ -z "$flattened" ]]; then
    echo "  ERROR: forge flatten produced empty output" >&2
    return 1
  fi

  local args_json
  args_json=$(jq -n \
    --arg apikey "$SOCIALSCAN_API_KEY" \
    --arg module "contract" \
    --arg action "verifysourcecode" \
    --arg contractaddress "$address" \
    --arg sourceCode "$flattened" \
    --arg codeformat "solidity-standard-json-input" \
    --arg contractname "$contract_path" \
    --arg compilerversion "v$COMPILER+commit.e98b9f7e" \
    --argjson optimizerRuns "$OPTIMIZER_RUNS" \
    '{apikey: $apikey, module: $module, action: $action, contractaddress: $contractaddress, sourceCode: $sourceCode, codeformat: $codeformat, contractname: $contractname, compilerversion: $compilerversion, optimizationUsed: 1, runs: $optimizerRuns}')

  local response
  response=$(curl -s -X POST "$API_URL/api" \
    -H "Content-Type: application/json" \
    -d "$args_json")

  local guid
  guid=$(echo "$response" | jq -r '.result // empty')

  if [[ -z "$guid" ]]; then
    echo "  Response: $response"
    echo "  ERROR: verification submission failed" >&2
    return 1
  fi

  echo "  Submission GUID: $guid"

  # Poll for status
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 5
    local status_resp
    status_resp=$(curl -s "$API_URL/api?module=contract&action=checkverifystatus&guid=$guid&apikey=$SOCIALSCAN_API_KEY")
    local status
    status=$(echo "$status_resp" | jq -r '.result // empty')
    echo "  Status: $status"
    if [[ "$status" == "Pass - Verified" || "$status" == "Already Verified" ]]; then
      echo "  ✓ $name verified"
      return 0
    fi
    if [[ "$status" == "Fail - Unable to verify" || "$status" == "Pending - processing" ]]; then
      continue
    fi
  done
  echo "  WARNING: verification did not complete in time. Check the GUID on the explorer." >&2
  return 1
}

cd "$ROOT_DIR"

verify_contract "PharosAgentID" "$PAID" "src/PharosAgentID.sol" "src/PharosAgentID.sol:PharosAgentID" || true
verify_contract "CredentialRegistry" "$CREG" "src/CredentialRegistry.sol" "src/CredentialRegistry.sol:CredentialRegistry" || true

echo
echo "Done. Check the explorer for the green 'Verified' badge next to each contract."
