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

### 0G Compute fallback

If 0G Compute is unavailable (network issues, service down), the CLI and
web steward automatically fall back to `LocalReasoner` (keyword-based
matching). The fallback is labeled in output as `model: "local-keyword-match"`.
