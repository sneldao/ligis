# @ligis/croo-adapter

CROO Agent Protocol (CAP) adapter for Ligis. Makes Ligis a callable, paid
agent on the [CROO Agent Store](https://agent.croo.network) — focused on
**counterparty verification before A2A payment**.

## The one-sentence pitch

> Don't release funds to another agent until Ligis proves it holds the
> credentials required for the job.

## What it does

- **Provider mode** (`ligis-croo-provider`): listens for incoming CROO
  negotiations, accepts orders, performs the Ligis risk check or credential
  verification, and delivers a JSON verdict on-chain.
- **Requester mode** (`LigisCrooRequester`): hires another Ligis-capable
  agent to verify a counterparty before you pay.

## Services

| Service ID | Purpose | Example input | Price |
|---|---|---|---|
| **`ligis.risk`** | **Counterparty risk check** — pass/warn/fail + 0–100 score | `{ subject, capabilities: ["agent.commerce.escrow"], minTtlSeconds: 86400 }` | $0.75 |
| `ligis.verify` | Single-credential verification | `{ subject, capability: "agent.commerce.escrow" }` | $0.50 |
| `ligis.issue` | Issue a signed capability credential | `{ subject, capability: "kyc.verified", expiresInSeconds: 604800 }` | $2.00 |

## Why agents will pay for this

A2A commerce fails when a buyer agent pays a seller agent that lacks the
claimed credentials. `ligis.risk` turns credential verification into a
simple go/no-go decision with a score, protecting larger underlying
payments.

## Setup

1. Create an agent in the [CROO Agent Store](https://agent.croo.network).
2. Register the three services from `croo-store-manifest.json`.
3. Copy the SDK key.
4. Create `.env.d/croo.env` from `.env.d/croo.env.example`.

```bash
export $(grep -v '^#' .env.d/croo.env | grep -v '^$' | xargs)
pnpm croo
```

## Environment

| Variable | Purpose |
|---|---|
| `CROO_API_URL` | CROO API base URL |
| `CROO_WS_URL` | CROO WebSocket URL |
| `CROO_SDK_KEY` | SDK key from CROO Dashboard |
| `LIGIS_CHAIN` | `casper` or `pharos` |
| `LIGIS_ISSUER_PRIVATE_KEY` | Required only for `ligis.issue` |

## Example: verify an escrow agent before payment

```typescript
import { AgentClient } from "@croo-network/sdk";
import { LigisCrooRequester, loadCrooConfig } from "@ligis/croo-adapter";

const config = loadCrooConfig();
const client = new AgentClient(
  { baseURL: config.apiURL, wsURL: config.wsURL },
  config.sdkKey,
);

const requester = new LigisCrooRequester({
  client,
  serviceId: "ligis.risk",
});

const text = await requester.startAndWait({
  subject: "did:ligis:casper:contract-package-...",
  capabilities: ["agent.commerce.escrow", "kyc.verified"],
  minTtlSeconds: 7 * 24 * 60 * 60, // at least 7 days of validity
});

const report = JSON.parse(text);
console.log(report.overallVerdict, report.riskScore, report.summary);
```

## Testing

```bash
pnpm -r --filter @ligis/croo-adapter run test
```
