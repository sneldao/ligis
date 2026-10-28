# Zecathon demo video script (≤ 2 minutes)

Target: Shielded Payments track. Recorded against `pnpm demo:zcash-web` → http://localhost:3000/zcash, with the CLI demo (`pnpm demo:zcash-zk`) as the closing shot. Every claim below is backed by a lastrun file or an on-chain txid; do not ad-lib numbers.

## Shot list

| #   | Time      | On screen                                                               | Voiceover                                                                                                                                                                                                                                                                                   |
| --- | --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:12 | Agent payment going through, wrong payee, money gone (staged screen)    | "The whole agent-trust industry is verifying the buyer — Visa, Mastercard, the KYA startups. Nobody's checking who's getting paid. Your agent just paid an address that looked right. Ligis is the check on the other side of the transaction."                                             |
| 2   | 0:12–0:32 | `/zcash` step 1: paste a `utest1…` address, no proof → STOP             | "On Zcash, a shielded payee has no public credential — so the gate STOPS. Privacy must not mean zero trust. And none of the existing trust layers work here at all: they're all built on surveillance."                                                                                     |
| 3   | 0:35–1:00 | Step 2: payee generates a live UltraHonk proof → GO                     | "So the payee proves, in zero knowledge, that it holds a valid Ligis credential — without revealing its address, its issuer, or which credential. Noir circuit, UltraHonk proofs, verified against a steward-signed registry root anchored on Monad testnet."                               |
| 4   | 1:00–1:20 | Step 3: replay the same proof → STOP; step 4: revoked credential → STOP | "Replay the proof and the gate stops it — nullifiers make each proof single-use. A revoked credential proves fine against an old root and still gets stopped."                                                                                                                              |
| 5   | 1:20–1:40 | Terminal: `pnpm demo:zcash` output, then the post-GO `z_sendmany` txid  | "And the gate is wired to real money: after a GO, the executor releases shielded ZEC on Zcash testnet — this transaction, confirmed at block height N, carries the Ligis memo inside the shielded pool."                                                                                    |
| 6   | 1:40–1:55 | `docs/zecathon-entry.md` risks section                                  | "Honest limits: the anonymity set is small, the root freshness window is configurable, and replay protection needs durable KV in production. All documented. Any agent wallet can call one API before it pays — and for the first time, that check works even when the payment is private." |

## Recording notes

- Use the recorded fallback for step 3 only if `bb` isn't available locally — the UI labels it, say so on camera if used.
- Show the lastrun files (`scripts/zcash-zk-demo.lastrun.txt`, `scripts/zcash-shielded-demo.lastrun.txt`, post-GO receipt) for 2–3 seconds each; judges check receipts.
- Fill in the actual block height and txid from the post-GO run before recording shot 5 — never quote a number not in a receipt.
- 2:00 hard cap; if over, cut shot 6 to one sentence.

## Delivery notes (2026-10-27 revision)

- Shot 1 is the attention hook: flat, confident delivery on the market claim
  ("nobody's checking who's getting paid"), then the dread beat. Do not
  oversell — Zcash judges are allergic to hype.
- The market-differentiation line ("everyone verifies the buyer, nobody
  checks the payee") is the setup for the whole video: it makes the crowded
  KYA field the reason to watch, not the competition.
- Shot 5 remains the winning shot: real txid + block height from the actual
  post-GO lastrun file, never quoted from memory.
- Keep total at 1:55. If over, cut shot 6's limits list to one sentence but
  keep the closing adoption line — it is the adoption pitch.
