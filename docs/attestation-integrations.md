# External Attestation Integrations

Ligis is an aggregation and policy layer for autonomous-agent trust. Self
Protocol and EAS are upstream evidence sources; neither replaces the Ligis
`CredentialRegistry` on Pharos or Casper.

## Trust boundary

```text
Self proof / EAS attestation
          │ protocol-specific verification
          ▼
  normalized ExternalAttestation
          │ Ligis issuer + policy decision
          ▼
  Ligis capability credential
          │ portable on-chain read
          ▼
  isCapable(subject, capabilityHash)
```

The normalized result must retain provenance: source, source UID, schema or
proof type, attester, checked time, expiry, and revocation status. It must not
retain passport contents, document images, or other personal data. Store a
hash/reference where auditability is required.

## Source roles

### Self Protocol

Self is the human/controller evidence source. Its zero-knowledge disclosure
flow can prove claims such as proof-of-human, age, nationality, or KYC without
handing Ligis the underlying document. Ligis should map a successful, fresh
proof to a narrowly scoped capability such as `human.controller` or
`kyc.basic`.

Do not describe this as proving that the autonomous agent itself is human. The
credential means that a wallet or agent identity is linked to a verified
controller under a declared policy.

Self's current Agent ID contracts are centered on Celo deployments. The first
integration should therefore verify on Self's supported network and issue a
Ligis credential on the selected Ligis chain; it should not assume Self is
available natively on Pharos or Casper.

### Ethereum Attestation Service (EAS)

EAS is the general attestation/provenance source. Ligis should accept only
explicitly allowlisted schemas and attesters, then map their claims to
capabilities. An EAS attestation is evidence that an attester made a statement;
it is not, by itself, a trust verdict.

The first EAS adapter should be read/verify-only. A later write path may anchor
a reference to a Ligis credential in EAS for discoverability, but the Ligis
registry remains the enforcement surface used by contracts and agents.

## Policy requirements

Every import decision must record:

- accepted source and trusted attester;
- schema/proof type and capability mapping;
- source status (valid, expired, revoked, or invalid);
- freshness and credential expiry;
- privacy-safe evidence reference;
- machine-readable risk signals.

Unknown schemas, unknown attesters, stale proofs, revoked evidence, and
ambiguous subject bindings must fail closed. A source outage must produce an
`unavailable` operational error, not a fresh credential.

## EAS operator setup

External evidence is what makes a credential mean something: `ligis.issue` and
`ligis.qualify` both refuse to mint a capability from payment alone unless it is
listed in `LIGIS_SELF_ISSUABLE_CAPABILITIES` (empty by default). If a request
includes `externalAttestation.source="eas"`, the CROO provider requires these
environment variables:

| Variable                         | Source                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIGIS_EAS_ADDRESS`              | EAS contract address for the source chain. Use the official EAS deployment artifacts: <https://github.com/ethereum-attestation-service/eas-contracts/tree/master/deployments> |
| `LIGIS_EAS_RPC_URL`              | RPC URL for the same EVM chain that hosts the attestation                                                                                                                     |
| `LIGIS_EAS_CHAIN_ID`             | Numeric chain ID for that EAS source chain                                                                                                                                    |
| `LIGIS_EAS_TRUSTED_ATTESTERS`    | Comma-separated allowlist of upstream attester addresses                                                                                                                      |
| `LIGIS_EAS_SCHEMA_CAPABILITIES`  | JSON map from EAS schema keys to Ligis capability names                                                                                                                       |
| `LIGIS_EAS_MAX_AGE_SECONDS`      | Optional freshness window for the source status check; defaults to `300`                                                                                                      |
| `LIGIS_EAS_REQUIRE_FRESH_STATUS` | Optional; defaults to `true` and requires an expiry boundary                                                                                                                  |

Use EASScan or the EASScan GraphQL API to inspect attestation UIDs, schema IDs,
attesters, recipients, expiry, and revocation status:
<https://docs.attest.org/docs/developer-tools/api>.

Example capability map:

```json
{
  "eas:0x2222222222222222222222222222222222222222222222222222222222222222": "kyc.basic"
}
```

Example `ligis.issue` requirements:

````json
{
  "subject": "0x3333333333333333333333333333333333333333",
  "capability": "kyc.basic",
  "externalAttestation": {
    "source": "eas",
    "uid": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "chainId": "8453",
    "schema": "0x2222222222222222222222222222222222222222222222222222222222222222"
  }
}

## Rollout

1. Ship the chain-neutral verifier boundary in `@ligis/core`.
2. Ship the read-only EAS adapter in `@ligis/adapter-evm`.
3. Wire EAS-backed issuance into `ligis.issue`.
4. Configure production EAS schema and attester allowlists per environment.
5. Implement Self disclosure verification and bind the result to a Ligis
   Agent ID or wallet subject.
6. Add UI provenance chips and source-specific freshness/revocation signals.
7. Add a second independent issuer before treating issuer diversity as a
   meaningful risk signal.

The existing self-issued demo path may remain available on testnet, but must
be labelled as Ligis-issued evidence rather than external verification.

## Chainlink Runtime Environment (CRE) — *considered and deferred*

> Status: **deferred** (Metropolis hackathon, 2026-10-14). The CRE port was
> planned (3.5-day lift: adapter contract + WASM workflow + shim service)
> and partially researched (the SDK + CLI surface notes below are accurate
> as of `@chainlink/cre-sdk@1.23.0`, CLI v1.3.0), but the work was skipped
> because the product gain — threshold-issued credentials replacing a
> single-key operator wallet — is real but small relative to the cost, and
> the existing local `stewardLoop` already serves the demo and submission
> path. Revisit if/when a Ligis user surfaces whose threat model requires
> BLS-issued credentials, or if a future bounty materially rewards the
> integration. Nothing has been built; nothing in the repo depends on this
> section. Leaving the surface notes here as a starting point for whoever
> picks it up next.

CRE is a workflow runtime on a Chainlink DON that produces BLS-signed
**reports** consumed by a forwarder contract on the target chain. It is the

CRE is a workflow runtime on a Chainlink DON that produces BLS-signed
**reports** consumed by a forwarder contract on the target chain. It is the
right tool when the orchestration needs to be verifiable end-to-end, not just
typed by the operator's hot wallet.

### Surface (as of `@chainlink/cre-sdk@1.23.0`, CLI v1.3.0)

- TypeScript SDK, compiled to WASM via Javy/QuickJS. **No Node built-ins in
  workflow code** — only `cre.capabilities.*` and viem primitives.
- CRE CLI v1.3.0 already installed at `~/.cre/bin/cre`. `cre update` upgrades.
- Triggers: `cron`, `http` (POST), `evm log`. The HTTP trigger is the natural
  entry point for the steward: `POST /cre-steward { goal, subject, capabilities }`.
- EVM writes are **not** "DON signs EIP-712 and broadcasts" — they are:
  `runtime.report(payload)` → BLS-signed `ReportResponse` →
  `keystone-forwarder.onReport(metadata, body, sigs)` on the target chain.
  The forwarder verifies the BLS threshold sig against the DON's `configDigest`
  and then calls a target contract. **The DON does not produce an
  ECDSA-over-EIP-712 signature tied to a stable EVM address.**
- Consensus reads (`evmClient.callContract`) are aggregated across the DON
  before the workflow continues — the capability check (`isCapable`) lands
  on multiple nodes and the agreement is the input.
- 200+ chain selectors supported. **`monad-testnet` is supported**
  (chain selector `2183018362218727504`). `pharos-atlantic-testnet` is also
  supported — not relevant to the CRE bounty, kept for parity.
- `cre workflow simulate <folder> --http-payload <json> --non-interactive --broadcast`
  simulates a workflow locally and, with `--broadcast`, actually submits
  transactions to the configured target chain. This is the bounty deliverable.

### Why the report model is a real change, not a wrapper

The local steward signs EIP-712 with the operator key (`PRIVATE_KEY`). The
registry's `issue()` recovers the signer and stores it as `cred.issuer`.
A CRE workflow that wants to call `registry.issue()` directly would have to
sign EIP-712 with a stable DON-controlled EVM address — which CRE doesn't
expose. So a CRE port needs one of two architectural changes:

1. **Adapter contract** (recommended): a thin `CRECredentialIssuer` that
   implements the forwarder `onReport(metadata, body, sigs)` interface,
   verifies the BLS signature (or delegates to a pre-deployed
   `keystone-forwarder`), decodes the body, and calls `registry.issue()`.
   The adapter is the issuer of record, pre-registered with the registry at
   deploy time, so the EIP-712 signature is its own. The body is just the
   credential parameters.
2. **Native forwarder function on the registry**: add
   `issueViaForwarder(subject, capHash, expiry, nonce, metadata, body, sigs)`
   to `CredentialRegistry` itself, with the same BLS verification inlined.
   More invasive; the registry grows a hard dependency on the keystone layout.

Path 1 keeps the registry unchanged, which is the property the existing
CROO/x402/gate/steward callers depend on.

### Properties CRE adds over the local loop

- **Threshold-signed issuance.** The issuer becomes a BLS threshold key held
  by a Chainlink DON, not a single operator key. Compromising one operator
  no longer compromises issuance.
- **DON-consensus reads.** The `isCapable` call in the gate step is verified
  across multiple nodes, not one RPC. The verifier surface stops being a
  single RPC dependency.
- **Reproducible orchestration.** The workflow source is compiled to WASM
  and the on-chain result references the `configDigest` + `workflowId` +
  `workflowOwner` carried in the report metadata. The chain-side receipt
  can be traced back to the exact workflow code that produced it.
- **No new trust root.** The local operator key can still issue; CRE is an
  additional issuer, not a replacement. `isCapable` already accepts
  credentials from any authorized issuer.

### Seam (what runs where)

```text
HTTP trigger
  │
  ▼
cre workflow (CRE WASM, Javy)
  ├─ evmClient.callContract  → registry.isCapable(subject, capHash)
  │     (DON-consensus read)
  ├─ httpClient.sendRequest  → shim /reason  { goal }
  │     (runs 0G Compute + buildReasoningPrompt; the TS-only bits
  │      that Javy can't host; honest HTTP boundary)
  ├─ httpClient.sendRequest  → shim /store-manifest  { manifest }
  │     (runs 0G Storage; same boundary)
  └─ evmClient.writeReport   → keystone-forwarder
        → CRECredentialIssuer.onReport(metadata, body, sigs)
            → registry.issue(subject, capHash, expiry, nonce, sig)
````

The local `stewardLoop` callers (x402 gate, CROO adapter,
`monad-steward-smoke`) keep using the local loop unchanged. The CRE
workflow is a **new** code path that demonstrates the orchestration
pattern; the existing production path is not replaced.

### Cost & risk (refined)

| Step                                          | Time      | Notes                                                          |
| --------------------------------------------- | --------- | -------------------------------------------------------------- |
| 1. Validate surface                           | 0.5d      | **DONE — this section.**                                       |
| 2. Shim service (~150 LOC)                    | 0.5d      | `packages/cre-shim/`, Hono or Fastify, reuses `@ligis/core`.   |
| 3. Adapter contract `CRECredentialIssuer.sol` | 0.5d      | Forwards `onReport` to `registry.issue` after BLS verify.      |
| 4. CRE workflow + config                      | 1d        | `cre/steward/main.ts`, `config.staging.json`, `workflow.yaml`. |
| 5. Simulation script + assertions             | 0.25d     | `pnpm cre:simulate` — same shape as `monad-steward-smoke`.     |
| 6. Demo + integration doc                     | 0.5d      | 2-min recording, Monad explorer links, `/field` badge.         |
| 7. Submit                                     | 0.25d     | Reuse `BUIDL.md` template.                                     |
| **Total**                                     | **~3.5d** |                                                                |

The biggest residual risk: whether `keystone-forwarder` is already deployed
on Monad testnet by Chainlink (vs us needing to deploy our own and register
it with the DON). First action in step 3 is to probe Monad for the forwarder
address; if absent, we deploy a minimal forwarder ourselves and document the
trust assumption.

### Open follow-ups before step 3

- Probe Monad testnet for the `keystone-forwarder` address (one RPC call).
- Confirm `cre update` lands cleanly on v1.38.0 — the v1.3.0 → v1.38.0 jump
  is large enough to potentially break workflow source shape, and the
  simulator should run on the latest CLI before we commit to a config layout.
- Verify the BLS precompile/library situation on Monad testnet
  (`0x…` for BLS12-381 pairing). If absent, the adapter contract needs to
  verify against a `BN254`-style curve instead, or delegate to a deployed
  verifier contract.

```

```
