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

EAS-backed issuance is opt-in per `ligis.issue` request. If a request includes
`externalAttestation.source="eas"`, the CROO provider requires these
environment variables:

| Variable | Source |
|---|---|
| `LIGIS_EAS_ADDRESS` | EAS contract address for the source chain. Use the official EAS deployment artifacts: <https://github.com/ethereum-attestation-service/eas-contracts/tree/master/deployments> |
| `LIGIS_EAS_RPC_URL` | RPC URL for the same EVM chain that hosts the attestation |
| `LIGIS_EAS_CHAIN_ID` | Numeric chain ID for that EAS source chain |
| `LIGIS_EAS_TRUSTED_ATTESTERS` | Comma-separated allowlist of upstream attester addresses |
| `LIGIS_EAS_SCHEMA_CAPABILITIES` | JSON map from EAS schema keys to Ligis capability names |
| `LIGIS_EAS_MAX_AGE_SECONDS` | Optional freshness window for the source status check; defaults to `300` |
| `LIGIS_EAS_REQUIRE_FRESH_STATUS` | Optional; defaults to `true` and requires an expiry boundary |

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

```json
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
