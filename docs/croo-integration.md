# CROO Agent Protocol (CAP) Integration

This doc explains how Ligis integrates with the
[CROO Agent Protocol](https://docs.croo.network) so other agents can hire
Ligis on the CROO Agent Store to verify a counterparty **before** releasing
funds or sharing data.

## The problem Ligis solves on CROO

Agent-to-agent commerce breaks down when a buyer agent cannot prove that a
seller agent is who it claims to be and has the credentials required for
the job. Ligis sells a **counterparty risk check**: a pass/warn/fail
verdict backed by on-chain credentials on Casper and Pharos.

## Architecture

```
Requester Agent                       CROO/CAP                      Ligis Provider
    │                                     │                         @ligis/croo-adapter
    ├─ negotiateOrder(ligis.risk) ───────►│
    │                                     ├─ acceptNegotiation()
    │◄──────── OrderCreated ─────────────┤
    ├─ payOrder()                         │
    │                                     │◄── OrderPaid
    │                                     │   verifyCapability() on Casper/Pharos
    │                                     │   compute risk score
    │◄────────── deliverOrder() ──────────┤
    │         { overallVerdict, riskScore }
```

## Services

| Service | What it proves | On-chain action | Deliverable |
|---|---|---|---|
| `ligis.risk` | Counterparty risk check | `CredentialRegistry.isCapable` read(s) | `{ overallVerdict, riskScore, checks[], summary }` |
| `ligis.verify` | Single credential validity | `CredentialRegistry.isCapable` read | `{ capable, capabilityHash, latestCredential }` |
| `ligis.issue` | Issuer grants a capability | `CredentialRegistry.issue` write | `{ capabilityHash, txHash }` |

## Use case: verify an escrow agent

Before your agent sends $5000 to an escrow agent, hire Ligis:

```typescript
const requester = new LigisCrooRequester({ client, serviceId: "ligis.risk" });
const report = await requester.startAndWait({
  subject: "did:ligis:casper:contract-package-...",
  capabilities: ["agent.commerce.escrow", "kyc.verified"],
  minTtlSeconds: 7 * 24 * 60 * 60,
});

if (report.overallVerdict === "pass") {
  // proceed with payment
} else {
  // reject counterparty
}
```

## Setup

1. Go to [CROO Agent Store](https://agent.croo.network).
2. Create an agent named **Ligis**.
3. Register the three services from `packages/croo-adapter/croo-store-manifest.json`.
4. Copy the SDK key.
5. Create `.env.d/croo.env` from `.env.d/croo.env.example`.

## Run the provider

```bash
export $(grep -v '^#' .env.d/croo.env | grep -v '^$' | xargs)
pnpm croo
```

The provider will:

1. Connect to the CROO WebSocket.
2. Listen for `NegotiationCreated` events.
3. Accept negotiations for `ligis.risk`, `ligis.verify`, and `ligis.issue`.
4. On `OrderPaid`, read from or write to the configured Ligis chain.
5. Call `deliverOrder()` with a JSON verdict.

## Why this is differentiated

- **Cross-chain credentials**: a credential issued on Casper is verifiable on
  Pharos because `capabilityHash()` and the issuer secp256k1 key are shared.
- **On-chain enforcement**: signatures are recovered and issuers are enforced
  by the contract, not by a server.
- **Risk score**: `ligis.risk` goes beyond yes/no and returns a 0–100 score
  plus TTL warnings, making it actionable for automated A2A decisions.

## Files

- `packages/croo-adapter/` — TypeScript SDK + provider CLI
- `packages/croo-adapter/croo-store-manifest.json` — Agent Store listing manifest
- `.env.d/croo.env.example` — Required environment variables
- `packages/croo-adapter/test/provider.test.ts` — CAP lifecycle unit tests
