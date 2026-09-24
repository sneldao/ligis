# Ligis × Envio — Monad Testnet CredentialRegistry indexer

Free path for Metropolis: HyperIndex + HyperSync on chain `10143`, no paid RPC.

## Why this exists

Monad's public RPC accepts `eth_getLogs` but caps each call at **100 blocks**.
That is enough for a recent window in the web app; full issuer / capability
history needs an indexer. Envio is first-class on Monad and is the $1k
"Best use of Envio" bounty entry.

## Setup (free)

```bash
# 1. Free API token — https://app.envio.dev/api-tokens
export ENVIO_API_TOKEN=...

# 2. Install Envio CLI into this package (not a monorepo default dep)
cd packages/envio-indexer
pnpm add -D envio typescript
pnpm codegen
pnpm dev
# GraphQL default: http://localhost:8080/v1/graphql
# Docker required for local Postgres/Hasura
```

Point the web app at it:

```bash
# in the process that serves web/
export LIGIS_ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

Or deploy to **Envio Cloud** (free / Metropolis participant tier) and set
`LIGIS_ENVIO_GRAPHQL_URL` to the hosted Hasura endpoint.

## What is indexed

| Event                    | Entity                                     |
| ------------------------ | ------------------------------------------ |
| `CredentialIssued`       | issuer / subject / capability / block / tx |
| `CredentialRevoked`      | same                                       |
| `AgentCapabilityChanged` | subject / capable / block / tx             |

Contract: `0x698e1C05d34e2b6d0B6eCd71f3fC9e84e64733c5` (`deployment.monad-testnet`).

## Web wiring

`web/lib/chain.ts` prefers Envio for `monad-testnet` when
`LIGIS_ENVIO_GRAPHQL_URL` is set (`web/lib/envio.ts`). Otherwise it falls
back to chunked public-RPC scans (100-block windows).
