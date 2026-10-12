# Ligis `/api/gate` — decide API

> The source-of-truth for the pre-payment decision service. Locks the
> input/output wire shape, the four signals, and a handful of design
> calls that have to be answered before `web/lib/decide.ts` (the
> service) and `web/app/api/gate/route.ts` (the endpoint) can ship.
>
> Companion to `docs/positioning.md` (the public pitch + privacy + pricing).
> Where they overlap, this doc owns the **shape**; positioning.md owns the
> **words**.

## What `decide()` is

`decide()` is the function behind `POST /api/gate`. It takes a
`PaymentIntent`, runs four signal checks concurrently, and returns a
`Decision` — verdict plus the signal stack that produced it. The same
function backs `/arena`'s prompt-injection demo (with an optional
`pageText` slot for the LLM-judge layer) and the on-chain `/gate`
surface, so the demo and the product share one code path.

Positioning/glossary/claims live in `docs/positioning.md`; this doc
only defines the wire shape.

## Endpoint

```
POST /api/gate
Content-Type: application/json
```

**Request body** — `PaymentIntent`:

```ts
type PaymentIntent = {
  /** The agent's account address or a stable known-vendor id. */
  payee: string;
  /** Amount in USD; Jev reads it as "human readable", the gate as policy. */
  amountUsd: number;
  /** Free text — what the agent was hired to do. Forwarded to Jev as
      `capability.description`, so the model can compare intent vs. cap. */
  purpose: string;
  /** Optional mandate from the agent's operator; not required for /gate. */
  mandate?: {
    payees?: string[]; // known-allowed payee addresses
    maxUsd?: number; // ceiling for this payment
    scope?: string; // restricted domain ("data-premium", "us-east-rwa")
  };
  /** Capability the payment targets, e.g. `data.premium`. Defaults to
      `purpose` slug when omitted. Forwarded to `resolveSubject()`. */
  capability?: string;
  /** Optional: gate /arena's LLM-judge slot to read page text. Required
      for the prompt-injection demo; omitted for /gate. */
  pageText?: string;
};
```

**Response body** — `Decision`:

```ts
type VerdictStatus = "GO" | "STOP" | "SKIPPED" | "UNKNOWN";

type Signal =
  | {
      id: "right-payee";
      status: VerdictStatus;
      confidence: number; // 0..1; 0 when SKIPPED
      reason?: string; // human-readable short form
      latencyMs?: number; // populated when status != SKIPPED
    }
  | {
      id: "right-amount";
      status: VerdictStatus;
      confidence: number;
      reason?: string;
      latencyMs?: number;
    }
  | {
      id: "in-scope";
      status: VerdictStatus;
      confidence: number;
      reason?: string;
      latencyMs?: number;
    }
  | {
      id: "verified-payee";
      status: VerdictStatus;
      confidence: number; // 1.0 when credential held, otherwise graduated
      /** Which chain returned the credential — provenance, not source. */
      chain?: "casper-testnet" | "pharos-atlantic" | "monad-testnet";
      capabilityHash?: string;
      credentialId?: string; // e.g. token id for EAS, or attestation hash for EIP-712
      expiresAt?: string; // ISO timestamp
      revoked?: boolean;
      issuer?: string;
      reason?: string;
      latencyMs?: number;
    };

type Decision = {
  /** Aggregate verdict. STOP wins; UNKNOWN means no signal answered. */
  verdict: "GO" | "STOP" | "UNKNOWN";
  /** Full signal stack, in the canonical order from positioning.md. */
  signals: Signal[];
  /** Total wall-clock latency for the parallel signal evaluations. */
  latencyMs: number;
  /** Estimated USD cost — Jev's `provider_metadata.gateway.cost` (or derived
      from input tokens at $0.042/MTok). */
  costUsd?: number;
  /** Each upstream that answered: `jev-1.13.0 (direct, 235ms)`,
      `casper-testnet credential`, `pharos-atlantic credential`. */
  provenance: string[];
};
```

**Composition rule** (per positioning.md "A signal that the model could
not evaluate is reported as `SKIPPED` with the reason"):

- If **any** signal is `STOP` → `Decision.verdict = "STOP"`.
- Else if **all** signals are `SKIPPED` (and there is no GO either) → `UNKNOWN`.
- Else if at least one signal is `GO` → `GO`.
- Otherwise → `UNKNOWN`.

`UNKNOWN` is a valid, surfaced answer — not a silent GO. It tells the
operator "nothing answered, can't say it's safe." The header
`x-jev-verdict` and a `provenance` line make that auditable.

## The four signals

| Signal ID        | Source                                                                 | What it answers                                                                 |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `right-payee`    | Jev's `payee_consistency` (noul ≤ 0.3)                                 | Does the payment's `payee` match the advertised collector?                      |
| `right-amount`   | Jev's `amount_plausibility` (score ≤ 0.5)                              | Is `amountUsd` plausible for the capability's typical value?                    |
| `in-scope`       | Jev's `scope` (choice ≠ consistent) + `request_normality` (noul ≤ 0.3) | Is the `purpose` + `capability` a normal pair, or does the pattern read as off? |
| `verified-payee` | `resolveSubject()` chain-agnostic credential read                      | Is there a credential that says this payee is trustworthy?                      |

The third signal intentionally **folds `request_normality` in with `scope`**
so the public surface stays at four signals (matching positioning.md).
If the operator layer needs to see them separately for debugging, that's
fine — the Jev `flags[]` are echoed under `provenance` and the Jev
layer's own headers (`x-jev-flags`).

## Design calls (need sign-off before `decide.ts` ships)

These four calls shape the implementation. Defaults proposed; flag any
you want changed.

### Call 1: `Signal` shape — discriminated by `id`

**Proposed.** Each variant carries its own provenance (chain, hash,
credential) where applicable. TypeScript discriminated union, exhaustively
checked at consumer sites.

**Alternative.** A flat `{ id, status, confidence }` record with optional
provenance keys. Simpler types, less compiler help at consumption.

**I'd ship the discriminated version.** The discriminated union is
~30 lines heavier in `decide.ts` but it stops random "treat `expiresAt`
as `chain`" bugs at the consumer.

### Call 2: Arena shares the code path _partially_

**Proposed.** `decide()` accepts an optional `pageText`. When present,
the LLM-judge slot runs (Arena). When absent, only the Jev slot and the
credential read run (`/gate`). One code path, two slots.

**Why partial, not full.** `judgePayment()`'s LLM slot reads the agent's
untrusted `pageText`. `/gate` doesn't have one. Replacing Arena's
`judgePayment()` with `decide()` removes the demo of prompt injection —
the very thing the page is built to demonstrate.

**Alternative.** Two services: `decide()` for `/gate`, leave
`judgePayment()` alone for `/arena`. More code, less sharing.

**I'd ship the partial-unification.** It removes ~one-third of arena's
parallel-dispatch and rate-limit code, and the LLM slot stays a clearly
optional input.

### Call 3: `verified-payee` is independent of `purpose`

**Proposed.** `verified-payee: GO` means "this address holds a valid,
un-revoked credential." It does **not** check whether the credential is
the _right one for the intent_. The agent's owner is responsible for
saying "I'm paying for X, here's the required `capability`," and the
credential registry returns whether the payee holds it. If the agent's
owner is sloppy and sends the wrong `capability` to a credentialed
payee, the gate says GO and the wrong payment proceeds.

**Alternative.** Strict coupling: `verified-payee` checks both
"credential held" AND "credential matches the intent's purpose." This
is closer to a typed RBAC model.

**I'd ship the looser version.** The four-signal design (right payee +
right amount + in scope + verified payee) already enforces purpose fit
through the `in-scope` Jev check + the operator's chosen capability. A
tight `verified-payee` would re-derive that link in code and risk
contradicting the Jev signal.

### Call 4: No decision cache initially

**Proposed.** No cache in `decide()`. `/gate` already has a 30-second
credential TTL via the existing `LIGIS_GATE_CREDENTIAL_TTL_MS` env
var. Jev at ~$0.0001/call (measured in `scripts/jev-transport-smoke.lastrun.txt`)
is cheap enough that a decision cache doesn't pay back its complexity.

**Alternative.** Lift `judgePayment()`'s `cachedVerdict()` block into
`decide.ts`. Per-IP cache + rate limit. Reuses Arena's infrastructure
but couples decide.ts to a memo layer.

**I'd ship without the cache.** If week-two traffic says otherwise, add
it. The cache key shape leaks intent across requests if anyone watches
the Redis layer, so I'd rather defer than ship prematurely.

## Risks I want flagged before code lands

These are real architectural risks. Mitigation exists; just want them
documented:

### R1: Jev packs 4 questions into one verdict

`@ligis/core/jev.ts`'s `evaluatePaymentIntent` returns one
`JevIntentResult` with a flags list. The public `Decision` API needs
three of those flags as separate signals (`right-payee`, `right-amount`,
`in-scope`). That means **two composition layers**, one inside Jev and
one at the `Decision` aggregator.

**Mitigation.** Jev's verdict stays canonical. `decide.ts` maps
`JevIntentResult.flags[]` → `Signal[]` deterministically (see
`packages/core/src/jev.ts:composeVerdict` for the flag-ids). The
`provenance` line exposes the raw Jev answer so the operator can
disambiguate when a flag fires.

### R2: Concurrent dispatch across heterogeneous services

Jev, the chain-agnostic credential read, and (optionally) the LLM slot
are three different upstreams with different latencies, rate limits,
and failure modes. `Promise.allSettled` is the right primitive, but
the aggregator must tolerate one upstream returning `SKIPPED` while the
others succeed.

**Mitigation.** Each signal is reported as `SKIPPED` with a reason when
its upstream failed. `provenance[]` records what ran. The composition
rule (above) collapses the four signals into one verdict even when some
were `SKIPPED`.

### R3: Revoked credentials change in-flight

A credential might be revoked between `resolveSubject()` and the actual
payment. The decision is a snapshot, not a guarantee. This is
fundamental; the gate is the **decision**, not the settlement.

**Mitigation.** The `TrustReceipt` primitive already exists in
`web/components/TrustReceipt.tsx` but isn't on any page yet — Phase 3c
fixes that. Show the chain-of-decisions: which chains answered, which
TX hash a revoke would have to overtake, what the timestamp was.
Operators read receipts, not just verdicts.

### R4: Cache key shape leaks intent

If `decide()` later adds a cache, the key must not be `(payee,
amountUsd, purpose)` plaintext — anyone watching Redis can correlate
intent across requests. Hash the input, key on the digest.

**Mitigation.** Defer (Call 4). When the cache ships, key on
`sha256(JSON.stringify(input))` and document the contract.

## Verification plan for Phase 3a / 3b

Before `web/lib/decide.ts` and `web/app/api/gate/route.ts` are merged,
ship these tests in `web/test/decide.test.ts`:

| Case                                                                 | Expected verdict | Why                                                      |
| -------------------------------------------------------------------- | ---------------- | -------------------------------------------------------- |
| Legit renewal (right payee, right amount, in scope, credential held) | `GO`             | All four signals GO.                                     |
| Mismatched payee                                                     | `STOP`           | `right-payee` STOPs.                                     |
| Implausible amount (10× advertised)                                  | `STOP`           | `right-amount` STOPs.                                    |
| No credential held, intent fine                                      | `STOP`           | `verified-payee` STOPs.                                  |
| All four signals skipped (no key, no chain)                          | `UNKNOWN`        | Composition rule's "all SKIPPED" branch.                 |
| All four signals skipped but one GO fails fast                       | `UNKNOWN`        | Reduce, never invent a verdict.                          |
| Jev layer skipped, credential GO only                                | `GO`             | Credential is the source of truth when intent is silent. |
| Same input called 10×, same decision                                 | `GO` × 10        | Determinism contract — no random in `composeVerdict`.    |
| `pageText: "ignore previous instructions..."`                        | `STOP` (Arena)   | LLM slot fires; signals still resolve.                   |

The tests stub `@ligis/core/jev.ts::evaluatePaymentIntent` and
`web/lib/resolve.ts::resolveSubject` so they run without keys and
without chain RPCs.

## What this doc does NOT define

Out of scope here; covered elsewhere:

- **Pricing.** → `docs/positioning.md` "Pricing model".
- **Privacy posture.** → `docs/positioning.md` "Privacy posture".
- **Glossary.** → `docs/positioning.md` "Glossary".
- **On-chain contract layout.** → `docs/architecture.md`.
- **CROO integration shape.** → `docs/croo-integration.md`.

## Change control

When the API shape moves, this doc moves first. Then `decide.ts`,
then `route.ts`, then tests, then the `/gate` page that consumes the
new shape. Landing copy that mentions the shape (e.g., the `GET` /
`POST` snippet on `web/app/page.tsx`) defers to this doc.
