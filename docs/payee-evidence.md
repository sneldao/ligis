# Standard-backed payee evidence

Implemented for the opt-in gate read, default off. Reputation is evidence
about a payee, **not a capability**. `SubjectResolution.capable` still means
a specific valid, non-self-issued Ligis credential.

## Public vs. private reputation — the distinction that matters

Everything this doc covers is **public reputation**: a registry entry, keyed to
an address, whose issuance history anyone can read and correlate. It answers
_"is this subject registered and credentialed?"_ — **presence**.

It does not answer _"does this subject have a proven record of keeping their
word, and can I check it without learning who they are?"_ — **history**.

The distinction is not academic. The cost of minting a capability credential
is low, so a presence-based signal degrades toward _"someone holds a key"_ as
the ecosystem grows. A history-based signal cannot be minted; it has to be
earned, one interaction at a time. The two are complementary, not competing —
and the gate wants both: **public for discovery and audit, private for the
actual accept/deny decision.** A gate that reads only public reputation can be
farmed; a gate that reads only private reputation becomes a black box.

A private, ZK-proven reputation source is researched in
[`docs/zk-reputation-evidence.md`](zk-reputation-evidence.md). **It is not
built, and nothing in this doc depends on it.**

A complementary additive path is Zcash shielded credential presentation —
proving possession of a valid Ligis credential without revealing the subject's
address — researched in
[`docs/zcash-shielded-credentials.md`](zcash-shielded-credentials.md). **It is
not built, and nothing in this doc depends on it.** The two are alternative
substrates for the same private-presentation gap, not a sequence. Zcash is the
substrate with native shielded pools and viewing keys; Stellar (Latep's chain)
is the other researched alternative and is not pursued by Ligis.

## Official sources checked on 2026-10-13

- Draft ERC-8004 specification:
  <https://eips.ethereum.org/EIPS/eip-8004> and current canonical markdown
  <https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-8004.md>.
- Official curated v2 implementation:
  <https://github.com/erc-8004/erc-8004-contracts>,
  `contracts/IdentityRegistryUpgradeable.sol` and
  `contracts/ReputationRegistryUpgradeable.sol`.
- Monad official deployment guide:
  <https://docs.monad.xyz/guides/erc-8004> (located by web search; the deployed
  addresses below match the repository's recorded testnet configuration).

The current source interfaces were read; no deployment-version or live RPC
proof is claimed for this execution. ERC-8004 remains Draft. Operators must
check deployed ABI/version and their indexer's coverage before enabling reads.

### Relevant semantics

`Registered(uint256 indexed agentId,string agentURI,address indexed owner)`.
Wallet changes use
`MetadataSet(uint256 indexed agentId,string indexed indexedMetadataKey,string metadataKey,bytes metadataValue)`.
The reserved `agentWallet` value is a **packed 20-byte address**, initially
the registering owner. `setAgentWallet` requires the new wallet's EIP-712
or ERC-1271 proof. `unsetAgentWallet` and NFT transfers clear the binding.
There is no `AgentWalletSet` event in the official implementation; that name
is an EIP-712 signed type. `ownerOf` is not a substitute for `getAgentWallet`.

`readFeedback` returns signed `int128 value`, `uint8 valueDecimals`, two
tags, and revocation. Decimals are 0–18; feedback indexes start at 1.
`endpoint`, `feedbackURI`, and `feedbackHash` are emitted by `NewFeedback`,
not stored in the `readFeedback` result. We preserve indexed references,
but do not fetch untrusted URIs or treat their contents as verified.

## Initial chain scope

Monad **testnet**, chain 10143:

- Identity: `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- Reputation: `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

`Erc8004Chain` and all indexed IDs include chain + registry. No Base,
Solana, Monad mainnet, or production coverage is claimed. No private
registry deployment is needed or performed.

## Discovery and coverage

Envio now indexes registration, wallet metadata, ownership transfer, URI
updates, reputation, revocations, and responses, alongside existing credentials.
Standard registries start just below their earliest on-chain event (Identity /
Reputation at 10,391,600 — first `Registered` log is at 10,391,697); the
credential contract keeps its later contract start block (67,367,000).
Coverage is read from the indexer's own `chain_metadata` sync cursor
(`latest_processed_block` ≥ finalized head, `start_block` ≤ the chain's
`earliestEventBlock`) — the same guarantee the retired per-block coverage
writer provided, without a per-block write (which the Envio Cloud development
plan counts as a processed event per block). Changing the indexer start block
requires keeping it at or below the web chain's `earliestEventBlock`.

The reader:

1. Checks RPC chain ID and the ReputationRegistry's `getIdentityRegistry`.
2. Reads one finalized snapshot and queries indexed historical wallet claims
   in scoped, cursor-paginated pages (default 100 rows × 5 pages).
3. Falls back to at most three 100-block RPC windows. Bundled IDs 1974/1975
   are hints, not an exhaustive address book.
4. Confirms **current** `getAgentWallet` for every candidate at that snapshot.
   Old claims and matching NFT owners cannot validate stale/cleared bindings.
5. Reads multiple bound identities, owner/operator state, clients, and feedback.
   Defaults: at most 10 candidate IDs, 20 clients per ID, 20 feedback per client.
6. Reports bounded or stale coverage. Incomplete discovery or feedback cannot
   positively establish ERC-8004 trust. Trusted negative evidence already seen
   is retained if later reads fail or time out.

On an old deployed indexer without these entities, GraphQL fails visibly
into bounded RPC fallback. **This change does not deploy or backfill it.**
An empty recent window is not proof of no global registration.

## Positive reputation policy

Trusted clients are **operator-configured independent relationships**:

- `LIGIS_ERC8004_TRUSTED_CLIENTS`: comma-separated EVM addresses; empty by default.
- `LIGIS_ERC8004_KNOWN_CONTROLLERS`: optional additional excluded addresses.
- `LIGIS_ERC8004_SCORING_WRITERS`: additional excluded Ligis scoring writers.
  The known testnet demo writer is excluded in the chain configuration.
- `LIGIS_ERC8004_TAG1`: default `delivery`.
- `LIGIS_ERC8004_TAG2`: default `quality`.

Default eligibility needs at least two trusted independent clients with
matching non-revoked delivery/quality feedback of at least 80. Values are
compared using signed WAD scaling (`8500` with 2 decimals is 85, not 8500).
A matching trusted independent score below the threshold is negative and
wins over higher scores; there is no max-score escape. An injected
`ReputationPolicy` can set another signed threshold/tag vocabulary, but
positive eligibility still requires at least two clients and complete reads.

Exclude the subject wallet, current NFT owner, known controllers, currently
approved operators (`isAuthorizedOrOwner`), and Ligis scoring writers.
`ligis.gate` / gate-preview tags never establish delivery reputation.
Self, revoked, and untrusted feedback remains in the reader's profile ledger
but is not positive eligibility. Untrusted negative spam is not automatically
authoritative either. Distinct addresses are **not Sybil resistance**;
the operator must establish independence outside this read.

Registration, metadata, reachability, revenues, and prior Ligis preview
scores cannot positively establish trust. No trusted-client configuration
means reputation alone cannot establish trust.

## Injectable settlement seam

`readSettlementEvidence` is unavailable by default: no verified production
source is wired. It does **not** infer x402 from ordinary ERC20 Transfers.

A trusted read-only `SettlementSource` must prove facilitator and payment
authorization provenance for each candidate, including the candidate's
chain/asset/payer/recipient/base-unit amount. The seam independently checks
those exact fields against internal `SettlementBinding`, transaction hash,
successful receipt, exact decoded asset transfer, finalized height, and
canonical receipt block hash. Reverts, wrong rails, other assets/recipients,
amount mismatch, and proposed-only receipts do not count.

Even proven settlement history is not independently eligible for GO. Failed
candidate matching is unknown, not an accusation. Source outage is unavailable.
At most 20 candidates are checked and truncation is disclosed.

The public payment wire has only USD, not payer/asset/chain/base-unit amounts.
**USD alone cannot establish settlement binding.** A coordinator-approved wire
extension or authenticated internal binding is needed before wiring a live
source. A facilitator URL or self-declared `verified` field is not proof.
The injected adapter must validate the protocol evidence, not trust caller JSON.

## Worker D seams and privacy

Shared `PayeeEvidence` is exported from `web/lib/payee-evidence/types.ts`.
`readPayeeEvidence` now wires the real `readNansenEvidence` by default
(`web/lib/payee-evidence/index.ts`); a caller can still inject its own reader.
Server config, all default off: `LIGIS_NANSEN_ENABLED=1`, `NANSEN_API_KEY`,
`LIGIS_PAYEE_EVIDENCE_CHAIN_ID` (the network this gate settles on), and the
operator-confirmed `LIGIS_NANSEN_MONAD_CHAIN_ID`. Without a confirmed mapping
the read answers `nansen-chain-unconfirmed`, and a payee whose intended network
is not the confirmed Monad network answers `nansen-wrong-chain` — in both cases
no provider call is made and no credits are spent. Labels stay `unknown`
provenance; Nansen positives require an explicit server policy eligibility
opt-in, and negative evidence and required-source gaps still affect
composition.

Live probe (2026-10-14, real key): the endpoint authenticates and our reader
parses real provider data — `chain: "ethereum"` on a known exchange wallet
returns `Binance` / `exchange` / `entity` labels. Empty responses cost nothing
(`"No API credits were charged for this call"`).

Nansen's Monad coverage is **mainnet**: `monad` = chain 143, live since
2025-11-24, Nansen data from 14 May 2025, and `Yes` across Smart Money
(netflow / DEX trades / holdings / historical), Token God Mode, and Profiler.
The API has **no testnet chains at all** — its chain enum is `all, arbitrum,
arc, avalanche, base, bnb, ethereum, hyperevm, hyperliquid, iotaevm, linea,
mantle, monad, optimism, plasma, polygon, robinhood, sei, solana, sonic, tron`.
So the confirmed mapping is `LIGIS_NANSEN_MONAD_CHAIN_ID=143`, and while this
gate settles on Monad Testnet 10143 the leg answers `nansen-wrong-chain` and
makes no call. Neither Pharos Atlantic nor Casper Testnet is covered either.
Mainnet labels are not evidence about a testnet payee, and that is the point of
the guard, not a bug to route around.

`runGateDecision` exposes a separate recorder with an explicit
`authenticatedOptIn` context; no public route supplies it. Previews do not
write outcomes or reputation, and verdicts are never fabricated delivery
outcomes. Before enabling logging, the coordinator must update positioning
and `/embed` privacy promises and supply authenticated consent/retention.

No signup, registration, payment, or preview mints trust.

## Reproducible unfamiliar-agent fixture

`web/test/gate-erc8004.test.ts` uses scoped ID **424242**, not bundled IDs,
on injected chain 10143:

- Payee `0x1111111111111111111111111111111111111111`.
- NFT owner `0x2222222222222222222222222222222222222222`, intentionally different.
- Discovery via injected `Registered` or `MetadataSet`.
- `getAgentWallet(424242)` confirms the payee at finalized block 5.
- Trusted clients `0x3333333333333333333333333333333333333333` and
  `0x4444444444444444444444444444444444444444`.
- Scores 8500/2 and 90/0, delivery/quality tags.

Removing the trusted set or using registration alone yields unknown.
`web/test/gate-payee-evidence.test.ts` proves successful credential absence
plus a valid mandate and Jev double yields aggregate UNKNOWN, while a
qualifying injected independent source can answer GO. The test fixture is
**not a claim that ID 424242 or those addresses are live on-chain**.

```sh
cd web
node --conditions=react-server --import tsx --test \
  test/gate-erc8004.test.ts test/gate-payee-evidence.test.ts \
  test/gate-settlements.test.ts test/gate-resolve.test.ts
```

## Limitations

- Live source checks, indexer deployment/backfill, paid Jev calls, and chain
  writes are not performed by tests.
- Casper's adapter currently masks credential-view failures as empty records.
  In evidence mode, an unheld Casper credential is conservatively unavailable
  rather than falsely claiming a successful empty read. Legacy mode is unchanged.
- Positive evidence is a snapshot; re-check credential access immediately
  before settlement where policy requires it.
- Sponsor rules and submission cutoff were not authenticated or verified;
  no bounty eligibility claim follows from this implementation.
