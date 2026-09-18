#!/usr/bin/env bash
# Deploy the Ligis EVM contracts to Pharos, Monad testnet, or local Anvil.
# Reads PRIVATE_KEY from the environment. Writes verified deployed addresses to
# assets/networks.json.
#
# Usage:
#   PRIVATE_KEY=0x... ./scripts/deploy.sh atlantic
#   PRIVATE_KEY=0x... ./scripts/deploy.sh mainnet
#
# Pre-checks: PRIVATE_KEY is set, RPC reachable, deployer has a non-zero balance.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK="${1:-atlantic}"

case "$NETWORK" in
  atlantic|atlantic-testnet)
    RPC="https://atlantic.dplabs-internal.com"
    CHAIN_ID=688689
    EXPLORER="https://atlantic.pharosscan.xyz"
    NETWORK_KEY="atlantic-testnet"
    ;;
  mainnet)
    RPC="https://rpc.pharos.xyz"
    CHAIN_ID=1672
    EXPLORER="https://www.pharosscan.xyz"
    NETWORK_KEY="mainnet"
    ;;
  monad|monad-testnet)
    RPC="${LIGIS_RPC_URL:-https://testnet-rpc.monad.xyz}"
    CHAIN_ID=10143
    EXPLORER="https://testnet.monadscan.com"
    NETWORK_KEY="monad-testnet"
    ;;
  local|local-anvil)
    RPC="${LOCAL_RPC:-http://127.0.0.1:8545}"
    CHAIN_ID=31337
    EXPLORER="http://localhost"
    NETWORK_KEY="local-anvil"
    ;;
  *)
    echo "Unknown network: $NETWORK (use 'atlantic', 'mainnet', or 'local')" >&2
    exit 1
    ;;
esac

# Pre-checks
if [[ -z "${PRIVATE_KEY:-}" ]]; then
  if [[ -n "${PHAROS_DEPLOYER_KEY:-}" ]]; then
    export PRIVATE_KEY="$PHAROS_DEPLOYER_KEY"
    echo "Using PHAROS_DEPLOYER_KEY (from .env.d/deployer.env)"
  elif [[ -n "${DEPLOYER_KEY:-}" ]]; then
    export PRIVATE_KEY="$DEPLOYER_KEY"
  fi
fi
if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "ERROR: PRIVATE_KEY is not set. Set it in your shell: export PRIVATE_KEY=0x..." >&2
  echo "       Or copy .env.d/deployer.example.env to .env.d/deployer.env and source it." >&2
  exit 1
fi

if ! command -v forge >/dev/null 2>&1 && [[ ! -x "$HOME/.foundry/bin/forge" ]]; then
  echo "ERROR: Foundry's forge not found. Install: curl -L https://foundry.paradigm.xyz | bash && source ~/.zshenv && foundryup" >&2
  echo "Note: if you have a different 'forge' CLI shadowing Foundry's, the deploy script uses ~/.foundry/bin/forge directly." >&2
  exit 1
fi

# Use Foundry's forge directly (avoids shadowing by other `forge` CLIs)
FORGE="$HOME/.foundry/bin/forge"
if [[ ! -x "$FORGE" ]]; then
  FORGE="forge"
fi

CAST="$HOME/.foundry/bin/cast"
if [[ ! -x "$CAST" ]]; then
  CAST="cast"
fi

# Fail closed before signing if an RPC override points at the wrong chain.
ACTUAL_CHAIN_ID=$("$CAST" chain-id --rpc-url "$RPC")
if [[ "$ACTUAL_CHAIN_ID" != "$CHAIN_ID" ]]; then
  echo "ERROR: RPC chain ID $ACTUAL_CHAIN_ID does not match expected $CHAIN_ID." >&2
  exit 1
fi

# Derive the deployer address without logging the key.
DEPLOYER=$("$CAST" wallet address --private-key "$PRIVATE_KEY")
echo "Deployer: $DEPLOYER"
echo "Network:  $NETWORK_KEY (chainId $CHAIN_ID)"
echo "RPC:      $RPC"
echo

# Check balance in integer wei; RPC errors must not masquerade as zero funds.
BALANCE_WEI=$("$CAST" balance "$DEPLOYER" --rpc-url "$RPC")
echo "Balance:  $BALANCE_WEI wei"
if [[ "$BALANCE_WEI" == "0" ]]; then
  echo "ERROR: fund $DEPLOYER on $NETWORK_KEY before deploying." >&2
  if [[ "$NETWORK_KEY" == "monad-testnet" ]]; then
    echo "Monad testnet faucet: https://faucet.monad.xyz" >&2
  fi
  exit 1
fi

# Confirm mainnet
if [[ "$NETWORK" == "mainnet" ]]; then
  echo "⚠️  You are about to deploy to PHAROS MAINNET." >&2
  read -r -p "Continue? (yes/no) " REPLY
  if [[ "$REPLY" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "$ROOT_DIR"

# Deploy via Forge
echo "Deploying..."
GAS_PRICE_FLAG=()
if [[ -n "${PHAROS_GAS_PRICE:-}" ]]; then
  GAS_PRICE_FLAG=(--gas-price "$PHAROS_GAS_PRICE")
  echo "Using custom gas price: $PHAROS_GAS_PRICE"
fi
DEPLOYMENT_OUT="$ROOT_DIR/.deployment-latest.json" \
  "$FORGE" script script/Deploy.s.sol:DeployIdentitySkill \
  --rpc-url "$RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  "${GAS_PRICE_FLAG[@]+${GAS_PRICE_FLAG[@]}}"

if [[ ! -f "$ROOT_DIR/.deployment-latest.json" ]]; then
  echo "ERROR: $FORGE did not write a deployment record. Did the broadcast succeed?" >&2
  exit 1
fi

# Merge the per-network deployment into assets/networks.json under the right network key.
NETWORK_KEY_FROM_DEPLOY=$(jq -r '.network' "$ROOT_DIR/.deployment-latest.json")
PHAROS_AGENT_ID_ADDR=$(jq -r '.pharosAgentId' "$ROOT_DIR/.deployment-latest.json")
CREG_ADDR=$(jq -r '.credentialRegistry' "$ROOT_DIR/.deployment-latest.json")

if [[ -z "$NETWORK_KEY_FROM_DEPLOY" || "$PHAROS_AGENT_ID_ADDR" == "null" ]]; then
  echo "ERROR: deployment record is malformed:" >&2
  cat "$ROOT_DIR/.deployment-latest.json" >&2
  exit 1
fi

# Use jq to merge the new deployment entry into the existing deployment map,
# preserving any other networks already recorded (e.g. mainnet + local-anvil).
TMP=$(mktemp)
jq --slurpfile new "$ROOT_DIR/.deployment-latest.json" \
   '.deployment[$new[0].network] = $new[0]' \
   "$ROOT_DIR/assets/networks.json" > "$TMP"
mv "$TMP" "$ROOT_DIR/assets/networks.json"
rm -f "$ROOT_DIR/.deployment-latest.json"

echo
echo "✓ Deployed to $NETWORK_KEY_FROM_DEPLOY (chainId $CHAIN_ID)"
echo "  PharosAgentID:        $PHAROS_AGENT_ID_ADDR"
echo "  CredentialRegistry:   $CREG_ADDR"
echo "  Explorer:             $EXPLORER"
echo
if [[ "$NETWORK_KEY" == "monad-testnet" ]]; then
  echo "Monad deployment complete. Explorer source verification is a separate step."
  echo "Web reads are live via ?chain=monad-testnet (read-only until writeReady)."
  echo "Reproduce the gate: pnpm demo:monad"
else
  echo "Next: bash scripts/verify.sh $NETWORK  (to verify source on Pharos Scan)"
  echo "      bash scripts/demo.sh          (to walk the end-to-end demo)"
fi
