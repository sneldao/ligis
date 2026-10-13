# Worker B: MetaMask-compatible payment guard

Implement on branch `feat/wallet-enforcement`. Read the shared
[`README.md`](./README.md) first; its ownership and safety rules apply.

## Goal

Move the gate from an optional API call to a demonstrable payment-signing
boundary. An agent cannot obtain a signature through the protected path
when the decision is STOP, UNKNOWN, malformed, or unavailable.

Do not repeat the closed-club problem by requiring every payee to hold a
Ligis credential. Use the risk decision, with strict capability gating
only when operator policy explicitly requires it.

## Research gate, before choosing the host

Verify the current **MetaMask Agent Wallet Plugin** bounty specification
and official supported plugin API. The hackathon URL exposed only a login
page during brief preparation; ask the owner for the rules if necessary.
Read current official MetaMask documentation and inspect installable SDK
types.

Do not assume an arbitrary Snap or Delegation Framework caveat qualifies.
Do not claim that a confirmation insight can veto signing unless the host
actually supplies that capability.

Choose the documented host integration that can enforce the protected
payment operation. If no supported veto/signing boundary is available,
report that limitation early. A runnable guarded payment adapter is still
useful, but must be called a guarded adapter, not wallet-wide enforcement
or a verified bounty entry.

## Existing context

- `POST /api/gate` accepts payee, USD amount, purpose, optional capability,
  and a caller-supplied mandate.
- It returns HTTP 200 for STOP and UNKNOWN as well as GO. Parse and
  validate the decision body; `response.ok` is insufficient.
- `web/lib/gate-intent.ts` is the actual input parser.
- `web/lib/decide.ts` enforces deterministic mandate checks and composes
  STOP-wins. Worker A adds a default-off open-world evidence mode.
- `scripts/monad-x402-demo.ts` demonstrates the existing EIP-3009 payment
  flow. Inspect it and the x402 server for payload/domain semantics.
- There is no verified signed-decision or AP2 verifier in this brief.
  Do not invent one or market unsigned JSON as an authenticated mandate.

## Implement

Create the isolated `packages/wallet-plugin/` package and tests, plus
`scripts/wallet-enforcement-demo.ts` and `docs/wallet-enforcement.md`.
Use the smallest host dependencies that the verified SDK requires.

### Protected policy

- Load allowed destinations, spend constraints, accepted assets/chains,
  capability requirements, and gate endpoint from operator-controlled
  configuration.
- Treat agent-provided purpose and mandate as untrusted input. They may
  tighten policy, not loosen it or redirect the gate endpoint.
- Do not send a USD figure invented from arbitrary token decimals. For
  the initial demonstration, constrain to a configured dollar-denominated
  token and documented conversion; use integer base units for enforcement.
- Accept only an HTTPS gate endpoint in production. Tests may explicitly
  use a local injected transport.

### Bind the decision to the actual operation

Parse the supported transfer/authorization before consulting the gate.
Derive payee, chain, asset, amount, authorization nonce, validity window,
and signing domain from the immutable operation. Reject unknown selectors,
unsupported authorization types, batch/multicall bypasses, and domain or
chain mismatches on the guarded path.

Allow signing only after a fresh, schema-valid GO for that same operation
and protected policy. STOP/UNKNOWN, timeout, malformed response, network
error, redirect to an unapproved endpoint, or mutation after assessment
refuses signing. Do not reuse approvals for a changed request.

Validate finite bounded confidence values and exact supported verdict
strings. Unknown future statuses fail closed. Apply deadlines and
bounded retries without turning a retry failure into GO.

If the SDK only supports an advisory surface, expose that separately.
An advisory warning must not satisfy enforcement acceptance criteria.
Document alternate signing paths outside the guard and revocation races:
a pre-signature check cannot invalidate an already issued authorization
or guarantee that conditions remain unchanged at settlement.

### Demonstrate the boundary

The local demo must drive the actual plugin/host entry point, not only
call a pure `check()` function:

1. Valid fixed payment plus GO reaches the injected signer once.
2. STOP and UNKNOWN never invoke that signer.
3. Change recipient, amount, token/domain, or nonce after a GO; signing
   fails or requires a fresh decision.
4. Show an unfamiliar-payee UNKNOWN case and an explicit credential-
   required policy case without confusing them.

Use host mocks and disposable fixture identities until live testing is
authorized. A local signer invocation is not a settled payment.

## Acceptance tests

- HTTP 200 with STOP or UNKNOWN invokes no signature or payment API.
- HTTP errors, invalid JSON/schema, timeout, unavailable gate, and
  unexpected verdict all refuse the guarded operation.
- Agent-supplied policy cannot raise the cap, add a payee, remove a
  capability requirement, or replace the gate endpoint.
- EIP-3009 domain chain, verifying contract, recipient, base-unit amount,
  nonce, and validity window are bound to the assessed operation.
- Mutating any bound field invalidates the approval.
- Unsupported batched/opaque calls cannot bypass the guarded entry point.
- A permitted GO reaches the signer exactly once for one operation.
- Duplicate/replayed requests follow documented idempotency behavior.
- UI, if supplied by the verified host API, displays signal reasons and
  source gaps without implying missing trust is verified.

Do not build an unaudited on-chain oracle that accepts arbitrary unsigned
HTTP verdicts. A capability-only caveat may be a separate strict-policy
example, but is not equivalent to the full decision service.

## Validation and delivery

Provide package build/typecheck/test scripts and run all three. Ensure
the tests are included in the repository's TS test conventions or give
the coordinator the exact wiring change.

Deliver:

- SDK/plugin version and official source links checked on the execution date.
- Exact protection boundary and known bypass paths.
- Dependency and host permission list with least-privilege rationale.
- Copy-paste install/configure/run instructions and deterministic demo.
- Confirmed sponsor-rule match, or a precise eligibility blocker.

Do not publish a Snap/plugin, submit a bounty, create hosted resources,
push a branch, or spend funds without authorization. Do not edit A's gate
code, C's passkey code, global navigation, or the shared lockfile.
