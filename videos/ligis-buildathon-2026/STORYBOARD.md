---
format: 1920x1080
message: "Ligis gives AI agents portable on-chain identity and verifiable credentials — live on Casper Testnet."
arc: Hook → Problem → Solution → Proof → Payoff → CTA
audience: Casper Agentic Buildathon 2026 judges and builder community
music: driving, cinematic electronica with a builder-energy pulse; tempo ~128 BPM; no lyrics
---

## Frame 1 — Hook

- scene: Big kinetic type on warm cream — "AI agents are getting smarter"
- duration: 5s
- transition_in: cut
- status: outline
- voiceover: AI agents are getting smarter — but they’re still anonymous.
- asset_candidates: none — pure typography

Open cold on the tension. Agents have wallets and LLMs, but no way to prove who they are or who vouches for them. This is the hook the whole video pays off.

## Frame 2 — The Gap

- scene: Three cards drop in: wallet, brain, question mark — "no portable trust"
- duration: 5s
- transition_in: crossfade
- status: outline
- voiceover: A wallet isn’t an identity. A prompt isn’t a permission.
- asset_candidates: none — icons + typography

State the problem in one beat. Agents need portable, revocable, verifiable credentials — just like humans need IDs and certifications.

## Frame 3 — Ligis

- scene: Logo lockup + product thesis — "Portable identity. Verifiable credentials."
- duration: 5s
- transition_in: cut
- status: outline
- voiceover: Ligis fixes that. Portable on-chain identity plus signed, revocable capability credentials.
- asset_candidates: Ligis wordmark, captured web homepage background

Introduce Ligis as the solution. Show the brand and the two core primitives: AgentId and CredentialRegistry.

## Frame 4 — The Load-Bearing Fact

- scene: Split screen — Casper hash on left, EVM hash on right, identical 32-byte value in the middle
- duration: 5s
- transition_in: wipe
- status: outline
- voiceover: The same capability hash is recognized on Casper and on EVM.
- asset_candidates: code snippet of capabilityHash("data.premium")

Establish cross-chain portability. The capability name hashes to the same 32 bytes on both chains, so the same issuer key signs once and the credential is valid everywhere.

## Frame 5 — Mint AgentId

- scene: cspr.live screenshot of mint_self transaction, with tx hash and result card
- duration: 5s
- transition_in: crossfade
- status: outline
- voiceover: On Casper Testnet, an agent mints its own identity.
- asset_candidates: 02-cspr-smoke-mint.png, 05-cspr-e2e-mint.png

First live proof. Show a real AgentId.mint_self transaction on cspr.live.

## Frame 6 — Sign + Issue Credential

- scene: Terminal output of signing credential + cspr.live issue tx side by side
- duration: 8s
- transition_in: cut
- status: outline
- voiceover: The Trust Steward signs an EIP-712 credential, and the Casper contract recovers the issuer on-chain using secp256k1.
- asset_candidates: 03-cspr-smoke-issue.png, terminal log snippet from smoke test

Second live proof. This is the key differentiator: on-chain signature recovery in Odra using k256. Bad signatures and wrong issuers are rejected.

## Frame 7 — Autonomous Loop

- scene: Steward loop diagram boot → reason → gate → act → record, with 5 tx hashes flowing in
- duration: 8s
- transition_in: crossfade
- status: outline
- voiceover: The Steward runs the full autonomous loop: boot, reason, gate, act, record — all on Casper.
- asset_candidates: 06-cspr-e2e-rwa-accredited.png, 07-cspr-e2e-x402-commerce.png, 08-cspr-e2e-data-premium.png, 09-cspr-e2e-set-token-uri.png

Show the system working end-to-end. Multiple credentials issued, 0G evidence anchored. This is the agentic part of the story.

## Frame 8 — x402 Payoff

- scene: Credential gates access to paid RWA data; 402 → sign → 200 → CSPR settled
- duration: 8s
- transition_in: wipe
- status: outline
- voiceover: That credential unlocks a paid x402 endpoint — credential verified, payment settled on Casper.
- asset_candidates: 10-cspr-x402-settlement.png if available, otherwise terminal x402 demo log

The consumption of trust. The credential isn’t just decorative; it gates real economic activity — premium tokenized real-estate data paid for with CSPR.

## Frame 9 — Close

- scene: Big type + live links — "Ligis. Portable trust for the agent economy."
- duration: 6s
- transition_in: crossfade
- status: outline
- voiceover: Ligis is live on Casper Testnet. Portable trust for the agent economy.
- asset_candidates: 10-web-home-casper.png

End with the thesis restated and the project live. Clean lockup with repo / demo links.
