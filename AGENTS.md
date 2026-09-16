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

### GenLayer Intelligent Contract (Agent Tank)

The GenLayer `JobEscrow` contract lives in `packages/contracts-genlayer/` and is
the adjudication half of the Ligis × GenLayer compose story. It targets
**Studio Next (studio_devnet, chain ID 61997)** — the network the Agent Tank
portal requires for the explorer-link field. Interface is frozen in
`docs/genlayer-interface-v1.md`; shared TS types in `@ligis/core` → `genlayer.ts`.

**Setup (one-time, in a venv):**

```bash
cd packages/contracts-genlayer
pip install -r requirements.txt   # genlayer-py>=0.19.0rc2 (studio_devnet), genlayer-test, genvm-linter
```

**Lint:**

```bash
cd packages/contracts-genlayer
genvm-lint check contracts/JobEscrow.py
```

**Direct-mode tests (no Docker/Studio needed, ~1s):**

```bash
cd packages/contracts-genlayer
pytest tests/direct/ -v
```

Direct mode downloads the GenVM runtime tarball on first run (~216MB) into
`~/.cache/gltest-direct/`. If the sandbox blocks the SSL download, pre-fetch
with `curl -skL -o ~/.cache/gltest-direct/genvm-universal-v0.2.12.tar.xz
https://github.com/genlayerlabs/genvm/releases/download/v0.2.12/genvm-universal.tar.xz`.

**Deploy + full flow to Studio Next:**

```bash
cd packages/contracts-genlayer
export GENLAYER_PRIVATE_KEY=0x...   # optional; fresh account created if unset
python deploy.py                     # deploy + create -> deliver -> dispute -> resolve -> claim
python deploy.py --stop              # also show the STOP gate path
python deploy.py --no-deploy         # reuse existing contract (set JOBEscrow_ADDRESS)
# -> scripts/genlayer-agent-tank-demo.lastrun.txt (address, job id, explorer URL)
```

**Live deployment (2026-09-16):**

- Contract: `0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F`
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F
- 5 transactions, all GenVM Result = SUCCESS
- `resolve` returned "undetermined" (AI-jury could not reach consensus — a valid GenLayer outcome)

Key points:

- **GenLayer v0.3.0 API** — the Studio dev runner uses v0.3.0 which has breaking
  changes: `gl.Contract` → `gl.contract.Contract`, `@allow_storage` →
  `@gl.storage.allow`, `from genlayer import *` → `import genlayer as gl` +
  `from genlayer.types import *`. Contract is fully migrated.
- **GenVM runner hash** — the magic comment must pin the current runner:
  `# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }`
  (old hash `1jb45aa8...` causes `invalid_contract runner malformed`).
- **Address fields** — the v0.3.0 GenVM does not auto-convert `str` to `Address`
  in storage dataclasses. Methods take `seller: str` and convert with
  `Address(seller)` internally.
- `studio_devnet` (chain 61997) requires `genlayer-py>=0.19.0rc2`; the stable
  `studionet` preset is a different network and does NOT satisfy the portal.
- **Fee estimation** — Studio dev requires fee distribution; `deploy.py` calls
  `client.estimate_transaction_fees()` and passes fees to all writes.
- **Receipt decoding** — `read_contract` with `raw_return=True` is needed for
  v0.3.0 contracts; the SDK's default u256/string decoder doesn't match the
  new GenVM calldata encoding. Decode hex manually: `bytes.fromhex(ret[2:]).decode()`.
- **Wait for finalization** — `wait_until="finalized"` (not just "decided") so
  reads see the post-transaction state. The `resolve` step may return
  "undetermined" — that's a valid GenLayer consensus outcome, not a bug.
- Contract uses `gl.nondet.web.render()` + `gl.nondet.exec_prompt(response_format="json")`
  inside `gl.eq_principle.strict_eq()` for the intelligent `resolve()`.
- Reverts use `raise Exception(msg)` (via `_require`), not `assert`, because
  `genlayer-test` direct mode's `expect_revert` re-raises `AssertionError`.
- `TreeMap` fields auto-initialize; do NOT assign `self.x = TreeMap()` in
  `__init__` (causes a type-desc mismatch).
- Default capability: `agent.commerce.escrow`. Gate is Option A (off-chain
  Ligis pre-flight; receipt stored on-chain via `gate_receipts[id]`).
- **Direct tests** — `genlayer-test` 0.29.2 downloads GenVM v0.2.12 which
  doesn't support the v0.3.0 API. Tests pass only when `genlayer-test` ships a
  v0.3.0-compatible runtime. The contract is verified working on-chain.

### GenLayer Web UI (Stream 4)

The thin observer UI lives at `web/app/genlayer/` and reads the deployed
JobEscrow IC on Studio Next (chain 61997) via `genlayer-js`.

**Pages:**

- `/genlayer` — contract address, job state, lifecycle visualization, gate
  receipt, verdict, architecture walkthrough
- Falls back gracefully when no contract is deployed (shows "deploy pending"
  - demo instructions from `pnpm demo:genlayer`)

**Key files:**

- `web/lib/genlayer.ts` — genlayer-js client with inline Studio Next chain
  definition (genlayer-js 1.1.x ships `studionet`, not 61997); reads
  `get_job`, `get_gate_receipt`, `job_count`, `is_eligible`
- `web/app/genlayer/actions.ts` — server action; resolves contract address
  from `GENLAYER_JOBEscrow_ADDRESS` env var or `lastrun.txt`
- `web/app/genlayer/page.tsx` — server component, reads contract state

**Navigation:** "Escrow" added to GlobalDock + CommandPalette (⌘K).

**Typecheck:**

```bash
cd web && npx tsc --noEmit
```

**Dev:**

```bash
cd web && pnpm dev   # http://localhost:3000/genlayer
```

Key points:

- genlayer-js 1.1.x supports custom chain configs via `createClient({ chain })`,
  so Studio Next (61997) is defined inline — reads work without a preset.
- The UI is read-only (observer). Write lifecycle (create → deliver → dispute
  → resolve → claim) is owned by `pnpm demo:genlayer` (Stream 3, shells to
  `deploy.py`).
- Contract address resolution: `GENLAYER_JOBEscrow_ADDRESS` env var →
  `scripts/genlayer-agent-tank-demo.lastrun.txt` → null (shows fallback).

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

Information architecture (see `web/DESIGN.md`): `/` is editorial landing,
`/field` is the immersive registry (semantic zoom, Esc to leave), `/gate` is
the verb. The dock names only Gate and Field; moat routes live in ⌘K.

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
