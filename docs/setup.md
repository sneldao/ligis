# Setup

## Prerequisites

- **Node.js** 20+
- **Foundry** — install: `curl -L https://foundry.paradigm.xyz | bash && source ~/.zshenv && foundryup`
  > If another `forge` CLI shadows Foundry's, the npm scripts use `scripts/forge.sh` which finds Foundry's forge at `~/.foundry/bin/forge` automatically.

## From scratch

```bash
# 1. Install deps
npm install

# 2. Get testnet PHRS from the Pharos Atlantic faucet
#    https://atlantic.pharosscan.xyz (Faucet tool) or Chainlink faucet

# 3. Set your private key
export PRIVATE_KEY=0x<YOUR_TESTNET_PRIVATE_KEY>

# 4. Build and test
bash scripts/forge.sh build
npm test
npm run test:ts

# 5. Deploy
bash scripts/deploy.sh atlantic

# 6. Verify on Pharos Scan (optional)
export SOCIALSCAN_API_KEY=...
bash scripts/verify.sh atlantic

# 7. Run the end-to-end demo
bash scripts/demo.sh

# 8. (Optional) Install the skill into Claude Code / Codex
./install.sh
```

## Environment variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `PRIVATE_KEY` | Write ops (issue, revoke, rotate, sign, agent run) | Pharos Atlantic wallet private key |
| `ZEROG_PRIVATE_KEY` | Agent run (0G Compute + Storage) | 0G testnet wallet private key |
| `ZEROG_RPC_URL` | Agent run | 0G EVM RPC (default: `https://evmrpc-testnet.0g.ai`) |
| `ZEROG_INDEXER_RPC` | Agent run (0G Storage) | 0G Storage indexer (default: `https://indexer-storage-testnet-turbo.0g.ai`) |
| `ZEROG_PROVIDER` | Agent run (0G Compute) | 0G Compute provider address (default: Gemma 3 27B IT) |
| `PHAROS_NETWORK` | All ops | `atlantic` (default) or `mainnet` |
| `PHAROS_RPC_URL` | All ops | Override the default RPC URL |
| `SOCIALSCAN_API_KEY` | Source verification | For `scripts/verify.sh` |
| `LIGIS_STEWARD_KEY` | Web Steward live mode | Pharos Atlantic wallet key for on-chain steward runs on the web frontend. Set on Vercel to enable the ● live toggle. Uses the same key as `PRIVATE_KEY` (your deployer wallet). |

Store keys in `.env.d/` (gitignored). Example:
```bash
# .env.d/deployer.env
PRIVATE_KEY=0x...
# .env.d/zerog.env
ZEROG_PRIVATE_KEY=0x...
```

### Web frontend (Vercel)

The web frontend runs the Steward loop in two modes:

- **Simulated** (default): no env vars needed. The loop uses realistic timing
  and fake tx hashes for demo purposes.
- **Live**: set `LIGIS_STEWARD_KEY` to a funded Pharos Atlantic wallet private
  key. The loop will make real `isCapableMulti` reads, sign and submit EIP-712
  credentials via `issue()`, and anchor evidence via `setTokenURI`.
  - **REASON phase**: if `ZEROG_PRIVATE_KEY` is set, the loop calls 0G Compute
    (TEE-verified LLM) to map the goal to required capabilities. Falls back to
    local keyword matching if 0G is unavailable or not configured.
  - **RECORD phase**: if `ZEROG_PRIVATE_KEY` is set, the loop uploads the full
    evidence manifest to 0G Storage and anchors the Merkle root on-chain. Falls
    back to a local `keccak256` hash if 0G Storage is unavailable.
  - **Write transactions**: signed locally and sent via `eth_sendRawTransaction`
    (bypassing `eth_sendTransaction`, which the default Pharos RPC does not
    support). Set `PHAROS_RPC_URL` if using a custom RPC endpoint.

**Security recommendation: use a dedicated steward wallet, not your deployer
key.** Create a separate wallet for the web steward, fund it with a small
amount of testnet PHRS (enough for gas), and mint it an Agent ID + issue
credentials once via the CLI. This limits blast radius — if the Vercel env var
is compromised, only the steward wallet (with limited funds and capabilities)
is affected, not the deployer who owns the contracts.

**Current steward wallet:** `0x76eCFC63742b154e24dECf3c00Ea8DFED5061833`
(token #3, minted on Atlantic). Funded with testnet PHRS.

Live writes are rate-limited to 3 runs per minute per IP address.

```bash
# In Vercel project settings → Environment Variables:
LIGIS_STEWARD_KEY=0x...  # dedicated steward wallet (not your deployer key)
ZEROG_PRIVATE_KEY=0x...  # SAME value as LIGIS_STEWARD_KEY — one key, two chains
# Optional:
# PHAROS_RPC_URL=https://...  # custom RPC if default is rate-limited
# ZEROG_RPC_URL=https://evmrpc-testnet.0g.ai  # 0G EVM RPC (default works)
# ZEROG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai  # 0G Storage indexer
# ZEROG_PROVIDER=0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08  # default Gemma 3 27B
```

## 0G wallet setup

The Trust Steward Agent needs a funded 0G testnet wallet for Compute (TEE-verified inference) and Storage (evidence upload).

### Architecture: one dedicated steward key for both chains

The steward wallet (`0x76eCFC63742b154e24dECf3c00Ea8DFED5061833`) is reused for both Pharos Atlantic (PHRS gas) and 0G testnet (OG for Compute + Storage). EVM private keys are chain-agnostic, so the same key controls the same address on both chains. This means:

- **One env var on Vercel**: `ZEROG_PRIVATE_KEY` = `LIGIS_STEWARD_KEY` (same value)
- **One dedicated wallet** with limited funds on both chains (not the deployer key)
- **Simpler key management** — no second wallet to track

### Current status (as of June 2026)

**CLI 0G wallet** (`0xa234d5ba3864acD254467193272e15941102A8fa`): funded with 2.48 OG, `setupProvider()` completed. Used for CLI/MCP agent runs.

**Web steward 0G wallet** (`0x76eCFC63742b154e24dECf3c00Ea8DFED5061833`): needs funding + `setupProvider()` before live 0G integration works on Vercel.

To set up the web steward wallet for 0G:

1. **Fund it** with at least **3.2 OG** on the 0G testnet (Galileo):
   - 3 OG for the ledger deposit (hard minimum enforced by the SDK)
   - 0.1 OG for provider funding
   - Extra for Storage upload gas
   - Faucet: https://docs.0g.ai/developer-hub/testnet/testnet-overview
2. **Run one-time setup** to initialize the 0G Compute ledger:
   ```bash
   source .env.d/steward.env
   export ZEROG_PRIVATE_KEY=$LIGIS_STEWARD_KEY
   export ZEROG_RPC_URL=https://evmrpc-testnet.0g.ai
   export ZEROG_PROVIDER=0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08
   npx tsx scripts/setup-zerog.ts
   ```
3. **On Vercel**, set `ZEROG_PRIVATE_KEY` to the same value as `LIGIS_STEWARD_KEY`.

To set up a fresh wallet from scratch (alternative approach):

1. **Generate a wallet** and store the key in `.env.d/zerog.env`.
2. **Fund it** with at least **3.2 OG** on the 0G testnet (Galileo):
   - 3 OG for the ledger deposit (hard minimum enforced by the SDK)
   - 0.1 OG for provider funding
   - Extra for Storage upload gas
   - Faucet: https://docs.0g.ai/developer-hub/testnet/testnet-overview
3. **Run one-time setup** to initialize the 0G Compute ledger:
   ```bash
   source .env.d/zerog.env
   export ZEROG_PRIVATE_KEY ZEROG_RPC_URL ZEROG_PROVIDER
   npx tsx scripts/setup-zerog.ts
   ```

## Forge path note

A separate CLI tool called `forge` (e.g. at `~/.local/bin/forge`) can shadow Foundry's forge in the PATH. The project includes `scripts/forge.sh` which finds Foundry's forge at `~/.foundry/bin/forge` first, then falls back to `forge` in PATH only if it reports a Foundry version string. All npm scripts and deploy/verify scripts use it.
