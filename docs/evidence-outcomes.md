# Ligis D — Evidence and outcomes — 2026-10-13

## Run and scope

- Execution/discovery date: **2026-10-13**.
- Isolated workspace: `/tmp/ligis-evidence-outcomes-Di5E6LqU/repo`.
- Branch: `feat/evidence-outcomes`.
- Exact base: `f4b1786326b1677b4fee97b8f30b2120d53c2f47`.
- Cloned with `git clone --no-hardlinks` from the accessible existing checkout
  `/tmp/ligis-payee-evidence-KB83akXO/repo`. Its working tree was not changed.
  The supplied upstream reference is https://github.com/sneldao/ligis.
- The original implementation made no commit or push. The publication-only
  follow-up is authorized to commit and ordinarily push this existing work.
  No PR, merge, deployment, payment, chain write, feedback write, database
  provisioning, team contact, or production configuration change.
- Dependencies installed independently with `pnpm@10.33.2 install
--frozen-lockfile`. No shared/symlinked `node_modules` with another checkout.
- Root/web instructions and installed Next 16.4.0 route-handler, route-file,
  and environment-variable guides read before implementation. No extra agents.

**Implemented:** Nansen adapter, deterministic caller, authenticated ingestion,
minimal decision recorder, atomic KV backend, test backend, ERC20 receipt
verifier, strict validation and bounded retention. **Not wired into A's gate
decision path.** The public gate wire shape, four signals, counters, wallet,
passkey code, navigation, root configuration and existing docs remain unchanged.

## Live versus fixture, and blockers

Every executed provider/payment/settlement scenario was a **local fixture**.
Official documentation discovery was live public read-only HTTP, not a paid API
query. The caller demo prints synthetic results and makes no network requests.
There is no claim of a customer, other-team integration, or facilitator proof.

Live Nansen, live KV/EVAL, and live RPC proof verification were not exercised.
Required prerequisites are runtime secrets, a separately authorized durable KV
deployment, trusted RPC/asset configuration, and separate live-query/payment
authorization. Credentials were not requested interactively or read from another
worker's checkout. Install did not copy ignored environment files.

The official Nansen docs enumerate `monad` but do **not** unambiguously identify
its chain ID or separate mainnet/testnet coverage. That mapping remains blocked:
an operator must confirm it with Nansen before setting the server-only
`confirmedMonadChainId`. Neither 143 nor 10143 is asserted live-supported by
this run. Do not treat one network's labels as another network's evidence.

Current `PaymentIntent` is USD-only and lacks payer, asset, network and integer
token amount. It cannot prove settlement. The current public gate response also
does not return a decision ID. Until the proposals below are integrated, the
new route has no IDs from the public gate and the example correctly skips
correlation. Server tests call the recorder directly.

## Official Nansen findings (checked 2026-10-13)

| Topic      | Finding                                                                                                                          | Official source                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| API access | POST `https://api.nansen.ai/api/v1/profiler/address/labels`, `apikey` header                                                     | https://docs.nansen.ai/api/profiler/address-labels   |
| Body       | `{address, chain, pagination:{page,per_page}}`; `monad` is an allowed chain                                                      | same                                                 |
| Response   | `data:[{label:string,category:string,kind:string[]}]`, optional pagination/hint                                                  | same                                                 |
| Semantics  | Current entity/behavioral taxonomy, not historical labels; chain-scoped, no provider observation timestamp                       | same                                                 |
| Price      | Nonempty common labels: 100 credits; successful empty response: 0, but 100 credits needed upfront. Premium labels: 500, not used | same; https://docs.nansen.ai/getting-started/credits |
| Limits     | Per key: Free 15/sec and 300/min; Pro 75/sec and 1,500/min. Honor 429/Retry-After; no automatic retries here                     | https://docs.nansen.ai/getting-started/rate-limits   |
| Coverage   | Docs list Monad data from 14 May 2025. Labels are current, not an immutable historical snapshot; live indexing/cache lag exists  | https://docs.nansen.ai/api/data-coverage             |
| MCP        | Streamable HTTP at `https://mcp.nansen.ai/ra/mcp`, `NANSEN-API-KEY`, standard `address_labels` costs 100 credits                 | https://docs.nansen.ai/mcp/connecting/tools          |
| Plans      | Docs list Free trial/top-up and Pro subscription/included credits; no USD-per-credit conversion assumed                          | https://docs.nansen.ai/getting-started/credits       |

Connector discovery found no offered Nansen connector. Public official HTML
was read directly after that check; `.md` variants returned HTTP errors.
No MCP/provider tool was called. No credit-consuming discovery occurred.

### Adapter behavior and exports

`readNansenEvidence(payee, options)` and `NANSEN_LABELS_URL` are exported from
`web/lib/payee-evidence/nansen.ts`; local types are `NansenOptions` and
`NansenEvidence`. The evidence's shared fields structurally match A's contract.
`taxonomy` is optional ephemeral provider metadata, not a fifth signal.

- Default off; requires `enabled:true`, API key, explicit intended `chainId`,
  and operator-confirmed Monad mapping. Accepts only valid EVM addresses.
- Fixed HTTPS API endpoint, no redirects, one page of at most 100 labels,
  64,000-byte response limit, 2-second default timeout, 10-second maximum.
- One call, no pagination/retry/fallback to `all` or another chain. Maximum
  documented charge is 100 credits per invocation, excluding plan subscription.
  There is no global spend cap; operator admission/budgeting is required before
  enabling this read on public traffic.
- Named reasons: `nansen-disabled`, `nansen-missing-key`,
  `nansen-invalid-payee`, `nansen-chain-unconfirmed`, `nansen-wrong-chain`,
  `nansen-no-coverage`, `nansen-access-denied`, `nansen-rate-limit`,
  `nansen-timeout`, `nansen-malformed-data`, `nansen-provider-error`,
  `nansen-labels-not-risk-verdict`.
- Missing/failed provider gives unavailable; missing coverage/chain or neutral
  taxonomy gives unknown. No documented risk-flag enum was found in this
  endpoint's schema, so this adapter deliberately emits **no positive or
  negative evidence**, even for a label named “Scammer”.
- Exchange, Smart Money, unlabeled, and arbitrary free-form labels never
  independently grant GO, capability, KYC approval, or safety.
- Preserves `label/category/kind`; `observedAt` is server retrieval time, not
  provider label creation time. `reference` names the official schema.
- No history, trading, related-wallet or premium/public-figure query. Standard
  labels may contain public entity/ENS names; treat them as ephemeral provenance,
  never store the raw taxonomy in this recorder, analytics or logs.
- Keys, request bodies, provider errors and raw gate text are not logged.

## Outcome kit

### Auth and authorization

All new live modes are off by default. `loadOutcomeRuntime()` returns null unless
the opt-in flag, valid server caller grants, HMAC secret and durable KV config
exist. There is **no** file, `/tmp`, aggregate-counter or fire-and-forget fallback.
RPC verification is a second, independent opt-in; otherwise reports remain
explicitly unverified.

Server grants are `[{tenant,tokenSha256,optIn:true}]`, at most 32. Clients send a
Bearer token, not a tenant ID or authorization boolean. Tokens must be high
entropy (at least 256 random bits encoded as URL-safe text); only SHA256 token
digests belong in the grants. Timing-safe digest comparison authenticates the
caller. The same server-granted tenant controls decision creation, read and
write. Cross-tenant IDs return not-found. Authentication headers/grants are
never retained in decision records. Revoke a grant to remove both read/write
access; avoid changing the HMAC key while active retention/replay windows exist.

`OutcomeRecorder.recordDecision(input,{method,headers})` is a server-only hook,
not a public creation route. It requires authenticated POST and server opt-in.
Call it **after** computing the actual risk decision with operator-owned
versions and evidence statuses. A client must never supply the verdict.
`readDecision(id,headers)` is tenant-authorized, internal only. There is no
public GET/list/export endpoint. Anonymous GET/embed and flag-off calls create
no records in the new store.

`POST /api/gate/outcomes` uses `handleOutcomePost` and exports only the Next route
handler/runtime. It requires JSON and a valid Bearer grant before reading a
body. Streaming bodies are bounded to 2,048 bytes and 2 seconds. Response is
`{stored:true,decisionId,outcome?,duplicate?}` or
`{stored:false,reason,status?}`. All responses are no-store. Disabled is 404,
unauthorized 401, bad schema 400, oversized 413, conflict/replay 409, limit 429,
durable backend error 503.

### Strict schemas

Server decision input:

```ts
{
  verdict: "GO" | "STOP" | "UNKNOWN",
  policyVersion: string, evidenceVersion: string, // fixed operator versions
  sources: { // at least one; no unknown source names/statuses
    "ligis-credential"?: "positive"|"negative"|"unknown"|"unavailable",
    erc8004?: /* same */, "x402-settlement"?: /* same */, nansen?: /* same */
  },
  context: { payee: string, amountUsd: number, capability?: string },
  settlement?: { chainId: number, asset: string, payer: string,
                 payee: string, amountBaseUnits: string }
}
```

Extra keys are refused. Versions/capability use bounded slug syntax. Payee is
bounded; USD is finite in `(0,1e9]`. Settlement requires all fields, EVM
addresses, positive safe-integer chain ID, positive canonical decimal uint256
amount, and recipient matching the risk context. **No USD-to-token inference.**

Outcome body is exactly one of:

```ts
{ decisionId: string, reportId: string, kind: "feedback" }
{ decisionId: string, reportId: string, kind: "dispute" }
{ decisionId: string, reportId: string, kind: "transaction",
  txHash: string, logIndex: number }
```

IDs are UUIDv4; decision ID is server-created. Transaction hash is 32-byte hex;
log index is an integer in `[0,1_000_000]`. Report IDs are caller idempotency
keys, not browser identifiers. Receipt objects, RPC URLs, tenant overrides,
text and unknown fields are rejected.

Durable `DecisionRecord` retains: schema version, server UUID, tenant HMAC,
creation/expiry, policy/evidence versions, verdict, named source statuses,
canonical context HMAC, optional chain/asset/payer/payee HMACs and integer
amount, bounded report-ID/fingerprint map, outcome and independent dispute.
Each outcome has status, verification, server time, fixed reason and optional
protected proof reference. No raw address, tx hash, page, prompt, purpose,
request body, IP, token, key or browser ID is retained.

HMAC domains and tenant scopes prevent simple address guessing without the
key, but they are **not anonymity**: repeated parties within a tenant link;
chain, amount, time and verdict remain visible to authorized operators.
Global protected transaction claims necessarily link reuse across tenants.
Runtime receives transaction hashes transiently to verify against RPC.

### Status/proof model

- `unverified-caller-feedback`: caller report only.
- `pending-transaction`: absent receipt or insufficient finality.
- `unverified-transaction`: missing complete binding, no verifier, wrong
  chain/hash/asset/parties/amount/log, old/future block or unavailable proof.
- `verified-reverted`: finalized matching direct ERC20 transfer attempt
  reverted; never counted as settlement.
- `verified-matching-settlement`: finalized matching ERC20 Transfer on a GO
  decision; **not proof of good service**.
- `unverified-service-dispute`: separate unadjudicated service-quality report,
  including after settlement; does not replace payment outcome.

Clients cannot assert verification. `createRpcProofVerifier` reads only a
server-configured HTTPS RPC, checks actual chain ID, receipt transaction hash,
canonical block hash, finalized block tag, allowed asset emitter, nonremoved
Transfer log/index, sender, recipient and integer amount. The recorder compares
those to protected bound identifiers and requires a block timestamp no earlier
than the ceiling of decision creation time and no later than server time.
Subsecond ordering is conservatively refused. Provider errors are sanitized.

A relevant ERC20 Transfer is settlement evidence (including a facilitator/
authorization path that actually emits that matching Transfer), not merely a
successful receipt or an authorization signature. Authorization without transfer
is insufficient. Reverted recognition supports only direct `transfer` calldata;
failed EIP-3009/facilitator, native tokens, NFTs and arbitrary service calls
remain unverified. A single trusted RPC and allowlisted token semantics are
assumptions, not cryptographic/independent consensus verification.

### Atomicity, TTL and cost bounds

Separate namespace: `ligis:{gate-outcomes-v1}:`, never `ligis:counters`.
Upstash REST commands use awaited EVAL, no redirects, no-store, 2-second HTTP
timeout. Lua atomically checks NX/CAS snapshot, proof ownership and write quota,
then writes the record plus transaction claim. Concurrent identical reports
are idempotent; changing a report ID's content conflicts. A different proof or
nonverified feedback cannot overwrite a verified payment outcome. Disputes
remain independent.

- Record TTL: **86,400 seconds (24 hours)**, never renewed by reports.
- Global transaction replay claim TTL: **604,800 seconds (7 days)** from proof
  write. One whole chain/transaction may belong to only one decision across all
  tenants/logs. This deliberately undercounts valid batched payments.
- At most **8 reports per record** and **100 committed decision/report writes
  per tenant per 3,600-second quota window**.
- Admission: **200 valid decision/report attempts per tenant per
  3,600-second window**, before record reads or RPC. Invalid/anonymous HTTP
  input does not touch KV. Admission increments are separately bounded.
- Accepted creation uses 2 KV commands. Accepted report uses at most 4 (admit,
  read, CAS, concurrent duplicate read); duplicate uses 2. RPC verifier uses
  at most 5 RPC reads, no transport retries; recorder timeout 6 seconds.
- Refused valid authenticated attempts still cost one KV admission command;
  this is **not a total bill/DoS cap**. Deploy behind ingress rate limits and a
  provider hard budget. No ingress provisioning was performed.
- No aggregates or settlement-count endpoint is shipped. A future counter must
  count only unique `verified-matching-settlement` records, not retries/reverts,
  caller feedback, disputes or general receipt success.
- Lost/ambiguous durable writes return `stored:false`; risk decision is
  untouched. A timed-out write might have committed; retry reports using the
  same ID, never retry a payment because telemetry failed. TTL bounds orphans.
- In-memory backend is only a deterministic test implementation. Live Redis
  EVAL semantics were not tested against an actual service in this run.

Exports: `OutcomeRecorder`, `MemoryOutcomeBackend`, `UpstashOutcomeBackend`,
`loadOutcomeRuntime`, `handleOutcomePost`, `createRpcProofVerifier`,
`authenticateOutcomeCaller`, `parseCallerGrants`, `parseOutcomeSubmission`,
`validDecisionInput`, `validSettlement`, `object`, `exactKeys`;
schema types `DecisionInput`, `DecisionRecord`, `SettlementContext`,
`OutcomeSubmission`, `Outcome`, `OutcomeStatus`, `SourceName`, `SourceStatus`;
backend/proof/auth types `OutcomeBackend`, `AtomicWrite`, `AtomicResult`,
`ProofObservation`, `ProofVerifier`, `CallerGrant`.
Constants/validation exports: `RECORD_TTL_SECONDS`, `PROOF_TTL_SECONDS`,
`MAX_WRITES_PER_HOUR`, `MAX_ATTEMPTS_PER_HOUR`, `OUTCOME_ATOMIC_LUA`,
`OUTCOME_ADMISSION_LUA`, `ADDRESS`, `TX_HASH`, `UUID`, `SOURCE_NAMES`,
`SOURCE_STATUSES`.

## Runnable caller

From this workspace root, using pnpm 10.33.2:

```sh
pnpm exec tsx examples/gate-integrator/demo.ts
node --import tsx --test examples/gate-integrator/caller.test.ts
pnpm --filter @ligis/web exec tsc -p ../examples/gate-integrator/tsconfig.json
```

Exports: `prepareGatedPayment`, `validateDecision`,
`reportAuthenticatedOutcome`; types `ExactPayment`, `OperatorPolicy`,
`CallerOptions`. Fixture helper exports `fixture`, `payment`, `demo`.

Prepare exact network/asset/payer/payee/base-unit amount before asking risk.
The caller sends the **current** full risk API input (`payee`, `amountUsd`,
`purpose`, `capability`, operator `mandate`), not an invented settlement wire
shape. It validates four canonical signals, confidence and verdict. HTTP 200
is not GO. Its stricter policy additionally requires verified-payee GO.
STOP, UNKNOWN, inconsistent/malformed response, HTTP/network error or timeout
executes zero payments. Repeated/concurrent runs of one prepared object share
one promise. This is in-process exactly-once invocation, **not** distributed
payment idempotency, retry safety or an enforcement plugin.

Only an injected transport runs by default. Explicit `live:true` is required
for default fetch, after separate authorization. Caller timeout defaults 4s,
max 10s; response is bounded to 64,000 bytes. The injected payment operation
is responsible for its own chain safeguards, bounded timeout, execution lock
and reconciliation; a thrown payment error stays an error, with no retry.

Optional `gateToken` supplies server auth. Only a valid server UUID in
`X-Ligis-Decision-Id` from an authenticated response enables the outcome
callback, which receives `(txHash,decisionId)`. `reportAuthenticatedOutcome`
uses the ingestion shape above and requires `stored:true`. Absent correlation
reports `not-correlated`, storage failure `unavailable`, neither changes or
retries the payment. Current public gate has no correlation header.

Keep these four surfaces separate:

1. Full pre-payment risk API: four signals, operator mandate, evidence, verdict.
2. Strict on-chain `isCapable`/issuer-scoped check: capability predicate only,
   not amount/payee/job risk analysis or automatic reputation publication.
3. This fixture-only caller: runnable demonstration, synthetic evidence/payment.
4. A separately authorized live integration: not performed or claimed here.

## Exact proposals for A/coordinator (not applied)

### 1. Nansen under verified-payee provenance only

In A's `web/lib/payee-evidence/types.ts`, retain the agreed `PayeeEvidence`
contract. After integration, replace D's local shared fields with a type-only
import and narrow extension:

```ts
import type { PayeeEvidence } from "./types";
type NansenEvidence = PayeeEvidence & {
  source: "nansen";
  taxonomy?: { label: string; category: string; kind: string[] }[];
};
```

Add `evidence?: PayeeEvidence[]` **only** to the `verified-payee` Signal variant
in `decide.ts`/the wire spec. In A's verified-payee evaluator, append:

```ts
const nansen = await readNansenEvidence(intent.payee, {
  enabled: env.LIGIS_NANSEN_ENABLED === "1",
  apiKey: env.NANSEN_API_KEY,
  chainId: evidenceContext.chainId, // validated intended network, not registry fallback
  confirmedMonadChainId: env.LIGIS_NANSEN_MONAD_CHAIN_ID
    ? Number(env.LIGIS_NANSEN_MONAD_CHAIN_ID)
    : undefined,
});
const evidence = [...otherPayeeEvidence, nansen];
```

`evidenceContext` must be a validated server context until proposal 3 is
approved. With no intended network, append named unknown evidence and do not
call Nansen. A applies its operator-owned aggregation policy; never convert
neutral taxonomy to GO, and preserve the four top-level IDs. Show taxonomy
only in verified-payee provenance, not a sponsor/fifth panel. Do not persist it.

### 2. Authenticated server decision hook and response header

Concrete execution-seam patch below (proposal, not applied). Only server code
may supply the `outcomes` option. After `decide()`, project trusted data without
spreading the intent/body. The risk decision stays unchanged on every telemetry
failure. No creation hook belongs on GET/embed/form/public anonymous reads.
This minimal-context diff passed `git apply --check --unidiff-zero` against the
exact baseline. Plain `git apply --check` requires more context and rejected
it; neither check applied or edited the proposal's target.

```diff
--- a/web/lib/gate-run.ts
+++ b/web/lib/gate-run.ts
@@ -11 +11,4 @@
 import type { SubjectResolution } from "./resolve";
+import { loadOutcomeRuntime } from "./gate-outcomes/runtime";
+import type { OutcomeRecorder } from "./gate-outcomes/recorder";
+import type { DecisionInput, SettlementContext } from "./gate-outcomes/schema";
@@ -14 +17,2 @@
-  | { ok: true; decision: Decision }
+  | { ok: true; decision: Decision;
+      telemetry?: Awaited<ReturnType<OutcomeRecorder["recordDecision"]>> }
@@ -19,2 +23,9 @@
   opts?: {
     resolveSubject?: (payee: string, cap: string) => Promise<SubjectResolution>;
+    outcomes?: {
+      request: { method: string; headers: Headers };
+      policyVersion: string;
+      evidenceVersion: string;
+      sourceStatuses: (decision: Decision) => DecisionInput["sources"];
+      settlement?: SettlementContext;
+    };
@@ -41 +52,19 @@
-    return { ok: true, decision };
+    let telemetry: Awaited<ReturnType<OutcomeRecorder["recordDecision"]>> | undefined;
+    const context = opts?.outcomes;
+    if (context?.request.method === "POST") {
+      try {
+        const rt = loadOutcomeRuntime();
+        if (rt) telemetry = await rt.recorder.recordDecision({
+          verdict: decision.verdict,
+          policyVersion: context.policyVersion,
+          evidenceVersion: context.evidenceVersion,
+          sources: context.sourceStatuses(decision),
+          context: { payee: intent.payee, amountUsd: intent.amountUsd,
+                     capability: intent.capability },
+          settlement: context.settlement,
+        }, context.request);
+      } catch {
+        telemetry = { stored: false, reason: "storage-unavailable", status: 503 };
+      }
+    }
+    return { ok: true, decision, ...(telemetry ? { telemetry } : {}) };
```

`sourceStatuses` is A's server helper projecting only the four agreed source
names and their **actual evidence** statuses, with at least one named source.
Never derive credential-positive from aggregate GO or use merchant fields.
Versions are operator-controlled constants/configuration. Settlement is
undefined until proposal 3 is approved.

In `web/app/api/gate/route.ts` **POST only**, pass the patch's `outcomes` option
with `request:{method:req.method,headers:req.headers}`, server versions, A's
source-status helper and validated optional settlement. The helper and context
construction belong outside `route.ts`, not in additional route exports.
Update its result type and `toResponse` to add
`X-Ligis-Decision-Id: out.telemetry.decisionId` **only when stored is true**,
otherwise optional fixed `X-Ligis-Outcome-Storage: unavailable`. Never expose
errors/tokens/tenant. Anonymous and disabled responses stay unchanged. Route
exports remain HTTP handlers/Next config only. Add A tests asserting no ID or
new durable record on GET/anonymous/flag-off/storage failure, with unchanged
Decision on any telemetry result.

### 3. Validated payment-context schema extension, needs coordinator approval

Do not infer token settlement from USD. Propose one optional authenticated
integrator field in `PaymentIntent` and `docs/decide-api.md`:

```ts
settlement?: {
  chainId: number;        // intended chain, safe positive integer + operator allowlist
  asset: string;          // EVM ERC20 contract, server verifier asset allowlist
  payer: string;          // exact payer address
  payee: string;          // must equal PaymentIntent.payee
  amountBaseUnits: string; // canonical positive uint256 decimal, never derived from USD
};
```

Use `validSettlement` plus the payee-equality check in `gate-intent.ts`. Reject
unknown keys and partial bindings; validate operator chain/asset policy. After
approval, pass that exact context to both wallet payment execution and D's
recorder; then update the example wire projection to send it. Without it,
the recorder accepts a minimal decision but reports transaction outcomes as
unverified. Current implementation does not independently expand public input.

### 4. Privacy wording, proposed replacement in positioning.md

> Anonymous public gate reads and embed users remain server-aggregate-only:
> no client analytics SDK, cookies, fingerprinting, or per-visitor decision
> database. Separately authenticated integrators may opt in, through
> server-granted authorization, to decision/outcome correlation. That separate
> durable store retains server correlation IDs, versions, verdict/source
> statuses and protected payment bindings for at most 24 hours, with protected
> transaction replay claims for 7 days. It does not retain raw page text,
> prompts, purpose, addresses, request bodies, IPs, auth tokens, private keys or
> browser identifiers. Hashing limits exposure but does not make records
> anonymous. Settlement evidence is distinct from service-quality feedback.

This changes the prior universal “no database” promise. Coordinator must approve
and update positioning and corresponding embed/API copy **before enabling
production logging**; D does not edit those files or enable it.

### 5. Corrected integrate-monad reputation copy / opt-in publication

Replace the “Ligis writes every gate verdict...” paragraph with:

> ERC-8004 feedback has been exercised by separately authorized demo scripts.
> Normal gate reads do not automatically publish reputation feedback. A
> pre-payment verdict is not a payment outcome, and a settled payment is not
> proof of good service. Any future publication is explicit, consented and
> provenance-bearing, with trusted writer identity and idempotency.

Publication proposal only: obtain per-record operator/counterparty consent;
use an independently trusted writer, record policy/evidence version and actual
verification status, segregate service disputes, and deduplicate by decision/
chain/proof. Exclude self-generated/model-generated feedback and self-dealing;
do not turn the gate's own verdict or unverified caller feedback into positive
reputation. Independently reviewed evidence is required for service claims.
Require separate chain-write authorization and a reviewed outbox/idempotency
design. Nothing here writes to or queues publication to ERC-8004.

## Runtime configuration (names only)

Secrets: `NANSEN_API_KEY`, `LIGIS_OUTCOME_HASH_KEY`,
`LIGIS_OUTCOME_CALLERS_JSON` (grants/token digests, not plaintext tokens),
`KV_REST_API_TOKEN`; integrator secret `LIGIS_GATE_OUTCOME_TOKEN`.
Treat `LIGIS_OUTCOME_RPC_URL` as sensitive if it contains provider auth.

Server config: `LIGIS_NANSEN_ENABLED`, `LIGIS_NANSEN_MONAD_CHAIN_ID`,
`LIGIS_OUTCOMES_ENABLED`, `KV_REST_API_URL`,
`LIGIS_OUTCOME_RPC_ENABLED`, `LIGIS_OUTCOME_RPC_CHAIN_ID`,
`LIGIS_OUTCOME_ASSETS_JSON`, `LIGIS_OUTCOME_RPC_URL`.
Nansen env names are for A's proposed wiring; D's adapter takes explicit
options. All flags default off. No `NEXT_PUBLIC_` secret or production env change.
Provision scoped secrets through the authorized runtime secret manager, never
pasted values or checked-in examples.

## Validation

Passed:

- Required frozen install with pnpm 10.33.2 and five-package dependency build.
- Narrow new web tests: 18 assertions/tests (3 Nansen + 15 outcome tests).
- Full `pnpm --filter @ligis/web test`: **78 passed, 0 failed**.
- `pnpm --filter @ligis/web typecheck`.
- `pnpm --filter @ligis/web build`: Next 16.4.0 production build, including
  `/api/gate/outcomes`, with new live modes disabled and Next telemetry off.
- Standalone example: **5 tests passed**, scoped typecheck, GO/UNKNOWN/STOP
  demo executed 1/0/0 payment callbacks (synthetic, no payment).

Initial new-module typecheck found union narrowing/test-env type errors; fixed.
Initial standalone example typecheck lacked the web alias/Next global types;
its own scoped tsconfig fixes that without editing root/web configuration.
Install warns about pre-existing ignored optional build scripts and the
indexer's nested pnpm setting; build warns about existing static Cache-Control
headers. They did not fail final validation.

Skipped: credit-consuming Nansen requests, live MCP/KV/EVAL/RPC proof checks,
all real payment/testnet writes, deployment, public/customer verification and
cross-worker merge integration. No live-support or durable-runtime proof is
fabricated from fixtures.

Changed files (all new):

```text
docs/evidence-outcomes.md
examples/gate-integrator/README.md
examples/gate-integrator/caller.ts
examples/gate-integrator/caller.test.ts
examples/gate-integrator/demo.ts
examples/gate-integrator/fixtures.ts
examples/gate-integrator/tsconfig.json
web/lib/payee-evidence/nansen.ts
web/lib/gate-outcomes/auth.ts
web/lib/gate-outcomes/backend.ts
web/lib/gate-outcomes/http.ts
web/lib/gate-outcomes/proof.ts
web/lib/gate-outcomes/recorder.ts
web/lib/gate-outcomes/runtime.ts
web/lib/gate-outcomes/schema.ts
web/app/api/gate/outcomes/route.ts
web/test/nansen.test.ts
web/test/gate-outcomes.test.ts
```

## Publication-only follow-up (2026-10-13)

Reused the completed workspace above without cloning or restarting
implementation. All 18 files matched the saved original output before this
documentation update. The saved implementation run completed successfully at
2026-10-13T14:28:18.964Z; no process was using the workspace during preflight.
The assigned branch and exact baseline were verified again. The original
checkout's configured upstream identified `sneldao/ligis`; an authenticated
normal Git read succeeded and found no existing assigned remote branch.
Only this worker's clone receives the separate `publish` remote.

Required validation rerun with pnpm 10.33.2 and new live modes disabled:

- Narrow new tests: **18 passed, 0 failed**.
- `pnpm --filter @ligis/web test`: **78 passed, 0 failed**.
- `pnpm --filter @ligis/web typecheck`: passed.
- `pnpm --filter @ligis/web build`: passed, including its unchanged five-package
  dependency-chain prebuild.
- Example tests: **5 passed, 0 failed**; example typecheck passed.
- Fixture demo: GO/UNKNOWN/STOP executed **1/0/0** synthetic payment callbacks.

Existing nested pnpm settings and static Cache-Control warnings remain.
No dependency installation was needed. Live provider/KV/RPC/payment checks
remain skipped, and every prior runtime blocker and integration proposal above
still applies. No source behavior changed in this follow-up.

Authorized publication target:
https://github.com/sneldao/ligis/tree/feat/evidence-outcomes.
The final publication result, full commit SHA and remote-SHA verification are
recorded in the automation's publication report. A document cannot contain its
own final Git commit SHA without changing that SHA.
