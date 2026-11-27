# Binance Agent ID Hackathon — opportunity note

> **Status:** assessed, not entered.
> **Deadline:** December 9, 2026, 08:00 UTC.
> **Official announcement:** <https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf>

## Opportunity

Binance Wallet × BNB Chain are running a 60,000 USDC Agent ID hackathon. The relevant target is the **Innovation Award** (29,000 USDC across ten prizes), not the Pioneer volume leaderboard. Innovation requires a live product and at least 30 distinct Agent ID addresses interacting during the submission window.

Agent ID is a non-transferable ERC-721 on BNB Chain:
`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`. The basic check is
`balanceOf(wallet) > 0`.

## Why Ligis fits

Binance Agent ID gives an agentic wallet a name. It does not answer the payment-control question Ligis exists to answer: **should this spend happen now, against what evidence, and within which mandate?**

The correct positioning is complementary:

- **Binance Agent ID** — root wallet identity / `.ai` name.
- **Ligis** — evidence-based payment control layered on top of that identity.

Do not frame Ligis as a competing identity system or credential registry. Frame it as the control plane that makes Agent ID wallets safe to transact.

## Smallest credible scope

1. **BNB Chain adapter** — extend the existing EVM adapter/config rather than inventing a new chain layer.
2. **Agent ID-aware gate** — the caller or payer is recognized through the Agent ID contract, but possession alone never produces GO. Credentials, mandate, payee, amount, and payment history still decide.
3. **Receipt registry** — a small BNB Chain contract recording verdict/receipt hashes for payment decisions. Keep ownership and admin powers explicit and minimal.
4. **x402 demo** — one paid service call where a Binance Agentic Wallet previews the payment, Ligis returns GO/STOP/REVIEW, and the receipt is visible on-chain.
5. **Judge path** — a single page showing: Agent ID detected → evidence evaluated → verdict → payment/STOP outcome → receipt.

## Explicitly out of scope

- Rebranding Ligis around Binance Agent ID.
- A badge mint, check-in, referral loop, or token mechanic.
- Porting every existing chain adapter or marketplace integration.
- Treating Agent ID possession as proof of trustworthiness, uniqueness, or autonomy.

## Open questions before committing

- Whether pre-existing code is eligible, or whether the submission must be net-new code written during the window.
- Exact Binance x402 merchant settlement requirements on `eip155:56`.
- Which existing Ligis credential registry should anchor the demo, and whether a BNB-native registry is needed for judging.
- Distribution path to at least 30 interacting Agent IDs; target 100+ rather than the minimum.
