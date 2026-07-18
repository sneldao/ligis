# @ligis/croo-adapter

CROO Agent Protocol (CAP) adapter for Ligis. Makes Ligis a callable, paid
agent on the [CROO Agent Store](https://agent.croo.network) — focused on
**counterparty verification before A2A payment**.

## For CROO judges — 60 second repro

Ligis shares Casper Testnet contracts with our Casper Buildathon submission.
CAP is the commerce layer; Casper is the trust layer.

The provider runs 24/7 in production (`pm2`-managed), so you only need a
requester to hire it — no provider terminal required:

```bash
git clone https://github.com/sneldao/ligis && cd ligis && pnpm install

# 1. On-chain read only (no CROO keys required)
set -a && source .env.d/casper.env && set +a
pnpm demo:croo -- --on-chain-only

# 2. Full CAP lifecycle (needs CROO_SDK_KEY + USDC on requester wallet) — hits the live provider
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm demo:croo
```

To run your own provider instance instead of hitting the live one:

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a && pnpm croo
```

> `set -a` / `set +a` around each `source` is required — plain `source
> file.env` only sets shell-local variables, it doesn't export them to the
> `node`/`pnpm` child process, so `pnpm croo` would otherwise fail with
> `Missing required environment variable: CROO_SDK_KEY`.

Expected CAP flow: `negotiateOrder` → `OrderCreated` → `payOrder` → `OrderCompleted` → JSON delivery with `capable` or `overallVerdict` + `riskScore`.

Unit tests (mock CAP lifecycle + idempotent `OrderPaid`):

```bash
pnpm -r --filter @ligis/croo-adapter run test
```

BUIDL copy: [`docs/croo-hackathon-submission.md`](../../docs/croo-hackathon-submission.md)

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

Listed on the CROO Agent Store:

| Service ID | Purpose | Example input | Price |
|---|---|---|---|
| **`ligis.risk`** | **Counterparty risk check** — pass/warn/fail + 0–100 score | `{ subject, capabilities: ["agent.commerce.escrow"], minTtlSeconds: 86400 }` | $0.75 |

## Why agents will pay for this

A2A commerce fails when a buyer agent pays a seller agent that lacks the
claimed credentials. `ligis.risk` turns credential verification into a
simple go/no-go decision with a score, protecting larger underlying
payments. It's the one service in this package that does more than a raw
on-chain read: it batches multiple capability checks, computes TTL-until-expiry,
and turns the result into a verdict — work a buyer agent would otherwise have
to write itself.

## Roadmap (implemented, not listed on the Store)

The provider code also handles these, but they aren't priced/listed yet
because they aren't defensible as standalone paid services today:

| Service ID | Purpose | Why it's not listed |
|---|---|---|
| `ligis.verify` | Single-credential verification | A bare `CredentialRegistry.isCapable` read is a public on-chain view function — any counterparty can call it directly for the cost of an RPC request. Needs a real value-add (e.g. resolving Casper *and* Pharos in one call) before it's worth a fee. |
| `ligis.issue` | Issue a signed capability credential | This is a real write (gas, key custody) but only has demand once "issued by Ligis" is trusted by the ecosystem — not yet established for a new hackathon agent. |

## Setup

1. Create an agent in the [CROO Agent Store](https://agent.croo.network).
2. Register the `ligis.risk` service from `croo-store-manifest.json`.
3. Copy the SDK key.
4. Create `.env.d/croo.env` from `.env.d/croo.env.example`.

```bash
set -a && source .env.d/casper.env && source .env.d/croo.env && set +a
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
| `LIGIS_EAS_ADDRESS` | Required for EAS-backed `ligis.issue` imports |
| `LIGIS_EAS_RPC_URL` | EVM RPC used to read EAS attestations |
| `LIGIS_EAS_CHAIN_ID` | Source chain ID for EAS provenance |
| `LIGIS_EAS_TRUSTED_ATTESTERS` | Comma-separated EAS attester allowlist |
| `LIGIS_EAS_SCHEMA_CAPABILITIES` | JSON map of EAS schema IDs to Ligis capabilities |

### EAS-backed issuance

`ligis.issue` remains backward-compatible. Without `externalAttestation`, it
uses the existing Ligis-issued path. With `externalAttestation.source="eas"`,
the provider reads EAS, applies the configured trust policy, and only then
submits the Ligis credential.

Example request:

```json
{
  "subject": "0x3333333333333333333333333333333333333333",
  "capability": "kyc.basic",
  "expiresInSeconds": 86400,
  "externalAttestation": {
    "source": "eas",
    "uid": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "chainId": "8453",
    "schema": "0x2222222222222222222222222222222222222222222222222222222222222222"
  }
}
```

Where to get the EAS values:

- `LIGIS_EAS_ADDRESS`: the EAS contract for the source chain. Use the official
  EAS deployment artifacts:
  <https://github.com/ethereum-attestation-service/eas-contracts/tree/master/deployments>
- `LIGIS_EAS_RPC_URL`: an RPC URL for that same EVM chain, from your RPC
  provider or infrastructure account.
- `LIGIS_EAS_CHAIN_ID`: the numeric chain ID for the source EAS chain.
- `LIGIS_EAS_TRUSTED_ATTESTERS`: the attester address or comma-separated
  addresses you are willing to trust for imported credentials. Get this from
  the EAS attestation record or from the upstream verifier's published issuer
  address.
- `LIGIS_EAS_SCHEMA_CAPABILITIES`: JSON mapping from source schemas to Ligis
  capabilities, for example
  `{"eas:0x...schema":"kyc.basic"}`. Get schema IDs from EASScan or the
  upstream verifier's schema documentation.
- Attestation `uid`, `schema`, `recipient`, `attester`, expiry, and revocation
  status can be inspected on EASScan or through the EASScan GraphQL API:
  <https://docs.attest.org/docs/developer-tools/api>

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
  minTtlSeconds: 7 * 24 * 60 * 60,
});

const report = JSON.parse(text);
console.log(report.overallVerdict, report.riskScore, report.summary);
```

## Testing

```bash
pnpm -r --filter @ligis/croo-adapter run test
```
