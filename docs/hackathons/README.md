# Ligis — hackathon and program entries

Ligis has been entered in several hackathons and builder programs. Each entry
is a proof of the same product (see [`../positioning.md`](../positioning.md)),
not a separate product. Status, demo links and on-chain evidence for every
entry live in [`../proofs.md`](../proofs.md); this page only says which docs
belong to which event.

| Event                                                       | Docs                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Airwallex hackathon                                         | [airwallex-submission.md](../airwallex-submission.md)                                                                                                                                                                                                                |
| Zecathon 2026 (Zcash)                                       | [zecathon-entry.md](../zecathon-entry.md), [zecathon-demo-script.md](../zecathon-demo-script.md), [zcash-live-status.md](../zcash-live-status.md), [zcash-shielded-credentials.md](../zcash-shielded-credentials.md)                                                 |
| The Agent Arena (Vultr)                                     | [agent-arena.md](../agent-arena.md)                                                                                                                                                                                                                                  |
| GenLayer Agent Tank                                         | [genlayer-agent-tank.md](../genlayer-agent-tank.md), [genlayer-interface-v1.md](../genlayer-interface-v1.md), [genlayer-streams.md](../genlayer-streams.md)                                                                                                          |
| Metropolis (Monad)                                          | [metropolis-hackathon.md](../metropolis-hackathon.md), [metropolis-submission.md](../metropolis-submission.md), [integrate-monad.md](../integrate-monad.md)                                                                                                          |
| Monid "We Kill"                                             | [monid-hackathon.md](../monid-hackathon.md)                                                                                                                                                                                                                          |
| OKX.AI Genesis                                              | [okx-ai.md](../okx-ai.md)                                                                                                                                                                                                                                            |
| MoonPay PayBox Ch.1                                         | [paybox-ch1.md](../paybox-ch1.md)                                                                                                                                                                                                                                    |
| Hermes (Nous Research) catalog entry                        | [hermes-entry-package.md](../hermes-entry-package.md), [hermes-plugin-plan.md](../hermes-plugin-plan.md)                                                                                                                                                             |
| Casper Agentic Buildathon, CROO Agent Hackathon (completed) | [archive/](../archive/) ([casper-buildathon.md](../archive/casper-buildathon.md), [casper-final-round.md](../archive/casper-final-round.md), [casper-buidl.md](../archive/casper-buidl.md), [croo-hackathon-submission.md](../archive/croo-hackathon-submission.md)) |

## Open opportunities

- [Binance Agent ID Hackathon](../binance-agent-id.md) — assessed, not entered: Binance Agent ID as root wallet identity, Ligis as the evidence-based payment-control layer. Target the Innovation Award, not the volume leaderboard.

## Zecathon — README section (moved here verbatim)

### Zecathon — Shielded Zcash Gate & Zero-Knowledge Credentials

Current implementation and limits: [Zcash live status](../zcash-live-status.md).
Live note decryption works; the faucet receipt is not a post-GO payment.
An opt-in UltraHonk WASM verifier passes local tests; deployment verification
and a wallet executor remain pending.

> Intended track: Shielded Payments. Grand Prize is an additional award.
> Eligibility requires organizer confirmation because Ligis predates the build window.
> **Build Window:** Sep 28 – Oct 28, 2026 · 23:59 UTC  
> **Net-new Zcash code authored during the build window:** `packages/circuits-zcash/` (Noir UltraHonk circuit, Poseidon Merkle tree, verifier), `packages/adapter-zcash/src/zcash.ts` (ZIP-316 Bech32m/F4Jumble, lightwalletd client, Pallas ECDH note trial-decryption, 512B memo codec), and `web/app/zcash/` (guided 4-step privacy demo). Pre-existing EVM/Casper registries serve strictly as upstream libraries.

Before an agent releases shielded ZEC to a `utest1…` / `u1…` address, the payee proves in zero knowledge (Noir + Barretenberg UltraHonk, depth-16 Poseidon Merkle tree) that it holds an unexpired, unrevoked Ligis credential bound to its own Zcash address inside a steward-signed, on-chain-anchored `CredentialRegistry` root — without revealing its EVM/Casper wallet, which issuer vouched for it, or which leaf it owns.

```bash
# 1. Guided 4-step web demo (/zcash): no proof STOP → UltraHonk proof GO → replay STOP → revoked STOP
pnpm demo:zcash-web          # open http://localhost:3000/zcash (or visit https://ligis.vercel.app/zcash)

# 2. One-command CLI ZK gate demo (publish root → prove → GO → replay/redirect/revoke STOP)
pnpm demo:zcash-zk           # writes scripts/lastrun/zcash-zk-demo.lastrun.txt

# 3. Viewing-key selective disclosure & live Zcash Testnet memo decryption demo
pnpm demo:zcash              # writes scripts/lastrun/zcash-shielded-demo.lastrun.txt
```

See [`../zecathon-entry.md`](../zecathon-entry.md) for the circuit spec, Monad root-anchor transaction ([`0x91f64222...`](https://testnet.monadscan.com/tx/0x91f64222c9e2f1c8d31668a3dd4688f6717f0a719668573998861f932e6ad49f), block `74058241`), live Zcash Testnet transaction ([`d2b389c8...`](https://fauzec.com/api/v1/status/testnet/01M5SKS8EGMJ3MK633ED1ZJ02P), block `4,540,356`), and honest risks.
