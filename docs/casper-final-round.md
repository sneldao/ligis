# Ligis @ Casper Agentic Buildathon 2026 — Final Round

> **Casper judge start here.** One canonical doc with the load-bearing facts, the on-chain proof, the demo path, and the known limitations. Everything else is supporting evidence.

---

## 1. What ships (and what doesn't)

Deployed on Casper Testnet (block ~8,429,998):

| Contract | Source | Testnet package hash | Status |
|---|---|---|---|
| `AgentId` | `packages/contracts-casper/src/agent_id.rs` | `contract-package-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1` | live, smoke-tested |
| `CredentialRegistry` | `packages/contracts-casper/src/credential_registry.rs` | `contract-package-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37` | live, smoke-tested |
| `GatedVault` | `packages/contracts-casper/src/gated_vault.rs` | `contract-package-27e6637b5a442eada707dce9b2a367fd8139767f6e5d9926da0031611807269f` | **live** (block ~8,615,526), deployed via `put-transaction session --install-upgrade` |

22 Odra tests pass (the `pnpm test:all` headline number is 13; the corrected total after tightening the controller check + the nonce-binding + the GatedVault coverage is 22). 41 Foundry + 47 TypeScript tests pass.

Verification on-the-fly: visit **`https://ligis.vercel.app/verify-casper`** — queries the live chain, no Ligis server-mediated trust.

---

## 2. The 30-second pitch

**Ligis is the portable trust layer for the Casper agent economy.** Two Odra contracts (built on Casper 2.0 via Odra 2.8.1) give every agent a portable, revocable **identity** (`AgentId`) and EIP-712 **credential** registry (`CredentialRegistry`). A third contract (`GatedVault`) gates a native CSPR escrow behind a credential — the first DeFi primitive on Casper to use on-chain capability checks as access control.

What ships end-to-end:

1. **Agent boots** — `AgentId.mint_self` on Casper Testnet.
2. **Agent reasons** — Trust Steward maps a natural-language goal to required capabilities (0G Compute TEE-verified LLM, with a documented `LocalReasoner` keyword fallback).
3. **Agent gates** — `CredentialRegistry.is_capable` reads the latest credential per `(subject, capability)`.
4. **Agent acts** — signed EIP-712 `issue` calls self-attest missing capabilities; the contract recovers the issuer on-chain via secp256k1.
5. **Agent records** — evidence manifest uploaded to 0G Storage, root hash anchored to Casper via `AgentId.set_token_uri`.
6. **Agent pays** — `x402` Trust Gate accepts a credential + x402 micropayment and returns real RWA oracle data (CoinGecko tokenized RWA feeds).
7. **Agent earns** — `GatedVault.withdraw` only releases CSPR to accounts that pass the same `is_capable` check (cross-contract call).

The cross-chain invariant: `capabilityHash("kyc.basic")` produces the same 32 bytes on Casper and Pharos because `@ligis/core` computes the hash off-chain (`keccak256(UTF-8)`).

---

## 3. Judge repro (one command)

```bash
source .env.d/casper.env
source .env.d/zerog.env  # optional; 0G Compute + Storage
export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
npx tsx scripts/casper-final-demo.ts
```

This runs the full `boot → reason → gate → act → record` loop on Casper Testnet and writes the on-chain tx hashes to `scripts/casper-final-demo.lastrun.txt`. The BUIDL's tx-hash table is regenerated from this file. Exit 0 means success.

Live verification: open **`https://ligis.vercel.app/verify-casper?subject=account-hash-...&capability=kyc.basic`** — server-side reads of Casper Testnet global state, no Ligis-side trust.

---

## 4. On-chain proof (currently live)

The fresh-deploy tx hashes printed by `scripts/casper-final-demo.ts` are committed to `scripts/casper-final-demo.lastrun.txt`; the README / BUIDL link to those. The structure is:

| Step | Entry-point | Tx hash (live) |
|---|---|---|
| 1 | `AgentId.mint_self` | `scripts/casper-final-demo.lastrun.txt` |
| 2 | `CredentialRegistry.issue` (rwa.accredited, self-attested) | `scripts/casper-final-demo.lastrun.txt` |
| 3 | `AgentId.set_token_uri` (0G Storage root anchor) | `scripts/casper-final-demo.lastrun.txt` |

GatedVault tx hashes, once deployed, are recorded in `scripts/casper-gated-vault-demo.lastrun.txt`.

A new canonical run replaces the contents of those files. The BUIDL pre-cites historical hashes from the buildathon run on 2026-07-22, but the live demo path is the `lastrun.txt` file.

### Funding the deployer

The deployer, agent, and issuer wallet addresses (EVM mirror + Casper account-hash) are derived from the `_PRIVATE_KEY` env vars and cached in `.env.d/casper.env` as `_EVM_ADDRESS` / `_ACCOUNT_HASH` entries. Re-derive any time with:

```bash
pnpm derive-casper-wallets                  # print all three wallets
pnpm derive-casper-wallets deployer         # print one
pnpm derive-casper-wallets --write          # refresh local .env.d/casper.env
pnpm derive-casper-wallets --write server   # also append to /opt/ligis-croo/.env
```

The script never prints the private keys — only the public addresses and account-hashes. The deployer account-hash to fund at the [Casper testnet faucet](https://testnet.cspr.live/tools/faucet) is also available via `pnpm derive-casper-wallets deployer`.

---

## 5. Test summary

| Suite | Tests | Status |
|---|---|---|
| Odra (Casper contracts) | 22 | green |
| Foundry (EVM contracts) | 41 | green |
| TypeScript (agent-logic, x402, CROO, eas, etc.) | 47 | green |

Run all three locally:

```bash
pnpm test:all                                 # Foundry + TypeScript
pnpm --dir packages/contracts-casper test     # Odra
```

---

## 6. Security posture (highlights)

- **On-chain secp256k1 issuer recovery** — `CredentialRegistry` uses the pure-Rust `k256` crate to recover the issuer address from EIP-712 digest + 65-byte signature. No server-side custody of the signing key required for verification.
- **Nonce-bound revoke** — `CredentialRegistry.revoke` binds the nonce into the typed digest; a replay of an older revoke payload for a different nonce is rejected. Verified by `revoke_rejects_wrong_nonce` and `revoke_rejects_bad_digest`.
- **Composable EIP-2098 recovery** — `recover_issuer` accepts both v=27/28 (legacy) and v=0/1 (EIP-2098 compact) signatures.
- **Shell-injection-free** — every `casper-client` invocation in the adapter shells (`packages/adapter-casper/src/{operations,signer}.ts`, `packages/x402-server/src/index.ts`) uses `execFileSync` with positional argv, not `execSync` with shell-interpolated strings.
- **Fail-closed on settlement** — `x402-server` returns 402 + a clear error when settlement is unavailable; the previous "fake tx hash" fallback has been removed.
- **Self-attested steward** — the testnet demo self-issues; production deploys use external issuers (CROO provider, `agent.commerce.x402` capability for the gate).

Full audit notes (revoke nonce binding, shell-injection path, GatedVault tests, controller check) live in `docs/casper-buidl.md` Section "Internal hardening pass".

---

## 7. Long-term plan

- **August 2026**: Casper Mainnet deploy of `AgentId` + `CredentialRegistry`, leveraging the testnet-proven WASM (`packages/contracts-casper/wasm/*.wasm`).
- **September 2026**: Open the issuer ecosystem — third-party KYC providers and RWA platforms can issue credentials via the live CROO provider.
- **Q4 2026**: Co-author an EIP-712 standard for chain-neutral capability hashes with the Casper and Pharos teams.
- **Q1 2027**: Credential marketplace — agents discover issuers, multi-issuer reputation, on-chain scoring.

The CROO provider is already running 24/7 (`pm2` managed, idempotency DB at `~/.ligis/croo-idempotency.db`, retry with backoff) — judges can hit `https://agent.croo.network` to call `ligis.risk` / `ligis.verify` / `ligis.issue` against a live Casper Testnet credential.

---

## 8. Known limitations (and what we will ship next)

- **GatedVault deposit/withdraw** — the contract is deployed and live on testnet (`contract-package-27e6637b...`). The credential issue + `is_capable` cross-contract verification is exercised by `scripts/casper-gated-vault-demo.ts` (tx hash recorded in `.lastrun.txt`). The deposit (payable entry point) and gated-withdraw steps require the Odra `proxy_caller.wasm` pattern with a `cargo_purse` URef, which the Odra livenet env (`odra-casper-livenet-env` crate) handles automatically but the `casper-client` CLI does not. This is documented as a next-step automation item — the contract logic itself is verified by the 22 passing Odra tests.
- **Browser-side Casper wallet** lives in `web/lib/casper-browser/`. The user funds from the faucet (one-time, 100 CSPR). The `/steward?chain=casper-testnet` flow walks the user through.
- **0G Compute** inference is optional — the steward has a documented `LocalReasoner` fallback (`packages/agent-logic/src/local-reasoner.ts`).
- **Permissionless mint** on `AgentId.mint` is the same as the Phase-1 Pharos contract. A role-gated variant is documented in `docs/security.md` and is a mainnet-migration scope item.

---

## 9. Documentation map

- `README.md` — 1-minute overview + setup.
- `docs/casper-final-round.md` — **this document**.
- `docs/casper-buidl.md` — the long-form BUIDL submission (used in the DoraHacks form).
- `docs/casper-buildathon.md` — historical day-by-day build log.
- `docs/architecture.md` — contract design + monorepo layout.
- `docs/security.md` — security posture + role-gated mint roadmap.
- `references/` — per-skill command specs (issue, verify, revoke, rotate, hash, sign, composability).
