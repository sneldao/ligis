# Ligis — Agent Notes

## Casper Contract Build

The Casper contracts use Odra 2.8.1 and require a nightly Rust toolchain.

### Building WASM

```bash
# From packages/contracts-casper/
# AgentId:
RUSTFLAGS="-C target-feature=-bulk-memory,-bulk-memory-opt" \
  ODRA_MODULE=AgentId \
  RUSTC_BOOTSTRAP=1 \
  rustup run nightly-2026-01-01 cargo rustc \
    --release --target wasm32-unknown-unknown \
    --bin ligis_contracts_casper_build_contract \
    -Zbuild-std=core,alloc \
    -- -C linker=/usr/local/bin/wasm-ld
cp target/wasm32-unknown-unknown/release/ligis_contracts_casper_build_contract.wasm wasm/AgentId.wasm

# CredentialRegistry:
RUSTFLAGS="-C target-feature=-bulk-memory,-bulk-memory-opt" \
  ODRA_MODULE=CredentialRegistry \
  RUSTC_BOOTSTRAP=1 \
  rustup run nightly-2026-01-01 cargo rustc \
    --release --target wasm32-unknown-unknown \
    --bin ligis_contracts_casper_build_contract \
    -Zbuild-std=core,alloc \
    -- -C linker=/usr/local/bin/wasm-ld
cp target/wasm32-unknown-unknown/release/ligis_contracts_casper_build_contract.wasm wasm/CredentialRegistry.wasm

# GatedVault (credential-gated escrow DeFi primitive):
RUSTFLAGS="-C target-feature=-bulk-memory,-bulk-memory-opt" \
  ODRA_MODULE=GatedVault \
  RUSTC_BOOTSTRAP=1 \
  rustup run nightly-2026-01-01 cargo rustc \
    --release --target wasm32-unknown-unknown \
    --bin ligis_contracts_casper_build_contract \
    -Zbuild-std=core,alloc \
    -- -C linker=/usr/local/bin/wasm-ld
cp target/wasm32-unknown-unknown/release/ligis_contracts_casper_build_contract.wasm wasm/GatedVault.wasm
```

Key points:
- `ODRA_MODULE` must be the CamelCase struct name (e.g., `CredentialRegistry`, not `credential_registry`)
- `-C target-feature=-bulk-memory,-bulk-memory-opt` is required — Casper's WASM runtime doesn't support bulk memory operations
- `-C linker=/usr/local/bin/wasm-ld` is needed because the nightly toolchain doesn't include `rust-lld` for wasm32
- `RUSTC_BOOTSTRAP=1` allows using `-Zbuild-std` on nightly

### Deploying to Testnet

```bash
cd packages/adapter-casper
export $(grep -v '^#' ../../.env.d/casper.env | grep -v '^$' | xargs)
npx tsx src/deploy.ts           # deploy both contracts
npx tsx src/deploy.ts AgentId   # deploy only AgentId
npx tsx src/deploy.ts CredentialRegistry  # deploy only CredentialRegistry
```

**IMPORTANT:** The deploy script uses `standardPayment=false` so failed deployments only cost actual gas consumed, not the full payment amount. This prevents burning through testnet funds on failed deployments.

### Casper Smoke Test

```bash
export $(grep -v '^#' .env.d/casper.env | grep -v '^$' | xargs)
npx tsx scripts/casper-smoke-test.ts
```

### Casper End-to-End Demo (steward loop)

```bash
source .env.d/casper.env
source .env.d/zerog.env
export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
export LIGIS_CASPER_PUBLIC_KEY=$LIGIS_CASPER_DEPLOYER_PUBKEY
npx tsx scripts/casper-e2e-demo.ts
```

This runs the full autonomous loop: boot → reason → gate → act → record.
Produces 3-4 on-chain transactions on Casper Testnet.

### Casper Multi-Agent Coordination Demo

```bash
source .env.d/casper.env
export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
export LIGIS_CASPER_PUBLIC_KEY=$LIGIS_CASPER_DEPLOYER_PUBKEY
# Start x402 server first (in another terminal)
npx tsx scripts/casper-multi-agent-demo.ts
```

This runs a three-agent swarm: Risk Agent (evaluates counterparty risk from
on-chain credential history) → Issuer Agent (issues credential based on risk
verdict) → Treasury Agent (executes x402 payment for RWA oracle data).
Produces 2+ on-chain transactions on Casper Testnet.

### x402 Payment Demo

```bash
# 1. Start the x402 server
source .env.d/casper.env
export LIGIS_GATE_PAY_TO=00<your-account-hash>
export LIGIS_GATE_CAPABILITY=data.premium
export LIGIS_GATE_PRICE=1000000000
export X402_SETTLEMENT_MODE=local
npx tsx packages/x402-server/src/index.ts &

# 2. Run the payment demo
npx tsx scripts/casper-x402-demo.ts
```

### Cross-Chain Credential Portability Demo

Demonstrates `capabilityHash("kyc.basic")` producing the same hash on both
Casper Testnet and Pharos Atlantic Testnet, with the same issuer key:

```bash
export LIGIS_NETWORK=atlantic-testnet
npx tsx scripts/cross-chain-credential-demo.ts
```

The script auto-loads `.env.d/casper.env` (Casper deployer + contracts) and
`.env.d/deployer.env` (Pharos deployer key + RPC). Output shows both chains
with identical capability hash and issuer EVM address.

### 0G Compute

**Default provider:** Qwen 2.5 7B
(`0xa48f01287233509FD694a22Bf840225062E67836` on Galileo testnet).

Changed from Gemma 3 27B (`0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08`) which
was unreachable (compute-network-8.integratenetwork.work down since mid-2026).

Qwen 2.5 7B requires ≥1.0 OG minimum reserve in provider ledger balance. Run
the following once per wallet to set up:

```bash
export $(grep -v '^#' .env.d/zerog.env | grep -v '^$' | xargs)
npx tsx -e "
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
const QWEN = '0xa48f01287233509FD694a22Bf840225062E67836';
const provider = new ethers.JsonRpcProvider(process.env.ZEROG_RPC_URL);
const wallet = new ethers.Wallet(process.env.ZEROG_PRIVATE_KEY, provider);
const broker = await createZGComputeNetworkBroker(wallet);
broker.ledger.addLedger(5);
broker.inference.acknowledgeProviderSigner(QWEN);
broker.ledger.transferFund(QWEN, 'inference', ethers.parseEther('1.5'));
console.log('0G Compute ready with Qwen 2.5 7B');
"
```

If 0G Compute is unavailable (network issues, service down), the CLI and
web steward automatically fall back to `LocalReasoner` (keyword-based
matching). The fallback is labeled in output as `model: "local-keyword-match"`.

### Web Chain Switching (Pharos ↔ Casper)

The web frontend supports switching between Pharos Atlantic and Casper Testnet
via the `?chain=` query parameter. All pages are chain-aware:

- `web/lib/chain.ts` — EVM read layer (viem + Pharos contracts)
- `web/lib/chain-casper.ts` — Casper read layer (CasperAdapter + block scanning)
- `web/lib/chain-router.ts` — unified dispatch, branches on `chain.kind`

Key points:
- Casper addresses use `account-hash-...` format (not `0x...`)
- Casper has no EVM-style event logs; issuer activity and capability history
  are reconstructed by scanning recent blocks for `issue`/`revoke` transactions
- Server actions (`web/app/actions.ts`) accept `chainId` via hidden form field
- The steward API route already branches: `stewardLoopCasper` vs `stewardLoop`

Required Vercel env vars for Casper reads:
`LIGIS_CASPER_RPC_URL`, `LIGIS_CASPER_NETWORK`, `LIGIS_CASPER_AGENT_ID`,
`LIGIS_CASPER_CREDENTIAL_REGISTRY`. For live writes also set
`LIGIS_CASPER_DEPLOYER_PUBKEY` and `LIGIS_CASPER_DEPLOYER_PRIVATE_KEY`.

### CROO Provider Deployment

The CROO provider runs on the Vultr server (`nuncio-vultr`) under PM2.

**Layout:**
- `/opt/ligis-croo/current` → symlink to `releases/<timestamp>/`
- `/opt/ligis-croo/.env` — all secrets (CROO_SDK_KEY, Casper keys, service UUIDs)
- `/opt/ligis-croo/ecosystem.config.js` — PM2 config
- `/opt/ligis-croo/logs/` — stdout + stderr logs

**Deploy:**
```bash
ssh nuncio-vultr
cd /opt/ligis-croo/releases
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp -a /opt/ligis-croo/current/ releases/$TIMESTAMP/
cd releases/$TIMESTAMP
git fetch origin && git reset --hard origin/main
pnpm install --frozen-lockfile --filter @ligis/croo-adapter...
pnpm --filter @ligis/croo-adapter build
ln -sfn /opt/ligis-croo/releases/$TIMESTAMP /opt/ligis-croo/current
cd /opt/ligis-croo && pm2 restart ecosystem.config.js --update-env
```

**Health check:**
```bash
curl http://127.0.0.1:9430/health
# Returns: { uptime, delivered, errors, lastDeliveryAt, wsConnected, inFlight }
```

**Required env vars in `/opt/ligis-croo/.env`:**
- `CROO_SDK_KEY` — from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_RISK` — listing UUID from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_VERIFY` — listing UUID from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_ISSUE` — listing UUID from CROO Dashboard
- `LIGIS_CHAIN` — `casper` or `pharos`
- `LIGIS_ISSUER_PRIVATE_KEY` — hex private key for signing credentials (required for ligis.issue)
- `LIGIS_CASPER_KEY_PATH` — path to PEM file for casper-client CLI (required for ligis.issue on Casper)
- All `LIGIS_CASPER_*` vars from `.env.d/casper.env`

**casper-client CLI (required for ligis.issue on Casper):**
The `submitCredential` function uses `casper-client` to submit signed
transactions to the Casper network. Install it on the server:
```bash
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
sudo apt-get install -y libssl-dev pkg-config
cargo install casper-client
sudo ln -sf $HOME/.cargo/bin/casper-client /usr/local/bin/casper-client
```

**PEM file generation (required for ligis.issue on Casper):**
The `casper-client` CLI requires a PEM key file. Generate it from the
deployer's hex private key:
```bash
node -e "
const fs = require('fs');
const { PrivateKey, KeyAlgorithm } = require('casper-js-sdk');
const pk = PrivateKey.fromHex(process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY, KeyAlgorithm.SECP256K1);
fs.writeFileSync('.env.d/casper-deployer.pem', pk.exportPrivateKeyInPem());
"
```

**Key implementation notes:**
- CROO sends listing UUIDs as `service_id` in WebSocket events, not service
  names. The provider maps UUIDs via `CROO_SERVICE_ID_*` env vars.
- The `order_paid` WebSocket event is sparse (only `order_id` + `negotiation_id`).
  The provider fetches full negotiation details from the API and caches them.
- CROO wraps buyer requirements in a `{ text: "..." }` envelope.
  `parseServiceRequirements` unwraps it automatically.
- Orders are marked fulfilled only after successful delivery (with 3 retries).
- Idempotency DB at `~/.ligis/croo-idempotency.db` (SQLite, auto-pruned hourly).
