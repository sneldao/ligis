# Ligis — Monad Metropolis: Trust, Identity & AI Infrastructure

> **Hackathon**: Metropolis (Monad)
> **Track**: Trust, Identity & AI Infrastructure
> **Prize**: $30,000 USD split evenly among 3 winners ($10,000 each) + $25,000 grand champion picked across all tracks
> **Key dates**: registration/build window 1 Sep – 13 Oct 2026; judging 14–27 Oct; winners announced 3 Nov. (This doc previously listed "14 Oct 04:59 GMT+1" as the deadline — treat the platform's authenticated portal as authoritative for the exact cutoff and whether mainnet or testnet qualifies.)
> **Status**: core contracts + credential lifecycle live on Monad testnet; web
> reads work via the chain switcher; **server-custodied steward writes are on**
> (`writeReady: true`, `LIGIS_STEWARD_KEY`). Browser wallet connect still
> deferred. History: public RPC 100-block windows work free; full history via
> Envio (`packages/envio-indexer`, `LIGIS_ENVIO_GRAPHQL_URL`). ERC-8004 / P256
> still open.
> **Live product today**: [ligis.vercel.app](https://ligis.vercel.app) (Casper Testnet + Pharos Atlantic + Monad testnet)
> **Research update**: 2026-09-24, via Parallel.ai (verify claims in the rules section against the portal before submission)

This track is for protocol-level primitives: trust, provenance, and user-owned
data that other applications build on — not a standalone consumer product.

Ligis already _is_ that primitive (`isCapable(subject, capability)` before
money or context moves). The work for this track is to land it on Monad with
Monad-native building blocks, not to invent a new product.

---

## Verified event brief (Parallel.ai research, 2026-09-24)

Public rules confirmed from monad.xyz/metropolis + hackathon.monad.xyz:

- **Existing projects/teams are allowed, but the submitted work must be built
  during the build window (1 Sep – 13 Oct).** Repackaging the pre-existing
  Casper/Pharos product would not qualify — the Monad-native delta (ERC-8004,
  P256/WebAuthn, write path, live integrations) is exactly the new work, and
  most of it post-dates 1 Sep anyway. Frame the write-up around what was
  **built in-window on Monad**.
- **Mainnet-vs-testnet is NOT settled in the public rules.** The FAQ says
  build "on Monad"; nothing publicly mandates chain 143 mainnet. Ask in the
  Discord / check the portal. Fallback posture: build so a mainnet cutover is
  one config change (it already nearly is).
- **Submission profile**: working product, demo, short write-up, code link;
  public GitHub repo readable by `metropolis@hackathon.monad.xyz`.
- **No substantive judging rubric is published** — no supported weighting of
  novelty vs polish. Earlier platform research floated percentage weights;
  the Fit table below keeps the buckets only and drops the numbers.
- **Sponsor bounties** (verified on the public page). Do **not** chase all of
  them — that dilutes the track win. Rank:
  | Priority | Bounty | $ | Angle |
  | --- | --- | --- | --- |
  | **Ship** | Best use of Envio | 1k | HyperIndex solves the public-RPC `eth_getLogs` gap — real fix, free bounty |
  | **Ship one of** | Best use of Dynamic / Privy | 5k each | agent/operator passkey accounts, sponsored txs (also unlocks spectacle #6) |
  | Opportunistic | MetaMask agent-wallet plugin | 2.5k | the gate as a plugin in the wallet an agent pays from |
  | Opportunistic | Mera: One Passkey, Many Keys | 2.5k | one operator key → many agent wallets; maps to issuer-key hygiene |
  | Opportunistic | Best use of Nansen | 5k | gate-decision + agent-spend analytics |
  | Opportunistic | Chainlink CRE | 3k | gate enriched with offchain signals |
  | Opportunistic | Best Community Team Project | 5k | second-team integration push, done in the open |
- **After the event** is arguably the bigger prize: top teams get Nitro
  Accelerator / DeltaV residency access, and "the trust gate for autonomous
  payments" is a pitchable company. DeltaV Demo Day is **6 Oct, Open in
  Singapore** — before the submission deadline; worth a parallel application.
- **Every team in the build window gets**: 3 months QuickNode Build Plan, 2
  months Spectrum Business, 1 month Zerion Builder, 1 month Pro
  simulate/debug/monitor, Dwellir Developer free.

### Monad state as of Sep 2026 (what the research actually confirmed)

- **MIP-12 hard fork landed 23 Jul 2026**: 300 ms blocks, **600 ms
  deterministic finality** (was 400/800). Per-block gas 150 M, ~500 Mgas/s.
- **RPC latency change (exploitable)**: `newHeads` and log subscriptions now
  fire on **Proposed**, `latest` points at the latest proposed block, earlier
  receipts available — this is what makes a live gate feed look instant.
- **Slot-level parallel execution**: contention is checked per storage slot,
  so many agents writing their own gate slots in one contract is the
  embarrassingly-parallel shape — a load demo is a Monad-native primitive
  demo. Avoid one shared accumulator/write-hot slot in the decision log.
- **Gas is charged on `gasPrice × gasLimit`**, not used gas: estimate tight;
  padded limits cost real money.
- **Toolchain**: Foundry 1.8+ with Monad revisions (`MONAD_NINE`,
  **`MONAD_TEN` activated 2 Sep 2026** on mainnet); bytecode is Fusaka-
  compatible; EIP-7702 supported; precompiles documented.
- **Privacy, with honesty**: **Unlink** (private accounts, Groth16/UTXO) is
  live on mainnet and is the credible "private credential submission" story.
  **BTX encrypted mempools are a pilot on two nodes** (per the Foundation's
  Sep 2 report) — do not claim BTX network-wide in the write-up.
- **Ecosystem gaps that are actually our gaps**: Alchemy/QuickNode mainnet
  support incl. logs/streams/webhooks; Envio HyperSync/HyperIndex first-class
  on Monad; native USDC + CCTP; MetaMask processed >1M gasless Monad txs
  (sponsorship is proven at scale).
- A draft MIP for **upgradeable account authentication (P256→post-quantum
  path)** exists — a good one-line "why this primitive compounds" aside, not a
  feature to build on.

---

## Fit

Weights below are directional (see note above); the buckets themselves match
the track framing. Percentages are omitted from the table — cite buckets,
not invented scores.

| Criterion                   | Weight\* | Ligis today                                           | What to ship for judges                                                                                                             |
| --------------------------- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Technical execution         | —        | Sound capability hashes, issuer keys, on-chain verify | Deploy on Monad testnet/mainnet. Use **P256/WebAuthn** and **ERC-8004** as first-class, not Ligis-only identity. No leaked secrets. |
| Design & craft              | —        | Strong visual field                                   | They mean **developer experience**: one-read API, docs, copy-paste snippet. The field is optional proof, not the score.             |
| Originality & track insight | —        | Same `capabilityHash` on Casper and Pharos            | “Not capturable by one platform.” Monad as a third chain makes that claim real. Credentials-on-a-chain alone will look generic.     |
| Founder & market readiness  | —        | Gate-before-payment is a specific buyer               | Name the integrator (x402, CROO, one other hackathon team). “Agents in general” loses this bucket.                                  |
| Traction & path forward     | —        | Live Casper/Pharos, CROO listing                      | **Another team integrating during the event**, plus a post-event integration plan.                                                  |

\*Earlier research floated 20/20/15/25/20 — **no public rubric confirms those
numbers**. Keep the column only as a reminder that founder readiness and
traction are the heavy buckets; do not cite percentages in the write-up.

**Belongs here if** the primary output is infrastructure. Pitch
`isCapable(subject, capability)` as the trust read any Monad agent calls
before money or context moves. Do not pitch Ligis as a consumer identity
explorer.

Closest suggested starting points from the brief
(numbering **01/04/06** is from the earlier Metropolis brief; the public page
now shows four tracks — the mapping below is what survives):

- **06** — onchain credential attestations any application can verify without
  a middleman (this is Ligis today)
- **01** — mobile-native proof of personhood via WebAuthn/P256 (Monad’s
  actual differentiator; the originality delta versus “we also deployed”;
  now Track 4's first example bullet)
- **04** (user-owned AI memory) is a future app _on_ Ligis, not Ligis itself.
  Do not recenter the pitch there. Track 4's third bullet (media provenance)
  is not ours either.

Monad building blocks to actually use:

- Native P256 precompile for WebAuthn verification (Track 4's example bullet
  is literally "passkey-native accounts using P256 and WebAuthn")
- ERC-8004 as the trustless agent registry — wrap, don’t fork (also a named
  Track 4 example)
- **Unlink** private accounts (live on mainnet; encrypted UTXO notes +
  ERC-4337 sponsorship) if private credential submission is in scope. BTX
  encrypted mempools are a **two-node pilot** — mention only as future work,
  never as a shipped dependency.
- Proposed-block RPC (`newHeads` on Proposed, `latest` = proposed) for the
  live gate feed; 600 ms deterministic finality is the "why Monad" number.
- EIP-7702/4337 + paymaster sponsorship (Alchemy Gas Manager or equivalent)
  so agents and judges never see a gas prompt.

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

- **Browser wallet writes are deferred on Monad.** The steward API writes via
  a server-custodied `LIGIS_STEWARD_KEY` (same pattern as Pharos);
  `writeReady: true`. Connected MetaMask / passkey wallets are still Phase 3
  (Dynamic/Privy bounty).
- **`eth_getLogs` on Monad's public RPC is capped at 100 blocks** (measured
  2026-09-24 — not a method rejection). Web scans 60 × 100-block windows
  (~30 min at 300 ms) for free. **Full history:** deploy
  `packages/envio-indexer` (HyperSync-backed, free API token) and set
  `LIGIS_ENVIO_GRAPHQL_URL` — also the $1k Envio bounty entry. Alchemy/QuickNode
  participant plans remain a free alternative if Envio is slow to stand up.
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

1. **Stand up Envio** (`pnpm envio:dev` + free `ENVIO_API_TOKEN`, set
   `LIGIS_ENVIO_GRAPHQL_URL`) so `/issuers` and capability timelines see full
   Monad history — doubles as the Envio bounty entry. Public-RPC recent window
   already works without this.
2. Fund `LIGIS_STEWARD_KEY` on Monad testnet (or reuse the deployer key for
   demos) and run a live steward revoke → gate flip for the Revocation film.
3. Explorer source verification (testnet now; mainnet the moment the network
   question is answered).
4. ERC-8004 registration as the Monad-native hook + P256/WebAuthn issuer —
   these two ARE the track's example bullets; missing them reads as "we also
   deployed."
5. A second team calling `isCapable` during the event — the actual traction
   score. Recruit at the London (2 Oct) or Singapore (6 Oct) Metropolis
   Lounge activations; Singapore is DeltaV Demo Day, two-way overlap.

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

## Spectacle plan — a gate that can be _seen_ kill

A GO/STOP API read is not visceral; judges remember moments. Tag each beat
honestly — several still depend on the write path or P256 work below. The
spectacle is staging of real paths, not scope expansion.

| Tag                 | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| **Ready**           | Can film on Monad testnet (or Casper/Pharos stand-in) today |
| **Blocked: writes** | Needs Monad `writeReady: true` + wallet network check       |
| **Blocked: P256**   | Needs WebAuthn/P256 issuer + sponsored gas path             |
| **Blocked: Envio**  | Needs log-capable RPC / HyperIndex for a rich feed          |

1. **The Revocation (demo centerpiece, ~20s).** **Ready (CLI)** /
   **Partial (steward API)** — server-custodied writes are wired; fund the
   steward key on Monad and film. Mid-stream x402 kill still needs a payment
   loop on Monad (deferred). Stage N live agents paying for services
   (x402 loop running, ledger ticking). On stage, revoke one credential.
   Within one Monad block the counterparty's gate flips GO → STOP and its
   payments fail mid-stream. Cut to that agent's terminal: _"payment
   refused — capability revoked 0.6s ago."_ (Script the stopwatch against
   **proposed-block** receipt time, not "finality" — proposed tips arrive
   sooner than the 600 ms deterministic number.) This is the product's
   entire value proposition as a single act: **the kill switch is only
   impressive because the chain is fast enough for it to be instantaneous.**
   Time it on screen with the block explorer open beside the terminal.
   **Placement:** put a short live revoke in the **3-min technical demo**
   (judges who skip the optional ad must still feel the product); save the
   cinematic edit for the ≤30s advertisement / pitch open.
2. **Decision-storm ledger wall.** **Blocked: Envio** for a dense history
   feed; a thin live stream of concurrent gate reads is **Ready** once a
   few agents hammer `isCapable`. Fullscreen feed where every gate read
   that has _consequences_ writes an append-only decision record — one
   storage slot per record, so a burst of parallel agents lights it up
   without contention. That is Monad's slot-level optimistic execution
   made visible. Do **not** claim "~3 decisions/sec" until a measured
   multi-writer load proves it (300 ms blocks alone are tip updates, not
   parallel throughput). Works as ambient background in the pitch video
   and as a booth/lounge monitor. Cheap once Envio lands: same events
   `/field` already renders, unzoomed, auto-scrolling.
3. **Stranger-pay drill, stopwatch on screen.** **Ready** for the gated
   STOP half (live `/gate` reads on Monad today). The "no gate → paid a
   scammer" loss stick is staged narrative — label it as a contrast demo,
   not an on-chain loss, unless you actually send and recover funds in a
   dedicated demo wallet. Two agents that have never transacted attempt
   payment: no gate → show the loss stick; gate on → STOP at ~600 ms. One
   take each, side by side. The comparison _is_ the pitch, and it gives
   the 3-min demo video its before/after.
4. **A rogue agent worth stopping.** **Ready** (reads + steward writes once
   key is funded). Run a deliberately bad actor all week against **dedicated
   demo wallets only**, labeled in the write-up as an "adversarial fixture"
   — no spam against third-party agents or public services. Unverified
   issuer, spinning fake reputation, trying to pay fixture counterparties.
   The ledger accumulates real STOPs. "This week the gate refused $X from
   strangers, all on-chain, each one reversible with one tx" — numbers you
   can put in the write-up that no other Track 4 entry can fake.
5. **Human-vs-agent scoreboard (borrowed evidence, zero build).** **Ready.**
   Sekats' audited poker-agent numbers — 6,243 advisory suggestions, 6
   promoted, 84.3% human/agent agreement — as the _problem slide_:
   autonomous agents demonstrably can't audit themselves; a gate is the
   missing primitive. **Pin the source URL in the submission write-up**
   before citing (this doc does not yet hold a canonical link — add it
   when confirmed). One honest, sourced stat beats any claim.
6. **Passkey theatre for the Track-4 bullet.** **Blocked: P256** (+
   Dynamic/Privy or equivalent for embedded wallet + gas sponsorship).
   On camera: a stranger signs up with a passkey (WebAuthn/P256, no seed
   phrase), gets an embedded agent wallet, receives a credential, and the
   gate reads it — all on Monad, gas sponsored, chain invisible. That
   sequence checks the track's first example bullet on screen instead of
   asserting it in prose.

Rules of restraint: nothing staged may be fake — every GO/STOP in the video
must be a live mainnet/testnet tx with an explorer link; the 30 s
"advertisement" slot (explicitly not judged) is for the cinematic Revocation
edit, **not** the only place the kill switch appears.

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
3. One Monad-native extra: WebAuthn/P256 issuer or agent auth, or
   **Unlink**-based private credential submission (live on mainnet; BTX is a
   two-node pilot — do not depend on it).
4. A second team calling `isCapable` during the hackathon.
5. DX docs a stranger can integrate in ten minutes (this _is_ the Design score).
6. Two videos as specified — storyboard them around the Spectacle plan; a
   short live Revocation opens the **3-min technical demo**, cinematic edit
   goes in the pitch / ≤30s ad.

UX for `/` and `/field` is in progress independently — it helps the demo, it
does not win the track on its own.
