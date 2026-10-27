# 0G Chain deploy — Zecathon/Apollo prep, 2026-10-27

Executed live on 0G Newton testnet (chainId 16602, verified via `cast chain-id`).
The adapter (`@ligis/adapter-0g`) and config already existed; what was missing
was the deployment record and the deploy script support.

## What was done

1. **`script/Deploy.s.sol`** — added 0G chain IDs (16602 testnet / 16601 mainnet)
   mapping to `0g-newton-testnet` / `0g-mainnet` network keys.
2. **`scripts/deploy.sh`** — added the `0g` network case (RPC, chainId, explorer,
   faucet hint) and made `DEPLOYMENT_OUT` overridable (Foundry `fs_permissions`
   blocks arbitrary paths; added `./tmp-deployment.json` to `foundry.toml`).
3. **`assets/networks.json`** — corrected `0g-newton-testnet` chainId from the
   stale 16600 to the live 16602, and merged the deployment record:

   - `pharosAgentId`: `0x6D083998990AaE75c28f40B2E790cdead010f8cb`
   - `credentialRegistry`: `0x37d74b9B586FcD8Ce507Fa690143bAf72E42245A`
   - `deployer`: `0xa234d5ba3864acD254467193272e15941102A8fa` (ZEROG wallet)
   - `deployedAt`: `1793133821`

4. **Contract verification** (live reads, not just deploy receipts):
   - `CredentialRegistry.DOMAIN_SEPARATOR()` → `0x5dc435e1...` (contract live)
   - `PharosAgentID.name()` → `"Pharos Agent ID"` (contract live)

5. **First credential issued on 0G Chain** (EIP-712 signed, submitted via the
   existing `ZeroGAdapter` sign/submit path):
   - tx: `0x484b64ac5496d726beb395ef774af9abb261aff913059fbdf950a5a9c5891ac9`
     (status 1, block 62455900) — subject `0xa234...A8fa`, capability
     `agent.commerce.escrow`; `isCapable` → `true`.
   - tx: `0x725ebce2a486ac9e6ccb261d05b65b35896791e11ce2d0dcbae798d1b4162612`
     (status 1, block 62456293) — subject `0xf84c...a293` (the Casper agent's
     EVM-equivalent address), same capability.

6. **Cross-chain portability, three chains live:**
   - Casper: issued `agent.commerce.escrow` to the Casper agent subject
     (tx `0x9f7533c0e113573cca68ff5ff3a209c2042d342a6bc06880550f354e134e0a4a`,
     capable: true).
   - 0G: same capability hash `0x17775e488d...` resolves identically on both
     chains; the 0G-issued credential verifies from the Casper adapter and
     vice versa (`isCapable` → `true` on both).
   - `capabilityHash("agent.commerce.escrow")` = `0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8`
     — the chain-neutral invariant holds across Casper, Pharos, Monad, and 0G.

## Remaining for Apollo submission

- [ ] Run the full Foundry suite against a 0G testnet fork (`forge test --fork-url https://evmrpc-testnet.0g.ai`)
- [ ] Wire 0G Chain into the web chain selector as a read target
- [ ] Update `docs/strategy.md` Phase 3 checklist and the Apollo application
      story ("live on 0G Compute + Storage + Chain")
- [ ] Submit the Apollo Cohort 2 application when it opens

## Notes

- Deployer gas: ZEROG wallet had 0.468 A0GI; both deploys + 2 credential
  submissions consumed ~0.005 A0GI total. Plenty of headroom.
- The `deploy.sh` merge step still expects `.deployment-latest.json`; the 0G
  case writes to `DEPLOYMENT_OUT` (default unchanged), so existing flows are
  untouched.
