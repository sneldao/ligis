# Worker D: external evidence and decision/outcome kit

Implement on branch `feat/evidence-outcomes`. Read the shared
[`README.md`](./README.md) first; its ownership and safety rules apply.

## Goal

Supply real external evidence and a small, honest data-collection path:
Nansen payee enrichment, opt-in decision/outcome correlation, and an
integration example that another team can actually run.

Priority order: ship the tested Nansen adapter and runnable caller first,
then the bounded recorder. If credentials or a durable backend are missing,
finish deterministic tests and clearly report the live blockers.

## Context

- Worker A owns the gate and defines the evidence types described in the
  shared README. Your adapter must remain testable without A's branch.
- `web/lib/counters.ts` and `counters-backend.ts` store verdict aggregates,
  not decision/outcome records. Preserve them.
- `web/lib/gate-run.ts` currently records only privacy-light counters.
  Propose your hook to A; do not edit that file.
- `docs/positioning.md` promises server-aggregate-only reads and no client
  tracking. Persistent decision records need a separately documented
  opt-in API policy. Do not enable them for public visitor/embed reads.
- `docs/integrate-monad.md` is largely a strict credential-gating example
  and overstates automatic ERC-8004 feedback. Give the coordinator corrected
  copy without editing that shared file in parallel.

## Implement

### 1. Nansen evidence adapter

Verify current official API/MCP access, supported Monad network, response
schema, costs/rate limits, and label semantics. If connector access is
offered in your environment, use it for discovery rather than bypassing it.
Ask for scoped credentials through runtime secrets, not pasted key values.

Implement `web/lib/payee-evidence/nansen.ts` with a dependency-injected
transport, timeout, and chain context, matching the shared evidence
contract. Plain server-side fetch is sufficient for the application
adapter where the official API permits it.

- Wrong chain, no coverage, missing key, rate limit, timeout, malformed
  data, and provider error produce named unknown/unavailable evidence.
- A documented explicit risk flag can produce negative evidence, with its
  provider reference and limitations.
- Exchange, smart-money, or unlabeled status does not independently mean
  safe, malicious, KYC-approved, or entitled to a capability.
- Preserve provider taxonomy and observation time. Do not manufacture
  Nansen labels or present local fixtures as live provider results.
- Do not request or store trading history/PII that the risk read does not need.

Provide A an exact adapter-wiring proposal. Leave the existing four
top-level gate signals intact; evidence belongs under verified-payee
provenance, not an unrelated fifth sponsor panel.

### 2. Authenticated, opt-in decision/outcome records

Create a separate recorder under `web/lib/gate-outcomes/` and an
authenticated ingestion route under `web/app/api/gate/outcomes/`.
Keep it disabled by default, including when credentials/backend
configuration are absent. A client boolean is not sufficient authorization.

Record the minimum necessary:

- Server-created correlation ID, policy/evidence version, time, verdict,
  named source statuses, and a canonical payment-context binding.
- Chain, asset, integer token amount, and parties only as needed to verify
  settlement; do not infer them from USD. Use protected hashes for retained
  identifiers where possible and document linkability limitations.
- Subsequent outcome, verification status, and proof reference.

No raw page text, prompt, purpose, request body, IP address, session token,
private key, or browser identifier in durable records.

Use configured Upstash/KV REST for durable storage with a separate namespace,
bounded retention/TTL, strict schemas, atomic duplicate handling, and
bounded writes. Do not repurpose the existing aggregate counter hash.
Provide an in-memory test backend. Do not treat `/tmp` or a fire-and-forget
write in a serverless process as a durable production database.

Make cross-tenant read/write authorization and ID replay protection
explicit. Do not let an attacker attach outcomes to another caller's
decision or poison stored outcomes with arbitrary verdicts.

Outcome statuses must distinguish:

- Unverified caller-reported feedback.
- Pending transaction.
- Verified reverted transaction.
- Verified matching settled payment.
- Unverified dispute/service-quality report.

Transaction receipt success alone does not prove this payment occurred.
Verify network, asset contract, relevant transfer/authorization, sender,
recipient, base-unit amount, and finality against the bound intent.
Deduplicate transaction/log usage so one payment cannot be counted across
many decisions. Without a complete binding, report unverified rather than
inventing a settlement.

A settled payment also does not prove good service or lack of fraud.
Disputes and delivery feedback remain distinct evidence.

Do not automatically publish any of these records to ERC-8004. Give the
coordinator an opt-in publication proposal for later, including consent,
provenance, writer trust, idempotency, and exclusion of self-generated
feedback from the scoring loop.

### 3. Ten-minute integrator example

Create `examples/gate-integrator/` with a minimal TypeScript caller using
the real API shape and an injected payment operation:

```text
prepare exact payment -> request gate decision -> validate GO
-> execute once -> report outcome through the optional authenticated path
```

STOP, UNKNOWN, bad JSON, timeout, and HTTP error must not execute payment.
Operator-owned policy cannot come from untrusted merchant text. Demonstrate
GO, UNKNOWN unfamiliar payee, and STOP policy violation with local fixtures.

Separate:

- Full pre-payment risk API.
- Strict on-chain capability check.
- Fixture-only caller.
- Any separately authorized live integration.

Include run commands, environment variable names, and integration limits.
Do not claim a second team, facilitator integration, or paid customer
unless that party actually ran it and permits the claim. Do not contact
teams or post recruiting messages without explicit authorization.

## Acceptance tests

- Nansen failures are surfaced; generic wallet labels do not create GO.
- API/provider keys and raw input text never enter logs or stored records.
- Public GET/embed reads and flag-off decisions create no durable record.
- Unauthorized, cross-tenant, replayed, oversized, and malformed outcome
  submissions are refused.
- Duplicate reports are idempotent; conflicting proof cannot overwrite a
  verified outcome.
- Wrong-chain, unrelated-success, wrong-token/recipient/amount, reverted,
  pending, insufficiently final, and missing-binding proofs cannot become
  verified settlement.
- One transaction cannot inflate settlement counts across decision IDs.
- TTL and durable-backend error behavior are explicit and tested.
- Integrator invokes the payment operation exactly once on valid GO and
  zero times on STOP/UNKNOWN/failure.
- Loss of telemetry storage does not mutate a payment risk decision or
  falsely report a successful stored record.

## Validation and delivery

Run narrow new tests followed by:

```sh
pnpm --filter @ligis/web test
pnpm --filter @ligis/web typecheck
pnpm --filter @ligis/web build
```

Keep non-handler logic outside `route.ts`, following this Next.js version's
route export constraints. Add a deterministic run/test command for the
example without editing root scripts in parallel.

Deliver `docs/evidence-outcomes.md` with provider support/source links,
live-versus-fixture status, auth model, schema, TTL, cost bounds, export
names, and exact wiring proposals for A.

Include proposed privacy wording for `docs/positioning.md`, distinguishing
opt-in authenticated integrators from anonymous public read/embed users.
The coordinator must reconcile any provider wallet SDK changes from C
with the existing no-client-SDK/no-cookie language before release.

No live Nansen queries that incur charges, new database provisioning,
production logging enablement, feedback writes, or real payment tests
without scoped authorization.
