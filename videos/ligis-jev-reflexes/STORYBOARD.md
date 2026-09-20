---
format: 1920x1080
message: "The gate has reflexes — every payment gets a typed GO/STOP intent read in ~436ms, billed at $0.00. Live as ligis.gate on CROO."
arc: Hook → Receipt → Stress → Close
audience: Twitter/X — launch-week Jev audience (devs, agent builders), plus the Casper / Pharos / CROO ecosystems
music: none — muted-first, captions carry it (add a bed later if wanted)
duration: 28s
---

v2 note (2026-09-20): same duration and scene boundaries as v1; the empty space
and dead gaps are filled with the ecosystem narrative instead of being cut
longer. `ligis.gate` shipped as a real CROO service first, so every CROO claim
on screen is honest.

## Frame 1 — Hook (0s..3s)

- scene: Warm paper. Fraunces display: "An agent was about to pay a stranger." Then the GateVerdict
  primitive lands: ✗ STOP in revoke red, left hairline rule, with the mono stat line beneath.
  NEW v2: a quiet bottom rail draws in — casper-testnet (credential registry) ·
  pharos-atlantic (agent economy) · CROO agent store — placing the story in its
  ecosystems from the first frame without touching the hook's whitespace.
- duration: 3s
- transition_in: cut (from black/paper)
- status: built
- captions: none — the display line IS the caption
- asset_candidates: none — pure typography + verdict primitive

Real numbers only: 0.96 confidence, 436ms, $0.00 — all from the live 2026-09-20 AI Gateway run.

## Frame 2 — The receipt (3s..12s)

- scene: Paper-deep terminal (no dark mode — house style) types the curl and the five X-Jev-\*
  response headers land one by one: STOP, 0.960, 436, 0.00000000, flags. Right column: the four
  questions as a hairline ledger with sage ✓ / revoke ✗ marks, plus the reflex-not-authority note.
  NEW v2: a full-width architecture strip fills the former dead zone (9–12s used to be blank
  paper): THE AUTHORITY (credential registry — on-chain, casper-testnet) · THE REFLEX (jev —
  4 questions, one parallel call, 436ms) · THE SETTLEMENT (x402 — waits for both · judged for
  $0.00). The whole receipt now holds to ~11.3s instead of fading at 8.6s.
- duration: 9s
- transition_in: cut
- status: built
- captions: header values are self-captioning; note paragraph carries the "how"; the strip
  carries the "where it runs"
- asset_candidates: none — the real response headers from `curl -i` against the live gate

## Frame 3 — Under load (12s..20s)

- scene: The stress table from `pnpm demo:jev` as ledger rows: legit → ✓ GO 0.93, underpay →
  ✗ STOP 0.98, overpay → ✗ STOP 0.93, misdirected → ✗ STOP 0.96, each with a latency bar filling
  to its real relative decision time. Stats line: 8 requests · 6 flagged · $0.00000000 total ·
  billed by the AI Gateway. NEW v2: ecosystem lines draw in beneath the stats —
  ● cross-chain: capabilityHash("data.premium") identical on casper + pharos (the portability
  beat, straight from the cross-chain demo), and ● sold as a service: ligis.gate · intent +
  credential pre-flight · CROO Agent Store (the launch announcement, made honest by shipping
  the service first).
- duration: 8s
- transition_in: cut
- status: built
- captions: table is self-captioning; mono stats + ecosystem lines close the beat
- asset_candidates: none — rebuilt natively from scripts/jev-stress-demo.lastrun.txt (8-request
  run: 4 scenarios × 2 waves)

## Frame 4 — Close (20s..28s)

- scene: Fraunces display "The gate has reflexes." (terra used exactly once, on "reflexes").
  Hairline rule, links line: ligis.vercel.app/gate + the numbers + github.com/sneldao/ligis.
  NEW v2: closing sub-line announces the product — "live now as ligis.gate on the CROO Agent
  Store" — and a bottom rail names the stack while the hold runs: casper-testnet ·
  pharos-atlantic · CROO agent store · 0G compute · vercel ai gateway.
- duration: 8s
- transition_in: cut
- status: built
- captions: display line is the caption
- asset_candidates: none — typography

## Design rules honored (web/DESIGN.md)

- Warm paper only; no dark terminal, no gradients, no rounded chrome, no shadows
- Fixed color semantics: sage = GO/good, revoke = STOP/loss, terra = ceremony (once), ink-soft = meta
- All numerals JetBrains Mono tabular; verdicts rendered as ✓ GO / ✗ STOP everywhere
- Containment by hairlines + whitespace, never boxes; one staggered reveal per scene; transforms are
  color/position only (bar fills are the sanctioned meter animation, matching the live UI)
- Every on-screen number traces to a real artifact: scripts/jev-stress-demo.lastrun.txt, the
  2026-09-20 live-gateway run, and the shipped ligis.gate service descriptor
