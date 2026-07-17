# Solving the Chicken-and-Egg Problem in Agent Commerce

*How we built a trust layer for AI agents on CROO, Casper, and Pharos — and what we learned along the way.*

---

## The problem

AI agents are getting good at doing things. They can swap tokens, move funds, execute trades, and interact with smart contracts. But before your agent sends $5,000 to an escrow agent it's never met, it needs to answer one question: **should I trust this counterparty?**

Today, there's no good answer. Agent-to-agent commerce has a chicken-and-egg problem:

- Agents won't transact with strangers (no trust)
- Agents can't build reputation without transacting (no history)
- Agents can't get credentials without being hired (no verification)
- Agents won't be hired without credentials (no trust)

The result: every agent starts at zero trust, and there's no path to earn it.

## The thesis

We think the answer is **portable, on-chain credentials** — not reputation scores, not reviews, but cryptographic attestations that any agent or contract can verify in a single read.

If agent A holds a verifiable credential proving it's KYC'd, authorized to handle escrow, and has been active for 30+ days, then agent B can make an informed trust decision before sending it money. The credential is signed by an issuer, stored on-chain, and verifiable by anyone.

This isn't a new idea — EIP-712 typed data and on-chain registries have been around for a while. What's new is the marketplace layer: **CROO** lets agents hire other agents to perform services, which means "verify this counterparty" and "issue me a credential" can be paid, autonomous transactions.

## What we built

[Ligis](https://github.com/sneldao/ligis) is a trust layer for agent-to-agent commerce. It provides three services on the CROO Agent Store:

### 1. `ligis.issue` — Credential Issuance ($1.00)

Ligis signs an EIP-712 attestation and submits it on-chain to a `CredentialRegistry` smart contract on Casper (or Pharos). The credential includes:

- **Subject** — the agent receiving the credential
- **Capability** — what the credential proves (e.g. `kyc.basic`, `agent.commerce.escrow`)
- **Issuer** — the Ligis signing key
- **Issued at / expires at** — timestamped validity window
- **Nonce + digest + signature** — EIP-712 replay-safe signing

Once on-chain, the credential is publicly verifiable by any agent or contract via a single `isCapable(subject, capabilityHash)` read.

### 2. `ligis.verify` — Credential Verification ($0.50)

A bare on-chain check: does this subject hold a valid credential for this capability? Returns `capable: true/false` plus the credential details (issuer, issuance time, expiry).

### 3. `ligis.risk` — Counterparty Risk Check ($0.75)

The full product. Checks one or more capabilities and returns:

- **Overall verdict:** `pass` / `warn` / `fail`
- **Risk score:** 0–100 (higher is safer)
- **Per-capability breakdown:** capable, TTL, credential age, issuer, sub-score
- **Component scores:** capability coverage, TTL health, credential maturity, issuer diversity
- **Signals:** machine-readable flags like `credential-immature`, `ttl-comfortable`, `missing-required`

The verdict logic:
- **pass** — all capabilities held, all TTLs healthy, all credentials mature (>7 days)
- **warn** — all capabilities held but some have warnings (immature, short TTL, low diversity)
- **fail** — one or more required capabilities missing

### The full loop

The demo that proves the thesis:

1. An agent with no credentials gets `fail` (score 0) from `ligis.risk`
2. The agent hires `ligis.issue` to get a `kyc.basic` credential — Ligis signs and submits on-chain
3. Now `ligis.verify` returns `capable: true`
4. And `ligis.risk` returns `warn` (score 60) — the credential is valid but immature (issued <7 days ago)
5. After 7 days, `ligis.risk` returns `pass` (score 100)

From `fail` to `pass` in three paid calls. The chicken-and-egg problem is solved.

## The architecture

```
┌─────────────┐     hire     ┌─────────────┐     read/write    ┌──────────────────┐
│  Agent B    │ ──────────► │   Ligis     │ ────────────────► │  CredentialRegistry  │
│  (requester)│ ◄────────── │  (provider)  │ ◄──────────────── │  (on-chain)      │
└─────────────┘  deliverable └─────────────┘   query results   └──────────────────┘
      │                                                                          │
      │ CROO protocol                                                            │
      │ (negotiate → pay → deliver)                                              │
      │                                                                          │
      ▼                                                                          ▼
┌─────────────┐                                                          ┌──────────────────┐
│  Agent A    │ ◄──────── verifyCapability(subject, capability) ──────── │  Casper / Pharos │
│  (subject)  │                                                          │  Testnet         │
└─────────────┘                                                          └──────────────────┘
```

**CROO** is the marketplace — agents negotiate, pay, and receive deliverables through the CROO Agent Protocol (CAP). Ligis is a CAP provider: it listens for negotiation events via WebSocket, accepts orders, executes on-chain reads/writes, and delivers JSON results.

**Casper** is the trust ledger — the `CredentialRegistry` contract stores credentials and exposes `isCapable` for verification. Casper was chosen because it's a hackathon partner and has a mature smart contract platform with secp256k1 support.

**Pharos** provides cross-chain portability — the same `capabilityHash("kyc.basic")` produces an identical 32-byte hash on both chains. An agent credentialed on Casper can be verified on Pharos without re-issuance.

**EIP-712** is the signing standard — credentials are typed, structured data signed with secp256k1. The digest includes a nonce for replay protection and a domain separator for chain isolation.

### Chain-agnostic by design

Each chain is a `ChainAdapter` implementation behind a common interface:

```typescript
interface ChainAdapter {
  signCredential(opts): Promise<SignedCredential>;
  submitCredential(signed): Promise<{ tx }>;
  verifyCapability(opts): Promise<VerificationResult>;
  revokeCredential(opts): Promise<{ tx }>;
}
```

Adding a chain is an adapter implementation, not a redesign. The EIP-712 capability hashes are computed from the capability name (not the chain), so they're deterministic across chains. Next targets: Base and Optimism (EVM L2s where agent activity is highest).

## The build: what we learned

Building this taught us a lot about the rough edges in the current agent commerce stack. Here's what we hit:

### CROO: great protocol, rough SDK

The CROO Agent Protocol is well-designed — negotiate, pay, deliver is a clean flow. But the SDK has some sharp edges:

1. **Requirements envelope wrapping.** CROO wraps buyer requirements in a `{ text: "..." }` or `{ deliverableText: "..." }` envelope. The wrapper key varies. We had to write a generic unwrapper that detects any single-key JSON string envelope and unwraps it. This should be handled by the SDK, not by every provider.

2. **Sparse WebSocket events.** The `order_paid` event only contains `order_id` and `negotiation_id` — not the full requirements. The provider has to fetch negotiation details from the API separately. This is an extra round-trip on every order. Including the requirements (or a reference to them) in the event would simplify provider implementations.

3. **Deliverable schema validation.** CROO validates deliverables against a schema you configure in the Dashboard. If your deliverable doesn't match exactly, you get `INVALID_DELIVERABLE` with a field-level error. This is good, but the schema configuration is manual — there's no way to infer it from your handler output. We had to iterate: submit, get rejected, read the error, update the schema, repeat. Auto-generating the schema from the first successful deliverable would save a lot of time.

4. **Service ID mapping.** CROO sends listing UUIDs as `service_id` in WebSocket events, not service names. The provider has to maintain a mapping (`CROO_SERVICE_ID_LIGIS_RISK=<uuid>`) in env vars. This is fine, but it's a manual step that's easy to forget — if you don't set the UUID, the provider silently ignores the negotiation.

### Casper: solid chain, painful tooling

Casper's smart contract model is mature (Odra framework, WASM contracts, secp256k1 keys), but the developer tooling has gaps:

1. **casper-js-sdk serialization is broken in Node.js CJS.** The SDK's `toBytes()` method fails on `TransactionTarget`, `StoredTarget`, and `ByPackageHashInvocationTarget` with `Cannot read properties of undefined (reading 'toBytes')`. This appears to be a typed-json metadata issue in the CJS build. We had to fall back to the `casper-client` Rust CLI for transaction submission, which means installing Rust + compiling from source on the server. The SDK works fine for reads (RPC calls) — it's specifically the transaction serialization that's broken.

2. **No pre-built casper-client binary.** The `casper-client` Rust CLI doesn't ship pre-built binaries for Linux x86_64. You have to install Rust, install OpenSSL dev libs, and `cargo install casper-client` (2-3 minute compile). On a production VPS, this is a friction point. Pre-built binaries in GitHub releases would help a lot.

3. **Address format mismatch.** Casper uses `account-hash-...` (32-byte blake2b of the public key), but our EIP-712 credentials use EVM-style `0x...` addresses (20 bytes). The `CredentialRegistry` contract expects `bytes32` for the subject field, so we had to left-pad EVM addresses to 32 bytes. This is a cross-chain interoperability issue that any project bridging Casper and EVM chains will hit.

4. **No event logs.** Casper doesn't have EVM-style event logs. To reconstruct issuer activity (who issued what, when), you have to scan recent blocks for `issue`/`revoke` transactions and parse the execution effects. This is doable but significantly more expensive than subscribing to events on an EVM chain.

### EIP-712 + secp256k1: works, but cross-chain domain separation is manual

EIP-712 typed data signing with secp256k1 works well, but the domain separator must include the chain ID to prevent replay attacks across chains. We use a custom domain that includes the chain name and contract address, which means the same credential signed for Casper won't verify on Pharos (different domain separator). This is correct behavior, but it means "portability" is really "re-issuance with the same capability hash" rather than "the same signature verifies everywhere."

### Provider robustness: the unglamorous 80%

The fun part is the on-chain logic. The unglamorous part is making the provider not crash at 3am:

- **Idempotency** — SQLite store keyed by order ID. If the provider crashes mid-delivery, it retries without double-delivering.
- **Retry with backoff** — 3 delivery attempts before giving up. CROO's API has occasional 500s.
- **Health endpoint** — HTTP server on localhost:9430 returning uptime, delivered count, errors, WebSocket status, in-flight orders.
- **In-flight tracking** — know what orders are being processed at any moment.
- **Prune timer** — clean up old idempotency records hourly so the DB doesn't grow forever.
- **Negotiation caching** — fetch full negotiation details from the API and cache them, so we don't re-fetch on every retry.

This is the 80% of the work that nobody sees but that makes the difference between a demo and a service that runs 24/7.

## Advice for other builders

1. **Start with the provider robustness.** The on-chain logic is the interesting part, but the provider is what actually runs in production. Build idempotency, retries, and health checks from day one — not as an afterthought.

2. **Test the full loop end-to-end.** We tested `ligis.issue` in isolation and it worked. But the deliverable was rejected by CROO because the `capability` field was missing (the signing function didn't return it, only the hash). The bug only surfaced when we ran the full issue → deliver → verify cycle. Test the whole loop, not just your handler.

3. **Unwrap CROO requirements early.** CROO wraps requirements in envelopes. Write a generic unwrapper that handles any single-key JSON string envelope, and call it before parsing. Don't assume the wrapper key — it changes.

4. **Don't trust the SDK serialization.** If you're building on Casper, test `toBytes()` on your transaction types before relying on it. The CLI fallback is reliable but requires installing Rust on your server.

5. **Be honest about your trust model.** Self-issued credentials are fine for a demo, but they don't solve the real problem. The value of a credential comes from the issuer's reputation, not the signature. Plan your aggregation strategy before you launch.

6. **Document your API before you share it.** We almost shared the project without API docs. An external developer can't integrate without knowing the input/output schemas, even if the code is open source.

## What's next

### Aggregation issuance (the real product)

Today, `ligis.issue` signs credentials with Ligis's own key. A `kyc.basic` credential from Ligis proves "Ligis said this address has KYC" — but Ligis didn't actually do any KYC. This is fine for a demo, but not for production trust.

The real product is **aggregation issuance**: Ligis bridges external verifiers (Self Protocol, World ID, EAS) into unified on-chain credentials. Instead of "Ligis said you have KYC," it becomes "Self Protocol verified your identity, and Ligis bridged that verification on-chain." The credential is trustworthy because the *upstream* verifier is trustworthy.

This is the difference between a demo and a product. It's the next thing we're building.

### Chain expansion

Currently on Casper Testnet and Pharos Atlantic Testnet. The architecture is chain-agnostic — adding Base and Optimism (EVM L2s) is an adapter implementation. The capability hashes are already deterministic cross-chain.

### Mainnet

When the aggregation issuance is working and we have a second issuer, we'll deploy on mainnet. Testnet is fine for hackathons; production agents transacting real value need mainnet.

### A second issuer

Running a second issuer key (even our own, with a different identity) would make the `issuerDiversity` signal meaningful. Today, every credential comes from one key, so diversity is always 1.0 or 0. A small ecosystem of issuers makes the risk score more interesting.

## Links

- **GitHub:** [github.com/sneldao/ligis](https://github.com/sneldao/ligis)
- **API docs:** [docs/api.md](https://github.com/sneldao/ligis/blob/main/docs/api.md)
- **Website:** [ligis.vercel.app](https://ligis.vercel.app)
- **CROO Agent Store:** [agent.croo.network](https://agent.croo.network)

---

*Ligis is MIT-licensed and open source. We built it for the CROO Hackathon and Casper Agentic Buildathon. Feedback welcome — especially on the trust model and which aggregation integrations to prioritize.*
