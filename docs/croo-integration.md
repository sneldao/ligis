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

Listed on the CROO Agent Store:

| Service | Price | What it proves | On-chain action | Deliverable |
|---|---|---|---|---|
| `ligis.risk` | $0.75 | Counterparty risk check | `CredentialRegistry.isCapable` read(s) | `{ overallVerdict, riskScore, checks, summary, breakdown, signals, checkedAt }` |
| `ligis.verify` | $0.50 | On-chain credential verification | `CredentialRegistry.isCapable` read | `{ service, capable, subject, capability, capabilityHash, latestCredential, checkedAt }` |
| `ligis.issue` | $1.00 | Credential issuance (on-chain tx) | `CredentialRegistry.issue` write | `{ service, subject, capability, capabilityHash, issuer, issuedAt, expiresAt, txHash, submittedAt }` |

All three services are live and tested end-to-end. The full loop works:
issue a credential → verify returns `capable: true` → risk check returns
`warn` (maturing to `pass` after 7 days) instead of `fail`.

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

## Judge repro

The Ligis provider is already running 24/7 in production, so hiring it just
needs a requester — no need to run a provider yourself:

```bash
# Hire Ligis via CAP (hits the live provider)
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm demo:croo

# On-chain only — Casper CredentialRegistry read, no CROO payment
set -a && source .env.d/casper.env && set +a && pnpm demo:croo -- --on-chain-only
```

To run your own provider instance instead (e.g. to test changes locally):

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm croo
```

> Note the `set -a` / `set +a` around the `source` calls: plain `source
> file.env` only sets shell-local variables, it does not export them to the
> `node` child process, so `pnpm croo` would otherwise fail with `Missing
> required environment variable: CROO_SDK_KEY`.

See [`docs/croo-hackathon-submission.md`](croo-hackathon-submission.md) for BUIDL copy.

## Setup

1. Go to [CROO Agent Store](https://agent.croo.network).
2. Create an agent named **Ligis**.
3. Register the `ligis.risk` service from `packages/croo-adapter/croo-store-manifest.json`.
4. Copy the SDK key.
5. Create `.env.d/croo.env` from `.env.d/croo.env.example`.

## Run the provider

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a
pnpm croo
```

**In production this runs 24/7 under `pm2` on dedicated infrastructure**, not
in a terminal — same `pm2` convention (`releases/<timestamp>/current` symlink,
`ecosystem.config.js`, `pm2 save`) used by our other long-running services.
The host isn't documented here since it's shared with unrelated projects;
ask the team for deploy access if you need to ship an update.

The provider will:

1. Connect to the CROO WebSocket.
2. Listen for `NegotiationCreated` events.
3. Accept negotiations for `ligis.risk`, `ligis.verify`, and `ligis.issue`.
4. On `OrderPaid`, read from the configured Ligis chain.
5. Call `deliverOrder()` with a JSON verdict.

## Why this is differentiated

- **Cross-chain credentials**: a credential issued on Casper is verifiable on
  Pharos because `capabilityHash()` and the issuer secp256k1 key are shared —
  a buyer agent gets one verdict without needing to know or query which chain
  the credential actually lives on.
- **On-chain enforcement**: signatures are recovered and issuers are enforced
  by the contract, not by a server.
- **Risk score**: `ligis.risk` goes beyond yes/no and returns a 0–100 score
  plus TTL warnings, capability criticality weighting, credential maturity
  checks, and issuer diversity analysis — making it actionable for automated
  A2A decisions. The scoring model is transparent: every verdict includes a
  breakdown of sub-scores and signals so the buyer agent can understand why
  it got `warn` instead of `pass`.
- **Aggregation play (roadmap)**: `ligis.issue` will aggregate external
  verifiers (Self Protocol, World ID, EAS) into unified on-chain credentials,
  solving the chicken-and-egg problem by importing trust rather than
  bootstrapping it. See [`docs/strategy.md`](strategy.md) for the full plan.
- **Distribution built into the product**: every agent on CROO can hire
  Ligis and get credentialed by Ligis. The marketplace is the distribution
  channel — no separate user acquisition needed.

## Files

- `packages/croo-adapter/` — TypeScript SDK + provider CLI
- `packages/croo-adapter/croo-store-manifest.json` — Agent Store listing manifest
- `.env.d/croo.env.example` — Required environment variables
- `packages/croo-adapter/test/provider.test.ts` — CAP lifecycle unit tests
