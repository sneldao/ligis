# Ligis — Monad Metropolis: Trust, Identity & AI Infrastructure

> **Hackathon**: Metropolis (Monad)
> **Track**: Trust, Identity & AI Infrastructure
> **Prize**: $30,000 USD split evenly among 3 winners ($10,000 each)
> **Deadline**: 14 Oct 2026, 04:59 GMT+1
> **Status**: core contracts deployed on Monad testnet; web integration pending
> **Live product today**: [ligis.vercel.app](https://ligis.vercel.app) (Casper Testnet + Pharos Atlantic)

This track is for protocol-level primitives: trust, provenance, and user-owned
data that other applications build on — not a standalone consumer product.

Ligis already _is_ that primitive (`isCapable(subject, capability)` before
money or context moves). The work for this track is to land it on Monad with
Monad-native building blocks, not to invent a new product.

---

## Fit

| Criterion                   | Weight | Ligis today                                           | What to ship for judges                                                                                                             |
| --------------------------- | ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Technical execution         | 20%    | Sound capability hashes, issuer keys, on-chain verify | Deploy on Monad testnet/mainnet. Use **P256/WebAuthn** and **ERC-8004** as first-class, not Ligis-only identity. No leaked secrets. |
| Design & craft              | 20%    | Strong visual field                                   | They mean **developer experience**: one-read API, docs, copy-paste snippet. The field is optional proof, not the score.             |
| Originality & track insight | 15%    | Same `capabilityHash` on Casper and Pharos            | “Not capturable by one platform.” Monad as a third chain makes that claim real. Credentials-on-a-chain alone will look generic.     |
| Founder & market readiness  | 25%    | Gate-before-payment is a specific buyer               | Name the integrator (x402, CROO, one other hackathon team). “Agents in general” loses this bucket.                                  |
| Traction & path forward     | 20%    | Live Casper/Pharos, CROO listing                      | **Another team integrating during the event**, plus a post-event integration plan.                                                  |

**Belongs here if** the primary output is infrastructure. Pitch
`isCapable(subject, capability)` as the trust read any Monad agent calls
before money or context moves. Do not pitch Ligis as a consumer identity
explorer.

Closest suggested starting points from the brief:

- **06** — onchain credential attestations any application can verify without
  a middleman (this is Ligis today)
- **01** — mobile-native proof of personhood via WebAuthn/P256 (Monad’s
  actual differentiator; the originality delta versus “we also deployed”)

**04** (user-owned AI memory) is a future app _on_ Ligis, not Ligis itself.
Do not recenter the pitch there.

Monad building blocks to actually use:

- Native P256 precompile for WebAuthn verification
- ERC-8004 as the trustless agent registry — wrap, don’t fork
- BTX encrypted mempools if private credential submission is in scope

Core contracts are deployed on Monad testnet (10143), the full credential
lifecycle has been exercised live, and the web app reads Monad through its
existing chain switcher. Not yet done: browser write paths, explorer source
verification, and Monad-native differentiators (ERC-8004, P256/WebAuthn).

### Deployment proof (2026-09-17)

- Agent ID: [`0x7371bf6c8cBedcbb6B3da78c1da080e408cA7987`](https://testnet.monadscan.com/address/0x7371bf6c8cBedcbb6B3da78c1da080e408cA7987)
  - Transaction: `0xd1ed393518bc0d3a7c8e21295b6735d7d3d682b7753215ba52c502eb0aede3c1`
  - Block: 63359413; runtime bytecode: 5120 bytes.
- CredentialRegistry: [`0x698e1C05d34e2b6d0B6eCd71f3fC9e84e64733c5`](https://testnet.monadscan.com/address/0x698e1C05d34e2b6d0B6eCd71f3fC9e84e64733c5)
  - Transaction: `0x163b3dc90e4f9bf45c98e86a34e1153665425dd63f38195c7789d99e1328898f`
  - Block: 63359414; runtime bytecode: 6128 bytes.
- Both receipts independently read from RPC: success.
- Total deployment cost: 0.352318092003420564 MON.
- Addresses recorded under `deployment.monad-testnet` in the shared network config.
- Source verification is **not** complete; bytecode presence and successful
  reads do not constitute explorer source verification.

### Credential lifecycle proof (2026-09-17)

`pnpm demo:monad` (→ `scripts/monad-lifecycle-demo.ts`) runs mint → issue →
gate → revoke → re-gate against the addresses above and exits non-zero on any
mismatch. Canonical recorded run (`scripts/monad-lifecycle-demo.lastrun.txt`):

| Step       | Transaction                                                          |
| ---------- | -------------------------------------------------------------------- |
| `mintSelf` | _(skipped — controller already held Agent ID #1)_                    |
| `issue`    | `0x1be64aa96abeb6625b89382c3f6873056904e9d15ed4fcbee8bb15098bce7cc5` |
| `revoke`   | `0xb023185a96cd8c508d40e6d09aa23033fb24b9e4752a4e55c530abdd988a37a4` |

- Controller: `0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec`
- `capabilityHash("kyc.basic")` = `0x71389c3c607929c3bacb18fee6a304d8e2f68a55746507b46d1b9529064596d5`
- `isCapable()` returned `true` after issuance and `false` after revocation
  (`gateBefore=true`, `gateAfter=false` in the lastrun file).
- A separate live credential was left in place for `rwa.accredited` so the web
  gate has a genuine GO example on Monad
  (`0xc6d548456954d63836c8e6fae35c93bf78b2e997a10826b5acd1a5bcb880dfd3`).
- The issuer is the same key as the controller, so this is the self-issued demo
  path — not a third-party attestation flow.

### Web integration (live)

Monad appears through the existing chain control as a network context, not a new
product route. What is wired today:

- `web/lib/chain.ts` builds a memoized read context per EVM network; reads take
  an explicit network and throw rather than falling through to Pharos.
- The UI slug and the `assets/networks.json` key are bridged by `evmNetwork`
  (the Public id `pharos-atlantic` does not match the config key
  `atlantic-testnet`). This mismatch silently served Pharos data under a Monad
  label before it was fixed, and is now covered by `web/test/network.test.ts`.
- Verified live: `/gate` returns `✓ GO` on Monad for `rwa.accredited` and
  `✗ STOP` for an unheld `kyc.basic`; the landing page shows Monad's own
  contract addresses; `/agent/…?chain=monad-testnet` shows token #1 and the held
  credential. Pharos and Casper were regression-checked and unchanged.

### Known limitations (verify before judging)

- **Browser writes are disabled on Monad.** The steward API route returns 400 and
  the runner shows an explicit message; `writeReady: false` in the chain registry
  is asserted by test.
- **`eth_getLogs` is unavailable on Monad's public RPC** (it rejects the method
  outright), so issuer history and capability timelines cannot be read there.
  `/issuers` states "history is unavailable … unknown rather than empty" instead
  of showing an empty list. Fixing this needs a log-capable RPC provider or an
  indexer.
- **The same cap broke Pharos history silently.** The Pharos RPC rejects ranges
  above 1000 blocks and the previous code requested 200,000, so issuer history
  always failed and was reported as "no issuances". The scanner is now chunked
  and newest-first; the page distinguishes "none found" from "cannot read".
- No ERC-8004 integration, no P256/WebAuthn, no third-party integrator yet —
  these are the originality and traction scores, and they remain open.

### Intuitive UI rollout

Preserve the editorial Gate / Field navigation; Monad is a network context,
not a new product or top-level route.

1. **Make reads network-specific.** Done — every EVM read resolves through the
   selected chain's deployment. Never silently fall back to Pharos under a
   Monad label.
2. **Use the existing chain control.** Done — full labels, network context
   preserved across Gate, Field, agent pages, and explorer links.
3. **Separate deployment from readiness.** Done — the switcher marks Monad
   `read-only`, and write paths refuse rather than mislead.
4. **Treat empty as empty, not an error.** Done — a fresh Monad Field says no
   agents are registered there; an unreadable history says so explicitly.
5. **Keep proof next to the decision.** The gate names network, subject,
   capability, and links explorer evidence.
6. **Validate wallet network before writes.** Still open — required before
   enabling Monad writes.

Shared capability hashes establish a shared namespace, not automatic
cross-chain validity of signatures or replicated credential state.

### Next, in order

1. A log-capable Monad RPC (or indexer) so history views work; then re-enable
   `/issuers` and capability timelines for Monad.
2. Port the write path so Monad becomes `writeReady: true`.
3. Explorer source verification.
4. ERC-8004 registration as the Monad-native hook.
5. A second team calling `isCapable` during the event — the actual traction score.

---

## Product surface (web) — do not confuse the demo with the primitive

User feedback that shaped the current IA:

1. Navigation was packed (Gate, How it works, Steward, Capabilities, Issuers,
   Embed, CROO) and advertised the moat as competing products.
2. The identity field was incredible close-in, then **vanished on zoom-out**
   (camera-Z fade + fog treated zoom as culling). It also shared `/` with the
   landing page, so wheel-zoom fought page-scroll and there was no enter/exit.

Current rules (see `web/DESIGN.md`):

- **Landing (`/`)** — editorial. Paper. Framed invite into the field.
- **Field (`/field`)** — dedicated registry map. Semantic zoom: specimens
  close in, persistent markers far out. Esc / Ligis mark leaves.
- **App (`/gate`, …)** — the verb and the moat. Dock names only Gate and Field.

The field is a _demonstration of the live registry_. For Metropolis, the
3-minute demo should lead with a live gate on Monad, the same capability hash
as Casper/Pharos, then a short flight through `/field` as proof the registry
is real. Not a code walkthrough. Not slides.

An infinite-canvas library (chunk streaming, inertia, pinch) is a camera
reference, not a product architecture. Ligis already chunk-streams; the bug
was LOD, not the absence of a canvas kit.

---

## Deliverables checklist

- [ ] Project logo/graphic (JPG/PNG/WEBP, ≤3MB)
- [ ] Public GitHub repo accessible by `metropolis@hackathon.monad.xyz`
- [ ] Technical demo video ≤3 min (live product, not slides)
- [ ] Pitch video ≤2 min (team, problem, why)
- [ ] Live product on Monad mainnet or testnet + access instructions
- [ ] Optional ≤30s advertisement (not judged)

## Suggested build order

1. Deploy AgentId + CredentialRegistry (+ gate) on Monad testnet.
2. Map agent identity onto **ERC-8004** if that is Monad’s agent registry.
3. One Monad-native extra: WebAuthn/P256 issuer or agent auth, or BTX-aware
   private credential submission.
4. A second team calling `isCapable` during the hackathon.
5. DX docs a stranger can integrate in ten minutes (this _is_ the Design score).
6. Two videos as specified.

UX for `/` and `/field` is in progress independently — it helps the demo, it
does not win the track on its own.
