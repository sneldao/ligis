# Ligis `/api/gate` — decide API

Implementation: `web/lib/decide.ts` and `web/lib/gate-run.ts`. Arena still uses
its own judge. This document describes tested behavior, not a future API plan.

## Transport

`POST /api/gate` accepts JSON. `GET /api/gate` accepts equivalent query fields.
Both return a no-store `Decision`. **HTTP 200 means a decision was returned,
not GO.** Read `verdict` or `X-Ligis-Gate-Verdict`; STOP and UNKNOWN must not
authorize payment. The endpoint does not settle a payment.

```ts
type PaymentIntent = {
  payee: string;
  amountUsd: number;
  purpose: string;
  capability?: string;
  mandate?: {
    payees?: string[];
    maxUsd?: number;
    expectedUsd?: number;
    scope?: string;
  };
  pageText?: string;
};
```

The parser requires a nonempty payee/purpose and finite positive amount.
`capability` is not inferred from purpose. GET mandate fields are
`mandatePayees` (comma-separated), `mandateMaxUsd`, `mandateExpectedUsd`.

Caller JSON and query mandates are **unauthenticated claims**, useful for
previews, not protected operator authorization. A wallet integration must
authenticate its operator policy. `DecideDeps.operatorPolicy` is a
server-owned injection seam; its mandate is independently enforced, and
caller terms cannot relax it. No public request field sets this policy,
trust-source configuration, or the evidence flag.

## Four signals, always

```ts
type VerdictStatus = "GO" | "STOP" | "SKIPPED" | "UNKNOWN";
type Signal = {
  id: "right-payee" | "right-amount" | "in-scope" | "verified-payee";
  status: VerdictStatus;
  confidence: number; // 0..1, zero for unresolved checks
  reason?: string;
  latencyMs?: number;
  // verified-payee only:
  chain?: string;
  capabilityHash?: string;
  credentialId?: string;
  expiresAt?: string;
  revoked?: boolean;
  issuer?: string;
  evidence?: PayeeEvidence[];
};
type Decision = {
  verdict: "GO" | "STOP" | "UNKNOWN";
  signals: Signal[]; // canonical order shown above
  latencyMs: number;
  costUsd?: number; // Jev's reported/derived cost, not a billing guarantee
  provenance: string[];
};
```

| Signal         | Implemented behavior                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| right-payee    | Case-insensitive mandate allowlist. No contractual payee means SKIPPED, even when Jev compares the payment to itself.           |
| right-amount   | Mandate ceiling and contracted price. Above `expectedUsd * 1.10` STOPs, even below the ceiling. No ceiling/quote means SKIPPED. |
| in-scope       | Jev scope and request-normality flags; obvious page-injection patterns can also STOP. A page judge GO cannot mask Jev STOP.     |
| verified-payee | Legacy capability credential check, or opt-in open-world evidence composition described below.                                  |

STOP from a mandate or model always wins. Jev is supplementary; it cannot
relax an operator constraint. `amountUsd` is human-readable intent input.
Its six-decimal USDC representation for Jev is **not** an on-chain payment
binding or proof of settlement.

## Default: legacy credential mode

`LIGIS_PAYEE_EVIDENCE_ENABLED` defaults off. Only the exact string `1`
enables evidence mode. Default mode preserves:

- Missing credential → verified-payee STOP.
- Revoked, expired, or self-issued credential → STOP.
- Missing capability or failed credential read → SKIPPED.
- STOP wins; payee and amount must both GO before aggregate GO.
- Other SKIPPED signals remain neutral, as in the existing implementation.
  In particular, a complete mandate with Jev disabled can still GO.
- No external payee-evidence reader is invoked.

This compatibility behavior does not change the x402 server's credential
access control. Evidence is not a replacement for an x402 access capability.

## Opt-in open-world mode

Server-owned `LIGIS_PAYEE_EVIDENCE_ENABLED=1`:

1. Jev, credential resolution, and external source reads dispatch concurrently.
2. Successful credential reads with no matching record produce source
   `unknown`, not a negative. The top-level verified-payee is UNKNOWN unless
   another eligible source establishes trust.
3. Read failures produce source `unavailable`, distinct from successful absence.
   Credential-source unavailability always blocks a positive aggregate.
4. Any relevant negative wins, including revoked/self-issued credentials on
   another queried rail. Positives never mask negatives by selecting a maximum.
5. All four top-level signals must GO for aggregate GO. UNKNOWN/SKIPPED cannot
   silently become GO. Missing intent evaluation therefore remains UNKNOWN.
6. `operatorPolicy.requiredCapability` (or server environment
   `LIGIS_PAYEE_REQUIRED_CAPABILITY`) resolves that specific capability instead
   of the caller's chosen one. Missing required credential STOPs; unavailable
   required reads yield UNKNOWN. Identity, history, and reputation do not
   grant KYC, accreditation, or any capability.
7. `operatorPolicy.requiredSources` (or `LIGIS_PAYEE_REQUIRED_SOURCES`,
   comma-separated source names) requires each selected source to be positive.
   Missing, UNKNOWN, or unavailable required sources block GO. Invalid environment
   source names also block GO. Default: no additional required source.
8. Positive eligibility defaults to `ligis-credential` and qualifying
   `erc8004` evidence. Nansen requires a server-owned `eligibleSources`
   opt-in at integration. `x402-settlement` is never independently eligible,
   even when its history is verified.

Negative evidence from any supplied reader still STOPs. Optional source gaps
remain visible in `evidence` and `provenance` even when another eligible source
answers positively. Mark a source required if its unresolved answer must veto GO.

```ts
type PayeeEvidence = {
  source: "ligis-credential" | "erc8004" | "x402-settlement" | "nansen";
  status: "positive" | "negative" | "unknown" | "unavailable";
  reason: string;
  observedAt: string;
  chainId?: number;
  reference?: string;
  limitations: string[];
};
```

Source status is not a gate verdict. See [payee-evidence.md](payee-evidence.md)
for discovery, trusted-client policy, settlement provenance, and coverage limits.

## Budgets, receipts, and privacy

`LIGIS_PAYEE_EVIDENCE_TIMEOUT_MS` defaults to 4000 ms, bounded to 1–10000.
Each source is abort-aware; the orchestrator also bounds injected readers
that ignore abort. Evidence orchestration has a 100 ms completion margin so
per-source timeout records can be retained. Credential rails are individually
bounded so an early revoked result is not erased by another rail's outage.
Existing RPC/Jev transports cannot always cancel an already-dispatched legacy
workflow. New evidence readers do not dispatch further reads after abort.

No decision cache is added. Decisions are snapshots, not guarantees against
revocation between the read and actual payment.

`GateDecision` displays UNKNOWN distinctly from STOP and retains source
reasons, timestamps, references, and gaps. Receipt mapping keeps all four
signals, folds UNKNOWN/SKIPPED to `unknown`, and retains the original status
and source evidence in metadata. Open-world reputation is a `risk` receipt
signal, not a claimed capability.

Previews invoke no recorder and publish no ERC-8004 feedback. `runGateDecision`
has a separate server-only authenticated-opt-in recorder injection for worker D;
no route wires it. Enabling it requires actual authentication/consent and a
coordinator update to `docs/positioning.md` and the matching `/embed` privacy
promise. Aggregate verdict counters remain unchanged; payees and amounts are
not passed to them.

## Tests

Injected RPC, GraphQL, Jev, credential, and settlement doubles exercise
absence/outage, non-demo identities, wallet changes, multiple IDs, pagination,
decimal scaling, independence exclusions, negative precedence, protected
policy, recorder opt-in, and no-history-only GO.

```sh
pnpm --filter @ligis/web test
pnpm --filter @ligis/web typecheck
pnpm lint:design
pnpm --filter @ligis/envio-indexer codegen
pnpm --filter @ligis/envio-indexer typecheck
pnpm --filter @ligis/envio-indexer test
pnpm --filter @ligis/web build
```

These tests are not live chain or paid Jev proof.
