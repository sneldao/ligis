# Ligis `/api/gate` — decide API

Implementation: `web/lib/decide.ts` and `web/lib/gate-run.ts`. Arena still uses
its own judge. This document describes tested behavior, not a future API plan.

## Transport

`POST /api/gate` accepts JSON. `GET /api/gate` accepts equivalent query fields.
Both return a no-store `Decision`. **HTTP 200 means a decision was returned,
not GO.** Read `verdict` or `X-Ligis-Gate-Verdict`; STOP and UNKNOWN must not
authorize payment. The endpoint does not settle a payment.

```ts
// web/lib/payment-asset.ts — discriminated on tokenSymbol.
type PaymentAmount =
  | {
      tokenSymbol: "ZEC";
      chainId: "zcash:testnet" | "zcash:mainnet";
      amountBaseUnits: `${bigint}`;
    } // zatoshis, 8 dp, rail zcash-shielded
  | {
      tokenSymbol: "USDC";
      chainId: `eip155:${number}`;
      amountBaseUnits: `${bigint}`;
    }; // micro-USDC, 6 dp, rail evm-erc20

type PaymentIntent = PaymentAmount & {
  payee: string;
  amountUsd: number; // USD valuation; mandate caps are enforced against it
  purpose: string;
  capability?: string;
  mandate?: {
    payees?: string[];
    maxUsd?: number;
    expectedUsd?: number;
    scope?: string;
  };
  pageText?: string;
  zkProof?: ZkProofInput; // POST only — see "ZK credential proofs"
};
```

The parser requires a nonempty payee/purpose and finite positive amount.
`tokenSymbol`, `chainId`, and `amountBaseUnits` (JSON or query) are optional
for back-compat: when `tokenSymbol` is omitted the intent is USDC on
`eip155:10143` with base units derived from `amountUsd`. Explicit USDC base
units must equal the 6-decimal encoding of `amountUsd`; ZEC requires explicit
zatoshis. ZEC cannot target an EVM/Casper payee and explicit USDC cannot
target a Zcash shielded payee. Jev receives the exact base units, the token's
decimals, and a contract price scaled by the intent's implied USD rate.
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
   even when its history is verified. The Nansen leg is configured by
   `LIGIS_NANSEN_ENABLED=1`, `NANSEN_API_KEY`, the operator-confirmed
   `LIGIS_NANSEN_MONAD_CHAIN_ID`, and the intended network
   `LIGIS_PAYEE_EVIDENCE_CHAIN_ID`. Without a confirmed mapping, or when the
   payee's intended network is not that Monad network, the leg reports
   `nansen-chain-unconfirmed` / `nansen-wrong-chain` and spends no credits.

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

## ZK credential proofs (opt-in, POST only)

Implementation: `web/lib/zk-credential.ts` (policy), `web/lib/zk-verifier.ts`
(wiring), `packages/circuits-zcash` (Noir circuit, `bb` verifier, committed
verification key). A payee proves it holds an unexpired credential for the
gate's capability in a trusted registry tree, without revealing which
credential, issuer, or subject.

```ts
type ZkProofInput = {
  proof: `0x${string}`; // UltraHonk proof bytes (~14.6 KB)
  contextLabel: string; // ligis-gate:v1:<payee lowercased>:<capability>:<nonce>
  publicInputs: {
    registry_root: string; // 0x field
    payee_hash: string; // keccak256(lowercase trimmed Zcash address) mod p — committed in the leaf
    capability_hash: string; // keccak256(capability) mod p
    context: string; // keccak256(contextLabel) mod p
    current_time: string; // unix seconds the proof was made for
    nullifier: string; // H(secret, capability_hash, context)
  };
};
```

Generate one (demo holder) with
`pnpm --filter @ligis/circuits-zcash prove:sample -- --nonce <n> --json out.json`
and send it as `zkProof` (too large for a GET query string). Checks, in order:

| Check         | Fails as                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| trusted roots | none configured → `UNKNOWN`; root not pinned/published → `STOP`; manifest stale → `UNKNOWN` |
| capability    | no capability on the intent → `UNKNOWN`; `capability_hash` ≠ gate capability → `STOP`       |
| payee         | `payee_hash` ≠ keccak(intent `payee`) → `STOP` (credential issued to another address)       |
| context       | label not naming this payee + capability, or not hashing to `context` → `STOP`              |
| freshness     | `current_time` > now+60s or older than `LIGIS_ZK_MAX_PROOF_AGE_S` (600) → `STOP`            |
| replay        | (context, nullifier) already recorded → `STOP`                                              |
| proof         | `bb verify` rejects → `STOP`; `bb` missing/incompatible/timeout → `UNKNOWN`                 |
| record        | nullifier store unavailable → `UNKNOWN`                                                     |

The result is returned as `Decision.zkCredential`
(`{ status, verification: "verified" | "rejected" | "unverified", reason, registryRoot, rootSource?, nullifier, context, currentTime, verifier?, latencyMs? }`),
as a `zk-credential …` provenance line, and folded into `verified-payee`:
a rejected proof forces `STOP`; a verified proof answers `GO` unless the
public read said `STOP` for a reason other than "no public credential"
(revoked or self-issued still win; a shielded payee with nothing public is
exactly what the proof is for); an **unverified proof never counts** — it
leaves `verified-payee` `UNKNOWN` (so the verdict is `UNKNOWN`) unless the
public credential already answered `GO`. There is no silent pass.

**Trusted root.** The EVM `CredentialRegistry` has no on-chain Merkle root,
so the root is **published** off-chain and the gate trusts either:

- a root **pinned** in `LIGIS_ZK_TRUSTED_ROOTS` (comma-separated 0x hex;
  no staleness limit — the operator's explicit choice), or
- the root of the **published manifest** at `LIGIS_ZK_ROOT_MANIFEST` (a JSON
  file path, or `demo` for the built-in public demo registry, which also
  enables `POST /api/zk/demo-proof` `{ scenario: "holder" | "revoked" }`). The gate re-derives the root from the manifest's leaves on load
  (a tampered file is ignored with `published root manifest unusable: …` →
  `UNKNOWN` if nothing else is trusted), and a manifest whose `asOf` is older
  than `LIGIS_ZK_ROOT_MAX_AGE_S` (default 86400) is `UNKNOWN` — revocations
  may be missing, so it never answers `GO`.

`Decision.zkCredential.rootSource` is `"pinned"` or `"manifest"`. Build the
manifest with `pnpm --filter @ligis/circuits-zcash build-root` from
`CredentialIssued` / `CredentialRevoked` events (`--rpc <url> --registry 0x…
--from-block N`, read-only `eth_getLogs`; or `--events file`; or `--demo`) plus
subject registrations (`--registrations file`). A credential becomes a leaf
only if it is unrevoked (a revoke counts only from the same issuer), unexpired
at `--as-of`, and its EVM subject has registered an identity commitment:

```text
ligis-zk-commitment:v1
subject:<evm address, lowercase>
zcash:<zcash address, lowercase>
commitment:<0x identity_commitment = Poseidon(identity_secret)>
```

signed by the subject (EIP-191 `personal_sign`). Registrations with a bad
signature are dropped (`skipped.badRegistration`). Rebuild + republish on
every issue/revoke; rotating = publishing a new manifest (pinned roots stay
until removed).

### `GET /api/zk/root`

Public, cacheable 60 s. Returns what the gate trusts and the manifest a
holder needs to compute its Merkle path (`witnessFromManifest` in
`@ligis/circuits-zcash/registry`):

```json
{
  "circuit": "ligis_credential_membership",
  "publicInputs": [
    "registry_root",
    "payee_hash",
    "capability_hash",
    "context",
    "current_time",
    "nullifier"
  ],
  "pinnedRoots": ["0x…"],
  "maxRootAgeS": 86400,
  "manifest": {
    "status": "fresh",
    "version": 1,
    "depth": 16,
    "root": "0x…",
    "asOf": 1761350400,
    "leafCount": 3,
    "leaves": ["0x…"],
    "source": {
      "kind": "chain",
      "chainId": 1,
      "registry": "0x…",
      "fromBlock": "0",
      "toBlock": "…"
    },
    "skipped": {
      "revoked": 1,
      "expired": 1,
      "unregistered": 2,
      "badRegistration": 1
    }
  }
}
```

`manifest` is `null` when none is configured, `{ "status": "invalid", "error" }`
when it fails the root check, and `status: "stale"` past `maxRootAgeS`.
Leaves are Poseidon hashes: they reveal neither subject, payee, nor secret.

**Replay.** A verified proof's (context, nullifier) is recorded atomically;
reuse in that context is `STOP`. The store is Upstash/Vercel-KV
(`SET NX`, key prefix `LIGIS_ZK_NULLIFIER_KEY`, default `ligis:zk-nullifier`)
when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set; otherwise a
process-local set (single-process only — not replay-safe across serverless
instances). Unverified or rejected proofs do not burn the nullifier.

**Verifier.** `bb` must match the pinned build (`5.0.0-nightly.20260522`). The
gate uses `LIGIS_ZK_BB_BIN` when set (only that path), else
`~/.bb-versions/<pinned>/bb`, else `bb` on PATH. Vercel has no `bb`, so
proofs there report `unverified`. ~20–60 ms per verify locally.

**Payee binding.** The credential leaf commits to `payee_hash` (the Zcash
address the credential was registered for) and the circuit exposes it as a
public input, so a proof minted for one payee cannot be presented for
another: re-labelling the context is caught by the `payee_hash` check, and
rewriting `payee_hash` too makes `bb verify` fail. Run `pnpm demo:zcash-zk`
for the whole flow (publish root → prove → `GO` → replay `STOP` → redirect
`STOP` → verifier missing `UNKNOWN` → revoke `STOP`).

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
