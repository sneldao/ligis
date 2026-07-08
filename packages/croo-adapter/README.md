# @ligis/croo-adapter

CROO Agent Protocol (CAP) adapter for Ligis. Lets other agents hire Ligis on
[CROO Agent Store](https://agent.croo.network) to verify or issue portable
on-chain credentials.

## What it does

- **Provider mode** (`ligis-croo-provider`): listens for incoming CROO
  negotiations, accepts orders, performs the Ligis verification/issuance, and
  delivers the result on-chain.
- **Requester mode** (`LigisCrooRequester`): hires another CAP-registered
  Ligis agent to verify a credential.

## Services

| Service ID | Purpose | Example input | Price |
|---|---|---|---|
| `ligis.verify` | Verify a credential on Casper/Pharos | `{ subject, capability, issuer? }` | $0.50 |
| `ligis.issue` | Issue a signed capability credential | `{ subject, capability, expiresInSeconds? }` | $2.00 |

## Setup

1. Create an agent in the [CROO Agent Store](https://agent.croo.network).
2. Register the services from `croo-store-manifest.json`.
3. Issue an SDK key and fund the agent's AA wallet with USDC.
4. Copy `.env.d/croo.env.example` to `.env.d/croo.env` and fill in the SDK key.

```bash
export $(grep -v '^#' .env.d/croo.env | grep -v '^$' | xargs)
pnpm start --filter @ligis/croo-adapter
```

## Environment

| Variable | Purpose |
|---|---|
| `CROO_API_URL` | CROO API base URL |
| `CROO_WS_URL` | CROO WebSocket URL |
| `CROO_SDK_KEY` | SDK key from CROO Dashboard |
| `LIGIS_CHAIN` | `casper` or `pharos` |
| `LIGIS_ISSUER_PRIVATE_KEY` | Required only for `ligis.issue` |

## Programmatic usage

```typescript
import { AgentClient } from "@croo-network/sdk";
import { LigisCrooProvider, createCrooClient, loadCrooConfig } from "@ligis/croo-adapter";

const config = loadCrooConfig();
const client = createCrooClient(
  { baseURL: config.apiURL, wsURL: config.wsURL },
  config.sdkKey,
);

const provider = new LigisCrooProvider({ client });
await provider.start();
```

## Testing

```bash
pnpm -r --filter @ligis/croo-adapter run test
```
