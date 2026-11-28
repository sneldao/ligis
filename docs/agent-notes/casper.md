# Casper — contract build, deploy, demos

## Registry v2 (current deployment)

- v2 registry package:
  `contract-package-8ae8673028fa19ef7f75d582d9493dd80aeb98cd659af0a8ae8d2cc811629f12`
  (self-describing claims, digest binding, issuer accreditation; spec:
  `docs/credential-registry-v2.md`). v1 package
  `contract-package-6edde3cf…262aa37` still reads fine — the decoder is
  dual-format.
- **State reads are direct JSON-RPC** (`packages/adapter-casper/src/state-reads.ts`)
  — no `casper-client` CLI for reads. The CLI abbreviates large byte strings
  (`[174 hex chars]`) in normal mode and prepends the request envelope in
  `-vv` mode, so neither output mode is machine-parseable; v2 credentials
  with claims silently failed to verify through it. Writes still use the
  SDK/CLI. If you add a new read path, use the helpers in `state-reads.ts`.
- The byte decoder is shared: `parseCredentialViewHex` in
  `@ligis/core/credential-view` — dependency-free, used by both the Node
  adapter and the browser adapter. Never reimplement it per-side.
- Odra field indices: issuer_nonce=1, latest=2, admin=3,
  issuer_accreditation=4, namespace_policy=5, domain_separator=6.

### Accreditation posture (live since 2026-11-27)

- `kyc` namespace is **accredited-only** (tx `cbe91392…`); issuer
  `0x47e9b13e467e2db34b1aa145758b253bbd9ffa40` is accredited for `kyc`
  (tx `714116ba…`). New `kyc.*` issuance from unaccredited issuers is
  rejected by the contract. `rwa`/`demo` namespaces are still open —
  flip them only after accrediting an issuer or you brick issuance there.
- `is_capable`/`verifyCapability` do NOT check accreditation — standing is
  advisory via `credentialStanding`. If a gate should enforce accreditation
  off-chain, wire it into the gate decision explicitly.

### Vercel production env (hard-won)

- `LIGIS_CASPER_CREDENTIAL_REGISTRY` on Vercel is **plain type, not
  secret/sensitive** — the registry hash is public on-chain data, and plain
  type means the stored value can be read back and verified in the dashboard
  or API. Sensitive vars are write-only; you cannot confirm an edit landed.
- Env values are snapshotted into each deployment at build time. Editing
  the var does nothing to running deployments, and **a redeploy started
  before the edit finished saving silently bakes the old value** — sequence
  env edits first, verify via API, then redeploy or push.
- `/api/casper-config` is `force-static` + `revalidate=300`, so the hash is
  baked at build time AND edge-cached 5 min. Verify a cutover against the
  deployment-direct URL (`ligis-<hash>-snel.vercel.app`) before trusting the
  production domain, and expect the domain to lag.
- Dashboard same-origin API for scripted env work (browser session cookies):
  `GET/POST /api/v9/projects/ligis/env?teamId=team_d9QHRz4UVSLz24MMqisKi3jl`,
  `DELETE /api/v9/projects/ligis/env/<id>?teamId=...`. Far more reliable
  than driving the env-var UI.
- 2026-11-28 cutover: production had been serving a stale legacy registry
  hash (`e8ab657b…`, not in the repo at all) since before the v2 migration.
  v2 value went live with the fresh build after the env fix.

### Write-path warnings (hard-won)

- **Bool args**: SDK 5.x stores the bare boolean on `.bool` — there is no
  `.boolVal` and `.parsed` is undefined. The CLI arg encoder once read those
  missing fields and silently submitted every bool as `false`. Extraction
  now goes through `getValueByType().getValue()`; never reintroduce
  field-name guesses without a roundtrip test against live chain args
  (`info_get_deploy` shows the transmitted values).
- **SDK submission is broken** (`Cannot read properties of undefined
(reading 'toBytes')` in `callStoredContractViaSdk`) — every write falls
  back to the casper-client CLI path, so `casper-client` must be installed
  wherever writes happen (it is on the Vultr server). Fix the SDK path or
  accept the CLI dependency; check `LIGIS_CASPER_DEBUG` output to see which
  path a write took.
- A reverted transaction is still included in a block. Inclusion is not
  success — `pollTransactionWithCli` now throws on revert/timeout; keep it
  that way.

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
