# Consolidation plan — post-hackathon foundation (2026-11-28)

> Written after Zecathon, GenLayer Agent Tank, and Metropolis all closed
> without a win. Purpose: honest postmortem, then the slimmed-down end
> state, then the focused next steps. This doc is a plan, not positioning —
> `docs/positioning.md` remains the source for what Ligis is.

## Part 1 — Postmortem: what actually won

Evidence is uneven across the three venues (Metropolis is well-documented;
Zecathon and Agent Tank winner detail is thin in public indexing — noted
honestly rather than guessed at). The pattern needs no completion to be read.

**Metropolis (Monad, 885 teams, $250k+) — full winner list published:**

- Grand Champion: **Corpus** — an endowment layer for compute: historic
  cloud pricing onchain as x402 price feeds, ownership of compute shares,
  "a service on a machine can keep running long after its maintainers move
  on." A concrete, novel primitive with a story you can retell in one
  sentence. Notably: it _used_ x402 as an ingredient — it did not pitch it.
- Onchain Finance winners: capped claims on H100 rental prices, a perpetual
  futures exchange for event markets, a tradable GPU-hour price. Every one
  is a thing a named user can _do_ — trade, hedge, position — today.

**Monad's prior AI hackathon (11 winners, per earnkit analysis):**

- Agent payments/settlement (3), agent dev-tools (3), trading agents (2).
- Example winners: OpenAlice (a full local trading agent — research,
  strategy, execution, risk, one product one loop), TickPay (high-frequency
  streaming micropayments for APIs — one use case, sharply drawn).

**Zecathon / Agent Tank:** winner detail is not well-indexed publicly
(Zecathon announced Nov 23; Agent Tank results live behind the GenLayer
portal). What is visible: ZecHub-ecosystem hackathon winners historically
are consumer-shaped privacy apps (checkouts, streaming, payroll), and the
Agent Tank format — community rates every build — structurally rewards
things that demo well in a browser over infrastructure.

**The pattern across all of it:**

1. Winners are products with users and loops, not infrastructure. A judge
   can retell what Corpus or TickPay _does_ in one sentence and imagine
   using it. Nobody retells a credential registry.
2. "Trust, identity, verification" is the track where infrastructure goes
   to lose. Judges cannot feel verification in a demo; they can feel a
   payment, a trade, a checkout. We entered exactly this track at
   Metropolis.
3. x402 appears in winning projects as an _ingredient_, never as the pitch.
   The winning rail is invisible inside a product story.
4. Our evidence model was correct in spirit but we did not hold it: the
   gated-vault artifact was stale-or-false, and two of three submission
   evidence trails were months old at judging time. Even if a judge never
   checked, we were pitching surfaces we could not have defended live.

**The loss is not "the technology is wrong."** The market research
(2026-11-28, Tavily scan) independently validates the space and the
differentiation: agentic payments ~$49.5B in 2026 growing ~25%/yr, the
competitive field crowds rails not authorization evidence, KYA is
crystallizing as a category. The loss is about _shape_: we entered as
infrastructure, judged by people who reward products.

## Part 2 — What we keep: the slimmed-down end state

The rule: **keep what a skeptic can verify in five minutes, freeze what
exists only for a venue that has closed, cut what costs rent and returns
nothing.**

### Keep (the product core)

- **The procurement controller** (`packages/procurement`) — the lead
  product per the positioning doc, validated by the market scan: order-bound
  payment control is the uncrowded layer. Airwallex executor, GO/STOP/REVIEW,
  evidence-linked decisions.
- **The stateless gate** (`POST /api/gate`, `/gate` UI) — the distribution
  surface. Four signals, Jev intent layer, x402-facing. Live in production,
  smoke-tested weekly in CI.
- **The credential layer as ingredient** — v2 Casper registry, live
  accreditation enforcement, multi-chain adapter design. It powers the
  verified-payee signal. It is _infrastructure we own_, never again the pitch.
- **The evidence discipline** — CI security floor, smoke fixtures, honest
  docs culture, the proof bench. This is now a brand asset, not overhead.

### Freeze (keep the code, stop paying rent)

- **Showcase packages**: `adapter-genlayer`, `contracts-genlayer`,
  `circuits-zcash`, `adapter-zcash`, the `/arena` surface. Their venues are
  closed. Remove them from the typecheck/build critical path (they are the
  source of the red noise that hides real regressions), stop extending,
  revisit only if a specific future venue needs them.
- **Stale chains as live demos**: Monad and Pharos fixtures can stay in the
  smoke (they pass cheaply), but no new work. Zcash shielded presentation
  and ZK reputation evidence remain research documents, not commitments.

### Archive or cut

- **Web surface**: collapse 20+ routes to the product path — gate, proofs,
  procurement demo, steward. Everything else unlinked from navigation;
  genuinely dead routes removed. One front door, one path.
- **GatedVault demo**: already retired as evidence (2026-11-28). Repair
  only if a future venue specifically needs an on-chain enforcement demo;
  the repair path is documented.
- **Dependency weight** that only served showcase surfaces — audit when
  the freeze lands; the dependabot/security churn should drop measurably.
- **Hackathon docs**: move to `docs/archive/` per the existing pattern.
  `docs/proofs.md` rewritten as a bench of three artifacts (below).

### The proof bench, rebuilt

Three artifacts, each verifiable by a skeptic in under five minutes,
each with a freshness date:

1. **The production gate** — live verification with on-chain accreditation
   enforcement. CI-smoked weekly. _This exists today._
2. **The procurement controller end-to-end** — order in, payment decision,
   Airwallex executor, settlement-linked evidence. Refresh the Nov 27 run
   and keep it fresh. _Mostly exists; needs a repeatable one-command run._
3. **The honest ledger** — a short public doc of what does not work yet
   and why. Counterintuitive but decisive: it is the artifact that makes
   the other two believable.

## Part 3 — Focused next steps, in order

1. **Mechanical consolidation** (one session, reversible): freeze showcase
   packages out of the build critical path, prune web navigation to the
   product path, archive hackathon docs, rewrite `docs/proofs.md` as the
   three-artifact bench.
2. **The product-shape decision** (a conversation, not code): the
   positioning doc says product-first — payment control for platforms
   running finance agents. Confirm or amend. Everything below assumes
   confirmed.
3. **Make the gate reachable**: the x402-server currently runs nowhere.
   If the gate is distribution, merchants need a live endpoint to integrate
   against. One deployed instance, one documented integration path.
4. **One product-shaped demo** — the anti-hackathon lesson applied: not a
   verification trace but a user story. "An agent tries to pay a supplier;
   Ligis stops the duplicate, catches the changed bank details, approves
   the legitimate invoice — here is the evidence for all three." Runnable
   in one command, fresh by construction.
5. **If hackathons again** — and only after 1–4: enter as a product in a
   product track, never as infrastructure in a trust track. Demo the user
   story. Bring exactly three proof artifacts. The Corpus lesson: use the
   rails as ingredients, pitch what the user _does_.

## What this plan deliberately does not do

- Does not abandon the credential layer — it is the moat ingredient.
- Does not pick a commercial go-to-market — that is strategy.md's job,
  after the product-shape conversation.
- Does not repair the vault, extend chains, or start new surfaces.
- Does not treat the hackathon losses as a verdict on the technology.
  They are a verdict on shape, and shape is cheap to change.
