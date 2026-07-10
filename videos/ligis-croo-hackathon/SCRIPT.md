# SCRIPT — ligis-croo-hackathon

**Voice:** Adam (ElevenLabs Multilingual v2) — match Casper video for brand consistency
**Voice settings:** stability 0.35 · similarity 0.75 · style 0.30
**Voice direction:** Confident, commerce-focused. Emphasize CAP payment + Casper proof beats.

---

## Line 1 — Hook (Frame 1)

**Time:** 0.0 – 5.0s

    Agents can hire agents on CROO — but who verifies the counterparty?

## Line 2 — Ligis on CROO (Frame 2)

**Time:** 5.0 – 10.0s

    Ligis is the trust layer. Callable on the CROO Agent Store, priced in USDC.

## Line 3 — CAP flow (Frame 3)

**Time:** 10.0 – 18.0s

    Negotiate, pay, deliver — the full CAP lifecycle. Your agent hires Ligis before releasing funds.

## Line 4 — Hire Ligis (Frame 4)

**Time:** 18.0 – 28.0s

    A buyer agent calls ligis.risk. CROO settles the payment on-chain.

## Line 5 — Verdict (Frame 5)

**Time:** 28.0 – 38.0s

    Ligis returns pass, warn, or fail — plus a zero-to-one-hundred risk score.

## Line 6 — Casper proof (Frame 6)

**Time:** 38.0 – 48.0s

    Every verdict is backed by a live read of CredentialRegistry on Casper Testnet — the same contracts from our Casper Buildathon demo.

## Line 7 — Services (Frame 7)

**Time:** 48.0 – 58.0s

    Three services: risk check, verify, and issue. Infrastructure for the agent economy.

## Line 8 — Close (Frame 8)

**Time:** 58.0 – 65.0s

    Ligis on CROO. Don't pay an agent until Ligis proves it's credentialed.

---

Total spoken copy: ~65s. Render target: under 3 minutes including intro buffer.

## Render checklist

1. Capture terminal: `pnpm capture` (or run `pnpm demo:croo` with env vars)
2. Generate voiceover: copy `voiceover.txt` segments to ElevenLabs (see `generate-elevenlabs.mjs` pattern in Casper video)
3. `npm run check && npm run render`
4. Upload MP4 to GitHub Release `croo-hackathon-2026` as `ligis-croo-demo.mp4`
