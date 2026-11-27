# Jev — intent evaluation layer

## Jev Intent Evaluation (implemented, opt-in)

The x402 Trust Gate has an optional intent layer built on **Jev**, TypeSafe's
System One model (launched 2026-09-15). It reads _what the paying agent is
trying to do_ and annotates every gate decision (401/402/200) with a GO/STOP
signal — a reflex, not an authority. The credential check remains the source
of truth; without the layer (or when Jev is unavailable) the flow is unchanged.

The Jev client lives in **`@ligis/core` (`packages/core/src/jev.ts`)** so it is
shared: the x402 gate imports it, and the CROO adapter's `ligis.gate` service
(see [croo.md](croo.md)) sells the same pre-flight read — intent
verdict + credential check in one deliverable, dispatched concurrently.

### Jev API facts

Two interchangeable routes — identical wire shapes (Choice/Score/Noul,
confidence, `input_tokens`), different base URL + credential. Select with
`LIGIS_JEV_TRANSPORT=gateway|direct|auto` (default auto: gateway when
`AI_GATEWAY_API_KEY` is set, else direct when `TYPESAFE_API_KEY` is set,
else gateway so the skip reason names the key we want):

- **AI Gateway (free promo ran through 2026-09-25)**:
  `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`, auth
  `AI_GATEWAY_API_KEY`, model slug `typesafe-ai/jev`. Responses carry
  `provider_metadata.gateway.cost` (billed USD) — used directly for
  `X-Jev-Cost-Usd`, so it read 0 during the promo. That window is closed:
  either attach billing/BYOK to the gateway key, or use the direct route
  (`TYPESAFE_API_KEY` + `LIGIS_JEV_TRANSPORT=direct`) — which is what the
  Vercel deployment has run since 2026-10-18. Because the layer is fail-open,
  a dead route looks like nothing at all at runtime — verify with
  `pnpm smoke:jev` (below) rather than assuming.
- **TypeSafe direct**: `POST https://api.typesafe.ai/v1/systemone`, auth
  `TYPESAFE_API_KEY` (console.typesafe.ai, early access), model `jev-latest`
  (response reports the versioned id — log it). Cost derived from input
  tokens at $0.042/MTok, output free.

Shared behavior:

- Send `{ model, state, questions }`; get `{ model, answers, usage }`. Text
  state only. All questions in one call evaluate in parallel against the same
  state (~100ms typical, 70–500ms range).
- Primitives: **Choice** → `{ choice, probabilities, confidence }`; **Score**
  → `{ score, legend, probabilities, confidence }` (score can land between
  levels); **Noul** → `{ noul }` (0–1 probability, no separate confidence).
- Adding questions barely changes latency — ask atomic questions, compose in
  code (TypeSafe's "Composite Scoring" + "Confidence-Gated Routing" patterns).
- Implementation uses plain `fetch`, not the early-access `@typesafe-ai/sdk`
  (the gateway's TypeSafe-compatible endpoint accepts the same shapes).

### The four-question gate fingerprint

One parallel call, atomic questions, composed in `@ligis/core` (`jev.ts`):

| id                    | type   | flag when                             | catches                                |
| --------------------- | ------ | ------------------------------------- | -------------------------------------- |
| `scope`               | Choice | choice=inconsistent, conf ≥ min       | request inconsistent with capability   |
| `amount_plausibility` | Score  | score ≤ 0.5 (implausible), conf ≥ min | under/over-payment vs capability value |
| `payee_consistency`   | Noul   | noul ≤ 0.3                            | payee mismatch vs advertised payTo     |
| `request_normality`   | Noul   | noul ≤ 0.3                            | abnormal request pattern               |

Verdict: STOP if any flag fires, else GO. STOP confidence = max flag
confidence; GO confidence = mean of the Choice/Score confidences.

Policy questions with computable answers (e.g. "is this payment redundant
for something the subject already holds?") stay in code — in this gate's
semantics paying while credentialed is the happy path, and a boolean doesn't
need a model. Jev is for judgments an `=IF()` cannot make.

### Transport smoke test

Fail-open means a broken route is invisible: the gate keeps serving payments
while every verdict silently becomes `SKIPPED`. `scripts/jev-transport-smoke.ts`
(`pnpm smoke:jev`) calls `evaluatePaymentIntent` directly — no gate server, no
chain RPC, no credential — with two probes (legit → GO, misdirected → STOP)
and exits non-zero the moment Jev stops answering, printing the resolved route
and the fix. Run it in CI or a cron; `scripts/jev-transport-smoke.lastrun.txt`
records the last run, including billed USD (a non-zero cost on the real
gateway means the promo is over).

```bash
set -a; source .env.d/typesafe.env; set +a   # or .env.d/aigateway.env for the gateway route
LIGIS_JEV_ENABLED=1 pnpm smoke:jev
```

Against a stub, override the URL so the report isn't mistaken for gateway
promo evidence:

```bash
npx tsx scripts/jev-stub.ts &   # :4099, model jev-stub-1.0
LIGIS_JEV_ENABLED=1 LIGIS_JEV_API_KEY=stub \
  LIGIS_JEV_API_URL=http://localhost:4099/v1/systemone pnpm smoke:jev
```

### Prod watchdog (`pnpm watchdog:jev`)

`smoke:jev` proves the route from a machine that holds a key; it says nothing
about the deployment. `scripts/jev-prod-watchdog.mjs` asks production's own
`POST /api/gate` and reads its provenance: it fails when no line starts
`jev `, when the verdict word after `jev ` is `skipped`, or when the
parenthesised group has a third comma-separated part (the abstain shape —
`jev skipped (direct, 0ms, layer disabled)`). It deliberately ignores the gate
verdict itself, so an expiring fixture does not look like an outage.
`.github/workflows/jev-watchdog.yml` runs the parser self-test and then this
daily at 06:30 UTC — no secrets, no install step, ~$0.00005 of the server's key
per run.

### Placement (differs from the original sketch)

Jev dispatches CONCURRENTLY with the on-chain credential read and always
precedes settlement:

```
1. subject parse → 400            (no Jev — nothing to judge)
2. Jev dispatch + credential read, in parallel
3. 401/402/settle branches — every response carries the verdict
```

Rationale: the Casper credential read shells out synchronously to the
`casper-client` CLI (blocking), so dispatching Jev first keeps its ~100ms
latency honest instead of queueing behind RPC work. The verdict still lands
on 401s — intent is judged even for rejected agents.

For the same reason the gate has an optional short-TTL credential cache:
`LIGIS_GATE_CREDENTIAL_TTL_MS` (default 0 = off; e.g. 30000 for demos). A
cached GO can lag a revocation by up to the TTL — keep prod use deliberate.

### Config

- `LIGIS_JEV_ENABLED=1` (default off — the layer is opt-in)
- `AI_GATEWAY_API_KEY` (gateway route — what `auto` prefers when both keys
  exist) or `TYPESAFE_API_KEY` (direct route — what the Vercel deployment is
  configured for); `LIGIS_JEV_API_KEY` overrides either
- `LIGIS_JEV_TRANSPORT` = gateway | direct | auto (default auto)
- `LIGIS_JEV_API_URL` / `LIGIS_JEV_MODEL` — override the resolved route's
  URL / model slug (gateway defaults: …/typesafe/v1/systemone +
  `typesafe-ai/jev`; direct defaults: api.typesafe.ai/v1/systemone +
  `jev-latest`)
- `LIGIS_JEV_MIN_CONFIDENCE` (0.6), `LIGIS_JEV_TIMEOUT_MS` (4000 — headroom
  over Jev's 70–500ms for the gate's blocking casper-client reads),
  `LIGIS_JEV_ENFORCE` (off; =1 → 403 on confident STOP)

Fail-open: missing key, timeout, non-200, or malformed response → verdict
SKIPPED and the flow proceeds unchanged. Jev never blocks a payment unless
enforce mode is explicitly enabled.

### Telemetry

Every gated response carries `X-Jev-Verdict`, `X-Jev-Confidence`,
`X-Jev-Latency-Ms`, `X-Jev-Cost-Usd`, `X-Jev-Model`, `X-Jev-Flags` headers;
200 bodies include a `jev` block. `GET /verdicts?limit=N` (CORS-enabled)
serves an in-memory ring buffer of the last 50 verdicts.

`web/components/JevTelemetry.tsx` (client) polls `/verdicts` on the gate
(`NEXT_PUBLIC_LIGIS_GATE_URL`, default http://localhost:4040) and renders the
live verdict waterfall on `/gate`.

### Stress demo

```bash
LIGIS_JEV_ENABLED=1 TYPESAFE_API_KEY=... pnpm x402:dev   # terminal 1 (direct — the prod route)
# or: LIGIS_JEV_ENABLED=1 AI_GATEWAY_API_KEY=... pnpm x402:dev  (gateway, promo closed)
pnpm demo:jev                                                # terminal 2
```

Fires legit / underpay / overpay / misdirected-payee requests at the gate in
configurable waves and prints a per-request verdict table plus totals (wall
time, avg decision latency, total cost, flagged count). 401s are expected
without a deployed credential — the Jev headers land regardless. Set
`LIGIS_GATE_CREDENTIAL_TTL_MS=30000` on the gate so repeated subjects don't
re-run the blocking casper-client CLI reads.

No early-access key yet? Run the stub upstream instead:
`npx tsx scripts/jev-stub.ts` + `LIGIS_JEV_API_URL=http://localhost:4099/v1/systemone`
— verdicts are labeled `jev-stub-1.0` so they're never mistaken for real ones.

### Live verification (2026-09-20, AI Gateway)

Real Jev through the AI Gateway confirmed working end-to-end: key stored at
`.env.d/aigateway.env` (gitignored), direct probe 582ms round-trip,
`provider_metadata.gateway.cost: "0"` during the promo, noul/choice/score
shapes identical to the native API. Gate responses carry real verdicts and
flags; the first request after a cold start reads ~2–3s of latency from the
blocking casper-client reads (absorbed by the TTL cache afterwards).

State enrichment (human-readable amounts, operator-declared price +
capability class, `code_checks` facts) lifted verdict confidence across the
board on the stress demo: legit GO 0.49 → 0.93; underpay STOP 0.84 → 0.98;
overpay STOP 0.77 → 0.93; misdirected STOP 0.92 → 0.96. Warm decisions run
~350–650ms.

### Live verification (2026-09-23, AI Gateway — `pnpm smoke:jev`)

Two days before the promo closes, the transport still answers: legit probe GO
conf 0.950 in 1323ms (cold, first call), misdirected probe STOP conf 0.970 in
443ms with `payee-mismatch`, `scope-mismatch`, and `abnormal-pattern` flags —
cost reported as $0.00, so the free window was still open. Recorded in
`scripts/jev-transport-smoke.lastrun.txt`. Re-run the smoke test on or after
2026-09-25: a non-zero billed cost there means billing started, an exit 1 means
the route is dead and the gate is quietly credential-only.

### Live verification (2026-10-18, Vercel production — direct route)

`LIGIS_JEV_ENABLED=1`, `LIGIS_JEV_TRANSPORT=direct` and a TypeSafe key are set on
the deployment; env vars added after a deployment do not bind to it, so this
needed a Clean Redeploy. Production provenance now reads
`jev go jev-1.13.0 (direct, 127ms)`, measured $0.00004918 per call at 75–160 ms
inside a ~1.0–2.4 s decision dominated by the credential read. Enabling it did
**not** make Jev catch the filmed injection — the layer never receives
`pageText` (`jevInput`, `web/lib/decide.ts:439`), and its `in-scope` confidence
on those probes was 0.515–0.545, under the 0.6 bar; see `docs/paybox-ch1.md`
§11b. `pnpm watchdog:jev` is what keeps this from silently rotting.

### Marketing notes

Launch-week Jev demos (ads teardown, lead scoring, browser agent) are all
speed/cost flexes. Our equivalent: _every payment through the gate gets an
intent read in ~100ms for fractions of a cent_ — and the evidence is one
curl away (`curl -i` any gate response, read the Jev headers). Visual-first
surfaces that exist today: the header capture, `pnpm demo:jev` table, and
the `/gate` telemetry waterfall. Tagline: "the gate has reflexes."

### Web demo sample credentials

`scripts/seed-demo-credentials.ts` idempotently re-issues `kyc.basic`,
`agent.commerce.escrow`, and `rwa.accredited` (1-year expiry) to the demo
subjects in `web/lib/demo-subjects.ts` (EVM: `0xd21a…`; Casper:
`account-hash-c769…`) using the steward key — never the deployer key, which
would create self-issued credentials the gate rejects. The script pins
`LIGIS_NETWORK` per branch (pharos → `atlantic-testnet`, monad →
`monad-testnet`) so a shell exporting one network can't seed the wrong chain,
refuses to run when the steward wallet equals the demo subject, and exits 1
if the result is still self-issued. Run when fixtures expire (next:
~2027-09-24):

```bash
LIGIS_STEWARD_KEY=… npx tsx scripts/seed-demo-credentials.ts [pharos|monad|casper]
# omit the arg to seed all three; the steward wallet needs gas on Pharos + Monad
```

Afterwards `pnpm smoke:demo-credentials` (now covering Pharos + Monad +
Casper, incl. the Casper deployer-EVM self-issued check) must exit 0.

**Monad fixtures** (see `web/lib/demo-subjects.ts`):

| Sample             | Capability                   | Expected       |
| ------------------ | ---------------------------- | -------------- |
| verified agent     | `agent.commerce.escrow`      | GO             |
| revoked credential | `demo.metropolis.revocation` | STOP · revoked |
| unverified wallet  | `kyc.basic` on `0x…dEaD`     | STOP · none    |

Do **not** re-issue `demo.metropolis.revocation` — it is the live revoked
fixture from `pnpm demo:monad`. CI runs `pnpm smoke:demo-credentials` weekly
(`.github/workflows/demo-credentials.yml`) so expiry / accidental re-issue
fails the Action instead of the public demo.
