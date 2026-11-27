# Casper — contract build, deploy, demos

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

# OutcomeFeed (M2 reputation receipts):
RUSTFLAGS="-C target-feature=-bulk-memory,-bulk-memory-opt" \
  ODRA_MODULE=OutcomeFeed \
  RUSTC_BOOTSTRAP=1 \
  rustup run nightly-2026-01-01-aarch64-apple-darwin cargo rustc \
    --release --target wasm32-unknown-unknown \
    --bin ligis_contracts_casper_build_contract \
    -Zbuild-std=core,alloc \
    -- -C linker=rust-lld
cp target/wasm32-unknown-unknown/release/ligis_contracts_casper_build_contract.wasm wasm/OutcomeFeed.wasm

# PolicyGuard (M3 spend/policy enforcement; init arg: credential_registry Address):
RUSTFLAGS="-C target-feature=-bulk-memory,-bulk-memory-opt" \
  ODRA_MODULE=PolicyGuard \
  RUSTC_BOOTSTRAP=1 \
  rustup run nightly-2026-01-01-aarch64-apple-darwin cargo rustc \
    --release --target wasm32-unknown-unknown \
    --bin ligis_contracts_casper_build_contract \
    -Zbuild-std=core,alloc \
    -- -C linker=rust-lld
cp target/wasm32-unknown-unknown/release/ligis_contracts_casper_build_contract.wasm wasm/PolicyGuard.wasm

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

### Testnet budget policy (resource-constrained dev machine)

- **Dev loop = Odra test-vm, not testnet.** `cargo test` deploys and
  exercises contracts in-process (deploy, issue, cross-contract calls) —
  no node, no CSPR. Iterate there.
- **Testnet is a demo budget, not a dev budget.** Deploy each contract
  once per WASM change; batch deploys in one session; keep
  `standardPayment=false` so failed deploys cost gas-consumed only.
- **No localnet** (`nctl` too heavy for this machine).
- **Prefer admin ops over redeploys** (`set_namespace_policy`,
  `set_issuer_accreditation`, `set_policy`, `set_admin`).
- **Funding**: deployer `0203f6ff…2c0552` via
  https://testnet.cspr.live/tools/faucet; durable fix is a one-time
  testnet allocation ask under Casper Forward "builder support".

### Deploying to Testnet

```bash
cd packages/adapter-casper
export $(grep -v '^#' ../../.env.d/casper.env | grep -v '^$' | xargs)
npx tsx src/deploy.ts           # deploy both contracts
npx tsx src/deploy.ts AgentId   # deploy only AgentId
npx tsx src/deploy.ts CredentialRegistry  # deploy only CredentialRegistry
```

**GatedVault** (has init args — uses dedicated deploy script):

```bash
set -a && source .env.d/casper.env && set +a
npx tsx scripts/deploy-gated-vault.ts
```

The deploy script serializes Odra init args (credential_registry: Address as
CLType::Key, required_capability: [u8;32] as CLType::ByteArray(32)) into
Casper RuntimeArgs format and passes them as the `args:byte_array_N` session arg.

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
