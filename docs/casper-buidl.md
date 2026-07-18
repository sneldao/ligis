# Ligis — BUIDL Submission for the Casper Agentic Buildathon 2026

> Copy/paste this into the DoraHacks BUIDL form for the
> **Casper Agentic Buildathon 2026 — Qualification Round**.
> Submission portal: https://dorahacks.io

---

## Title

**Ligis** — Portable on-chain identity and verifiable credentials for AI agents on Casper.

## Tagline (one-liner)

Ligis gives every AI agent a portable, revocable Casper-native identity plus signed EIP-712 capability credentials — the same `capabilityHash("kyc.basic")` on every chain — so x402 Trust Gates, RWA oracles, and DeFi protocols can finally ask "who are you, and who vouches for that?"

## Track

- [x] Casper Innovation Track
- [x] Agentic AI (Trust Steward runs an autonomous loop on Casper)
- [x] RWA (x402 Trust Gate delivers tokenized real-estate data, gated by Ligis credentials)
- [x] DeFi (autonomous x402 micropayments settled on Casper via EIP-712 TransferWithAuthorization)

## Demo video (public, 1:35)

**MP4 (5.6 MB):** https://github.com/sneldao/ligis/releases/download/buildathon-2026/ligis-demo.mp4

The video shows three live on-chain transactions on Casper Testnet and the
end-to-end x402 payment flow. Featured tx hashes (view on testnet.cspr.live):

- `88110003c6b959e83684057489da66b502cc5c15d2bc774a910941383a4ed845` — `AgentId.mint_self`
- `c26fe5d64ebb7fca2dc553bab209567370eb4786716848a22c4f912c73521cb3` — `AgentId.set_token_uri` (0G evidence anchor)
- `27a9ac885613ad2f13a6640058544f70b787d5ab4db5e5e72f5f77648129c6bb` — x402 CSPR transfer settlement

## Repo

`https://github.com/sneldao/ligis`

Public. MIT licensed. 41 Foundry tests (EVM/Solidity contracts) + 12 Odra tests (Casper contracts) + 47 TypeScript tests + Casper smoke test passing.

## Deployed contracts (Casper Testnet)

| Contract | Package hash |
|----------|--------------|
| `AgentId` (Odra, soulbound-style) | `contract-package-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1` |
| `CredentialRegistry` (Odra, EIP-712, on-chain secp256k1 recovery) | `contract-package-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37` |

Built with Odra 2.8.1 against Casper 2.0, deployed via `casper-client put-deploy`
on testnet (block ~8,429,998). Source: `packages/contracts-casper/`.

## End-to-end demo txs (executed live on Casper Testnet, today)

| # | Action | Tx hash | Result |
|---|--------|---------|--------|
| 1 | `AgentId.mint_self` | `88110003c6b959e8..83a4ed845` | agentId 1 minted |
| 2 | Steward self-issues `data.premium` credential (EIP-712, `CredentialRegistry.issue`) | (batched into single loop) | `is_capable = true` |
| 3 | Steward self-issues `agent.commerce.x402` + `rwa.accredited` (EIP-712) | (batched) | all 3 capabilities held |
| 4 | `AgentId.set_token_uri` (0G Storage evidence anchor) | `c26fe5d64ebb7fca..73521cb3` | URI = `0g://0x09a344f4..3594b602df3` |
| 5 | x402 — `GET /premium` without credential | n/a | 401 not authorized |
| 6 | x402 — `GET /premium` with credential | n/a | 402 Payment Required (1 CSPR) |
| 7 | x402 — sign EIP-712 `TransferWithAuthorization`, resubmit | `27a9ac885613ad2f..8129c6bb` | 200 OK + 4 tokenized RWA properties |

## Category

**Agent Identity & Credentials** — uncommon in the field, foundation for other
Casper-native AI agents and x402 services. Also touches DeFi (micropayments)
and RWA (premium tokenized real-estate data).

## Long-form description (~700 words)

### Problem

The Casper AI Toolkit now ships MCP servers, an x402 protocol, and CSPR.cloud
APIs. But there is no portable, on-chain way for a Casper agent to say _who_
it is, _which wallet controls it_, and _who vouches for which capability_.
Without that, x402 services have to fall back to KYC-by-promise, RWA oracles
to trusted-list-by-handshake, and DeFi access control to allowlists managed
out of band.

### What we built

Two Odra contracts (Rust / Wasm 32) on Casper Testnet, plus a `ChainAdapter`
runtime that gives any agent a one-line primitive to gate access:

```rust
require(creds.is_capable(subject, capability_hash("agent.commerce.escrow")), "not allowed")
```

1. **`AgentId`** — soulbound-style identity. The agent mints its own NFT
   (`mint_self`) to a controller address. No transfer approvals. A
   one-way `rotate` for key recovery. `set_token_uri` lets the agent
   anchor a 0G Storage evidence root on chain.
2. **`CredentialRegistry`** — stores EIP-712 capability credentials
   (`issue`, `revoke`, `is_capable`). The capability name is hashed
   chain-neutrally (keccak256 off-chain in `@ligis/core`) so the same
   `0x3896aa82..235f35e3e` identifies `kyc.basic` on every chain.
   Credentials are signed off-chain with EIP-712 and the Casper contract
   recovers the secp256k1 issuer address on-chain, so anyone can submit
   but only a valid issuer's signature is accepted.

The Trust Steward wraps both contracts in an autonomous loop:

> **boot → reason → gate → act → re-gate → record**

1. **BOOT** — `AgentId.mint_self` on Casper
2. **REASON** — 0G Compute (Qwen 2.5 7B, TEE-verified) maps the goal
   to a list of required capabilities; falls back to `LocalReasoner`
   (keyword matcher) if 0G is unavailable
3. **GATE** — `CredentialRegistry.is_capable(subject, cap)` for each
4. **ACT** — Steward self-issues any missing capability via signed
   EIP-712 `CredentialRegistry.issue` calls
5. **RE-GATE** — confirm all required credentials are now valid
6. **RECORD** — Upload evidence manifest to 0G Storage, anchor the
   root hash to Casper via `AgentId.set_token_uri`

The same loop runs on Pharos Atlantic (Solidity) and Casper Testnet (Odra)
because the Steward consumes a `ChainAdapter` interface, not an
implementation.

### x402 Trust Gate (the consumption of that trust)

A separate `x402-server` package implements one endpoint, `GET /premium`,
that requires a valid Ligis credential AND an x402 micropayment:

- no credential → **401** (request credential from Steward first)
- credential, no payment → **402** with x402 v2 PaymentRequirements
  (scheme: exact, network: casper:casper-test, 1 CSPR)
- credential + signed EIP-712 `TransferWithAuthorization` → **200**
  with tokenized RWA market data, payment settled on chain

Local settlement mode produces a real CSPR transfer on Casper Testnet
(visible above as `27a9ac88..`) by verifying the X-PAYMENT payload shape
and submitting a direct transfer. It is a demo fallback: it does not
perform full CEP-18 `transfer_with_authorization` settlement or exhaustive
EIP-712 signature verification. The CSPR.cloud x402 facilitator is wired as
an alternative settlement path for production and requires `CSPR_CLOUD_TOKEN`.

### Cross-chain portability (the differentiating claim)

`capabilityHash("kyc.basic")` produces the same 32-byte hash on
Pharos Atlantic and Casper Testnet because both adapters use the same
off-chain keccak256 implementation in `@ligis/core`. The same
secp256k1 issuer key can sign a credential on both chains, and the
off-chain signature verifies on either because the EIP-712 domain
separator is per-chain (chain name + contract package hash). A demo
at `scripts/cross-chain-credential-demo.ts` shows the same
`0x3896aa82..235f35e3e` from both chains with the same issuer EVM
address.

### Use of the Casper AI Toolkit

- **Odra 2.8.1** — contracts (AgentId, CredentialRegistry)
- **x402 protocol** — Trust Gate endpoint + EIP-712 client
- **CSPR.cloud** — RPC for tests, optional facilitator
- **0G Compute** — TEE-verified LLM for the reasoner (Qwen 2.5 7B)
- **0G Storage** — evidence anchoring with on-chain root
- **MCP** — `mcp-server` package exposes the same gate as a
  discoverable agent tool (with `chain="casper"` branch)

## Long-term launch plan

- Track active capability issuers on `ligis.vercel.app` (already
  live, chain-aware at `?chain=casper-testnet`)
- Promote `0xB85D3E...` to a public-good issuer for `kyc.basic`
  on Casper Mainnet once Buildathon results land
- Publish a public Casper Mainnet deploy of `AgentId` and
  `CredentialRegistry` in Q3 2026
- Co-author an EIP-712 standard for chain-neutral capability
  hashes with the Casper and Pharos teams (cross-chain
  reputation is the obvious next step)

## Socials / project presence

- Repo: github.com/sneldao/ligis (MIT)
- Web: ligis.vercel.app (live, chain-aware)
- Demo video: github.com/sneldao/ligis/releases/download/buildathon-2026/ligis-demo.mp4
- **CROO Hackathon** (parallel submission): same Casper contracts power CAP services on [agent.croo.network](https://agent.croo.network) — see [`docs/croo-hackathon-submission.md`](croo-hackathon-submission.md)
- Twitter / X: (to be added before submission)

## Documentation

- README: setup, demos, deployed contracts
- `docs/casper-buildathon.md` — submission plan + day-by-day
  roadmap + demo storyboard
- `docs/architecture.md` — contract design
- `docs/trust-steward-agent.md` — the autonomous loop
- `docs/security.md` — non-custodial design + EIP-712 replay
  protection

## Category tags (for the BUIDL form)

`agent-identity` · `credentials` · `x402` · `rwa` · `defi` · `ai-agent` · `cross-chain` · `mcp` · `eip-712`
