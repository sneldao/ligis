# Ligis × Envio — Monad Testnet CredentialRegistry indexer

Free path for Metropolis: HyperIndex + HyperSync on chain `10143`, no paid RPC.

## Live endpoint (VPS)

HyperIndex runs on `nuncio-vultr` at `/opt/ligis-envio`:

```text
LIGIS_ENVIO_GRAPHQL_URL=http://144.202.117.160:18080/v1/graphql
```

Public Hasura role can read entities (no admin secret). Ports: Postgres
`5435`, Hasura `18080` (avoids Coolify `8080` and directors-canvas `5433`).
Indexer is enabled as systemd unit `ligis-envio-indexer` for reboot; Docker
compose stack is `ligis-envio-postgres` + `ligis-envio-hasura`.

Set the URL on Vercel (web production) and locally when exercising Monad
issuer / capability history.

## Why this exists

Monad's public RPC accepts `eth_getLogs` but caps each call at **100 blocks**.
That is enough for a recent window in the web app; full issuer / capability
history needs an indexer. Envio is first-class on Monad and is the $1k
"Best use of Envio" bounty entry.

## Secrets (do not commit)

Store the HyperSync API token only in gitignored env:

```bash
# ../../.env.d/envio.env  (mode 600, already gitignored via .env.d/)
ENVIO_API_TOKEN=<from https://app.envio.dev/api-tokens>
```

On the VPS the same token lives in `/opt/ligis-envio/.env` (mode 600) as
`ENVIO_API_TOKEN` plus `HASURA_GRAPHQL_ADMIN_SECRET`.

Load before local codegen / dev / smoke:

```bash
set -a && source ../../.env.d/envio.env && set +a
```

Verified 2026-09-24: this token can call **HyperSync**
(`monad-testnet.hypersync.xyz`) — height + log queries against
`CredentialRegistry` succeed. It does **not** include HyperRPC product access
(`*.rpc.hypersync.xyz`); that is fine — HyperIndex uses HyperSync, and the web
app keeps the public Monad RPC for ordinary reads. Free-tier HyperSync can
rate-limit; the indexer retries automatically.

## Setup (free, local)

**Requires Docker** for `envio dev` (local Postgres + Hasura). Without Docker,
codegen still works; full sync needs Docker, the VPS stack above, or Envio Cloud.

```bash
# 1. Token in ../../.env.d/envio.env (see above)
set -a && source ../../.env.d/envio.env && set +a

# 2. CLI already listed as a package dep; or:
pnpm add -D envio typescript

# 3. Generate types
pnpm codegen

# 4. Run indexer (Docker required)
pnpm dev
# GraphQL default: http://localhost:8080/v1/graphql
```

Smoke the token without Docker:

```bash
set -a && source ../../.env.d/envio.env && set +a
pnpm smoke:hypersync
```

Point the web app at the indexer:

```bash
# local
export LIGIS_ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql
# production (Vercel) — same as live VPS endpoint above
```

## Handlers (Envio v3)

`src/EventHandlers.ts` registers via `indexer.onEvent` from `envio` (not the
removed `generated` package). `CredentialIssued` ABI param order must match
the Solidity event: `nonce`, then `issuedAt`, then `expiresAt`.

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
