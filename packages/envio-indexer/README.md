# Ligis Envio indexer — Monad testnet

HyperIndex 3.12.1 on chain 10143, with existing CredentialRegistry events and
official ERC-8004 v2 identity/wallet/reputation events.

## Local validation (no deployment or chain writes)

```sh
pnpm --filter @ligis/envio-indexer codegen
pnpm --filter @ligis/envio-indexer typecheck
pnpm --filter @ligis/envio-indexer test
```

Simulation tests exercise the actual handlers without a live RPC or token.
Codegen writes ignored `.envio` files; do not commit generated build trees.

## Scope

| Contract/event                                              | Entity/behavior                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| CredentialIssued, CredentialRevoked, AgentCapabilityChanged | Existing credential history                                     |
| IdentityRegistry Registered                                 | Scoped identity + initial wallet                                |
| MetadataSet / agentWallet                                   | Packed 20-byte wallet claims, including unset                   |
| Transfer                                                    | Ownership update; clears wallet, never infers wallet from owner |
| URIUpdated                                                  | Agent URI update                                                |
| ReputationRegistry NewFeedback                              | Signed value, decimals, tags, client, URI/hash references       |
| FeedbackRevoked                                             | Revocation ledger + current feedback revocation                 |
| ResponseAppended                                            | Response URI/hash ledger                                        |
| Block handler                                               | Scoped coverage from block 0 through the processed block        |

IDs include chain and registry. Wallet claims are retained after changes,
so a payee can discover historical candidates; the web reader must always
confirm their current `getAgentWallet` on-chain.

Standard registries start at block 0. The credential contract retains its
later start block at 63359400. Do not change the full-history start without
updating `Erc8004Coverage` and preserving incomplete-coverage semantics.

Configured addresses:

- CredentialRegistry v2: `0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a`.
- IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

## Integration and operations

The web gate uses server-owned `LIGIS_ENVIO_GRAPHQL_URL`. New tables must be
available to its read-only role. It cursor-paginates scoped wallet claims and
references, validates coverage against a finalized RPC snapshot, and confirms
bindings/revocation on-chain. Old deployments without the new tables fall
back to bounded RPC windows, not a false full-history result.

**This patch does not update the existing deployment or backfill any database.**
Running `envio dev/start` or deploying a new indexer requires separate operator
authorization and, for local databases, Docker. Secret names only:
`ENVIO_API_TOKEN`, `HASURA_GRAPHQL_ADMIN_SECRET`. Do not expose an admin secret
to the public web reader or commit secret values.

For standard semantics, source provenance, trust policy, and limitations:
[docs/payee-evidence.md](../../docs/payee-evidence.md). No sponsor eligibility
or production rail coverage is claimed.
