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

Store keys in `.env.d/` (gitignored). Example:
```bash
# .env.d/deployer.env
PRIVATE_KEY=0x...
# .env.d/zerog.env
ZEROG_PRIVATE_KEY=0x...
```

## 0G wallet setup

The Trust Steward Agent needs a funded 0G testnet wallet for Compute (TEE-verified inference) and Storage (evidence upload).

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
