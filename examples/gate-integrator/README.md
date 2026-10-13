# Fixture-only gate caller

From the repository root (dependencies already installed):

```sh
pnpm exec tsx examples/gate-integrator/demo.ts
node --import tsx --test examples/gate-integrator/caller.test.ts
pnpm --filter @ligis/web exec tsc -p ../examples/gate-integrator/tsconfig.json
```

These commands make no network requests and no payments. Synthetic responses
show GO, UNKNOWN for an unfamiliar payee, and STOP for a policy violation.
The caller sends the current `PaymentIntent` shape, validates the four-signal
response, and invokes an injected exact payment operation once per prepared
instance. This is not a distributed payment retry/idempotency mechanism.

Use `prepareGatedPayment(exactPayment, operatorPolicy, executePayment, options)`
in a separately authorized server integration with explicit `live: true`.
Default fetch is refused without that opt-in; fixtures inject transport.
Freeze the actual payer,
recipient, asset, network and integer amount before calling. USD is an
independent risk input, not a token conversion. Policy must come from operator
configuration, never merchant text. Timeout defaults to 4 seconds (max 10).
The strict caller also requires verified-payee GO, even if the service's
aggregate GO permits weaker evidence. Failed calls never execute payments.

`reportAuthenticatedOutcome` targets `/api/gate/outcomes`. Optional reporting
needs `LIGIS_GATE_OUTCOME_TOKEN` in the integrator's runtime secret store and a
server-issued `X-Ligis-Decision-Id` header from the proposed authenticated hook.
Use `gateToken` for that separately authorized gate request. The callback receives
the transaction hash and server ID; missing correlation skips reporting.
The current public gate response has no such ID. Do not fabricate one.
See `docs/evidence-outcomes.md` for A's proposed hook and
the separate settlement-context schema. No executable live/payment CLI is
provided. No other team/customer/facilitator has been contacted or claimed.
