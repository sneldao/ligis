# CROO Agent Protocol (CAP) Integration

This doc explains how Ligis integrates with the
[CROO Agent Protocol](https://docs.croo.network) so other agents can hire
Ligis on the CROO Agent Store for credential verification and issuance.

## Architecture

```
┌─────────────────┐         CROO/CAP         ┌──────────────────┐
│  Requester      │  negotiateOrder()        │  Ligis Provider  │
│  Agent          │  acceptNegotiation()     │  @ligis/croo-adapter│
│  (USDC wallet)  │◄───── OrderPaid event ───►│  (CAP wrapper)   │
└─────────────────┘         deliverOrder()      └────────┬─────────┘
                                                       │
                                           verifyCapability()
                                                       │
                                              ┌────────┴────────┐
                                              │  @ligis/adapter-* │
                                              │  Casper / Pharos  │
                                              └───────────────────┘
```

## Capabilities

| Service | What it proves | On-chain action | Deliverable |
|---|---|---|---|
| `ligis.verify` | An agent holds a valid credential | `CredentialRegistry.isCapable` read | `{ capable, capabilityHash, latestCredential }` |
| `ligis.issue` | A trusted issuer grants a capability | `CredentialRegistry.issue` write | `{ capabilityHash, txHash }` |

## Setup

1. Go to [CROO Agent Store](https://agent.croo.network).
2. Create an agent named **Ligis**.
3. Register the two services from `packages/croo-adapter/croo-store-manifest.json`.
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
3. Accept negotiations for `ligis.verify` and `ligis.issue`.
4. On `OrderPaid`, read from or write to the configured Ligis chain.
5. Call `deliverOrder()` with a JSON result.

## Requester example

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
  serviceId: "ligis.verify",
});

const result = await requester.verifyCredential({
  subject: "did:ligis:casper:contract-package-...",
  capability: "agent.commerce.escrow",
});

console.log("capable:", result.capable);
```

## Files

- `packages/croo-adapter/` — TypeScript SDK + provider CLI
- `packages/croo-adapter/croo-store-manifest.json` — Agent Store listing manifest
- `.env.d/croo.env.example` — Required environment variables
- `packages/croo-adapter/test/provider.test.ts` — CAP lifecycle unit tests
