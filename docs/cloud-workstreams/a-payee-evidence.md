# Worker A: standard-backed payee evidence

Implement on branch `feat/payee-evidence`. Read the shared
[`README.md`](./README.md) first; its ownership and safety rules apply.

## Goal

Make the pre-payment risk API able to assess unfamiliar agent payees
using ERC-8004 evidence, without requiring every payee to obtain a Ligis
credential and without converting lack of evidence into approval.

This is the highest-priority product change. Keep the existing strict
credential mode intact for compatibility.

## Baseline facts to verify

- `web/lib/decide.ts` defines four signals. `verifiedPayeeSignal()` currently
  converts every non-capable result to STOP. Its signal type has GO, STOP,
  and SKIPPED, but no per-signal UNKNOWN.
- `composeVerdict()` requires payee and amount to answer before GO and treats
  SKIPPED as neutral. Simply changing an absent credential to SKIPPED
  could therefore turn an unknown payee into aggregate GO.
- `web/lib/resolve.ts` reads only Ligis registries and uses union semantics.
  Do not change what `SubjectResolution.capable` means to include generic
  reputation.
- `web/lib/erc8004.ts` reads only the two IDs in
  `assets/erc8004-monad-testnet.json`. It is not global discovery.
- The Envio indexer currently indexes credential events, not ERC-8004
  registrations or payment settlement history.
- `docs/decide-api.md` contains stale composition and input descriptions.
  Align it with the actual behavior your branch ships.

Read `web/lib/gate-run.ts`, `web/lib/gate-intent.ts`,
`web/test/decide.test.ts`, `web/test/route.test.ts`, and the Envio package.
Inspect all consumers of the signal union before adding UNKNOWN.

## Implement

### 1. Separate capability verification from payee risk

Add a default-off, server-controlled open-world evidence mode, proposed
name `LIGIS_PAYEE_EVIDENCE_ENABLED=1`. Flag absent means current behavior.
Use a separate evidence reader, not a redefinition of `isCapable`.

In the new mode:

- A known relevant revoked or invalid credential remains negative. Do
  not allow a positive source to erase a STOP by taking `max(...)`.
- A self-issued credential never establishes trust. Preserve the current
  STOP rule for the existing self-issued case in this batch.
- Successful reads with no record yield verified-payee UNKNOWN with a
  specific reason. Distinguish that from timeout or unavailable data.
- Any required UNKNOWN signal prevents aggregate GO. STOP still wins.
- A required source outage also cannot be silently neutralized into GO.
  Optional upstream failures may coexist with independently sufficient
  evidence, but the failure remains in provenance.
- An explicit credential-required policy still requires the appropriate
  non-self-issued capability. Identity, spend history, or general reputation
  cannot satisfy KYC/accreditation or a named credential requirement.

Policy belongs to server/operator configuration, not arbitrary positive
thresholds supplied by the requesting agent. Document the initial policy
and use conservative defaults.

### 2. Discover ERC-8004 identities beyond the demo address book

Verify current deployed ABI and official registry semantics before
coding. Index the relevant registration and wallet-binding changes in
Envio and confirm the current wallet on-chain before using an identity.
An NFT owner is not automatically the current agent wallet.

Keep registration ID scoped by chain and registry. Handle wallet changes,
multiple identities, pagination, incomplete indexing, and bounded RPC
fallbacks. A hardcoded-ID fallback may support old demos, but must be
reported as limited coverage rather than a global negative lookup.

Implement chain-scoped configuration so another EVM rail can be added
without rewriting the reader. Monad testnet is the initial proven target.
Do not add Base to Ligis's credential-chain candidates or claim Base
production coverage without verifying its registry deployments and reads.

### 3. Read reputation without laundering self-generated feedback

Retrieve live, non-revoked feedback with its client, tags, decimal scale,
and registry reference. Filter out the subject, its known owner/controller,
and Ligis's own scoring writer. Bound all reads.

Use an operator-controlled trusted-client set for positive reputation
eligibility. Count distinct trusted clients and disclose unknown client
relationships. Do not call address diversity Sybil resistance.
If no trusted independent clients are configured, the reputation source
cannot independently return a positive trust verdict.

Preserve negative evidence and unknown coverage separately. Feedback tags
must match the policy being assessed; do not conflate a gate-preview score
with service delivery reputation.

### 4. Add settlement evidence only where it is demonstrable

Create the injectable settlement-reader seam and provide a bounded
adapter if a verified facilitator receipt/index is available. Verify
chain, asset, recipient, amount, receipt success, and finality.

An ERC-20 Transfer alone does not establish an x402 payment. If x402
provenance cannot be proved, label the result ordinary transfer history
or unavailable, not x402 settlement history. Volume alone must not
independently produce GO.

### 5. Wire and surface evidence

Dispatch bounded evidence reads concurrently with Jev. Preserve canonical
signal ordering and named source provenance. Keep existing response
fields compatible; document any additive evidence fields and UNKNOWN.

Update `GateDecision` and decision-to-receipt mapping so UNKNOWN is
visible, not rendered green or dropped. If another shared component
needs a change, give the coordinator an exact patch proposal.

Expose injection seams for D's Nansen adapter and opt-in recorder.
Do not implement or import D's unfinished modules. Do not submit feedback
from `decide()`, GET requests, or preview POST requests.

## Acceptance tests

- Flag off preserves existing decisions and explicit credential demos.
- Flag on: no registration/credential/eligible reputation plus otherwise
  valid mandate yields UNKNOWN, not STOP and not GO.
- Required credential missing remains STOP under strict policy.
- Relevant revoked and self-issued fixtures remain STOP.
- Registration only, untrusted clients, feedback spam, and Ligis's own
  prior gate scores cannot independently produce GO.
- Explicitly configured qualifying independent evidence can answer
  verified-payee positively; an amount/payee violation still yields STOP.
- Missing payee or amount evaluation still yields UNKNOWN.
- A required evidence outage is visible and never quietly yields GO.
- Discovery resolves an identity absent from the bundled address book and
  handles stale wallet bindings, pagination, and wrong-chain records.
- Receipt/UI mapping preserves UNKNOWN and all source failure reasons.
- No read or preview test triggers signing or on-chain feedback.

Tests should use injected RPC, GraphQL, Jev, and settlement doubles. Include
indexer handler tests or reproducible generated-schema validation rather
than asserting the production indexer is deployed.

## Validation and delivery

Run the narrow new tests, then:

```sh
pnpm --filter @ligis/web test
pnpm --filter @ligis/web typecheck
pnpm lint:design
pnpm --filter @ligis/envio-indexer codegen
```

Report any codegen/tooling blocker accurately. Run the web build if you
changed route or UI types. No live Jev, production indexer rollout, funding,
contract writes, or feedback publication without separate authorization.

Deliver `docs/payee-evidence.md` with policy defaults, source coverage,
environment variable names, integration seams, and a reproducible
unfamiliar-agent fixture. Propose positioning changes to the coordinator,
including removing private-registry-as-moat language only where the new
implementation supports that claim.
