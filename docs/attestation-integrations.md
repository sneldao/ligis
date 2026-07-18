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

## Rollout

1. Ship the chain-neutral verifier boundary in `@ligis/core`.
2. Implement an EAS read adapter and test schema/attester allowlists.
3. Implement Self disclosure verification and bind the result to a Ligis
   Agent ID or wallet subject.
4. Add an aggregation issuance flow to `ligis.issue`, including provenance in
   the deliverable and risk report.
5. Add UI provenance chips and source-specific freshness/revocation signals.
6. Add a second independent issuer before treating issuer diversity as a
   meaningful risk signal.

The existing self-issued demo path may remain available on testnet, but must
be labelled as Ligis-issued evidence rather than external verification.
