# CredentialRegistry v2 — interface freeze (Casper)

> **Status: implemented, 2026-11-16.** This is the M1 deliverable from
> `docs/casper-forward.md`. Contract, core, adapter, and web layers are
> all live to this spec; everything else in the five-axis program commits
> to these interfaces — PolicyGuard (M2), receipts (M4), the indexer
> reads (M3), and the ZK root (M5) all read this schema.
>
> Scope: Casper (`packages/contracts-casper`). EVM registries adopt the same
> claim grammar and accreditation semantics in a later pass; the hash layer
> in `@ligis/core` is already chain-neutral so v2 claims port unchanged.

## What v2 changes, in one paragraph

A credential stops being an opaque `(subject, capability_hash)` row and
becomes a **self-describing claim**: the contract stores the canonical
claim string, recomputes its hash on-chain, and recomputes the signed
EIP-712 digest on-chain so the issuer's signature provably commits to
exactly what gets stored. On top of that sits **issuer accreditation**:
an admin accredits issuers per capability namespace, and namespaces can
be flagged _accredited-only_ so unaccredited issuance is rejected at the
contract — not documented away.

Non-goals for v2: on-chain param evaluation (PolicyGuard's job, M2),
reputation (M4), reverse discovery index (M3, indexer-side), ZK
presentation (M5). V2 only makes claims worth enforcing.

## The claim grammar (canonical form)

```
claim      := capability [ ":" param "=" value ]*
capability := segment ( "." segment )+        ; must contain ≥ 1 dot
namespace  := the FIRST segment of capability
segment    := [a-z0-9] [a-z0-9_-]*
param      := [a-z] [a-z0-9_]*
value      := [a-zA-Z0-9_+.\-]+                ; ':' and '=' not allowed
```

Canonicality rules:

1. Param keys appear **strictly ascending** (`a=1:b=2`, never `b=2:a=1`),
   unique, with at most 8 params.
2. No whitespace anywhere; lowercase segments and param keys.
3. Total length ≤ 192 bytes.

Examples: `kyc.basic` (zero params — every v1 capability name is already a
canonical claim), `rwa.accredited:jurisdiction=us`,
`agent.spend:currency=cspr:max=1000`.

The contract **validates canonical form at `issue()`** and rejects
non-canonical claims. Canonical form is what makes
`keccak256(utf8(claim))` a deterministic identity for the claim across
chains and implementations.

## Hash semantics

| Value            | Definition                   | Notes                                                                                                  |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `claim_hash`     | `keccak256(utf8(claim))`     | identical to v1 `capabilityHash` for param-free claims — **the portability invariant holds unchanged** |
| `namespace_hash` | `keccak256(utf8(namespace))` | computed on-chain from the claim; accreditation is keyed on it                                         |
| `subject`        | `[u8; 32]`                   | unchanged (Casper account hash / padded EVM address)                                                   |

Because `claim_hash` is the same function as v1's `capabilityHash`, a v1
credential for `kyc.basic` and a v2 credential for `kyc.basic` occupy the
same key space. V2 is a superset, not a fork.

## Storage schema

```rust
pub struct CredentialView {
    pub issuer: [u8; 20],
    pub subject: [u8; 32],
    pub claim: String,        // canonical claim string — NEW
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
}

pub struct AccreditationView {
    pub active: bool,
    pub granted_at: u64,
}

pub struct StandingView {
    pub issuer: [u8; 20],
    pub claim: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
    pub issuer_accredited: bool,       // read-time, not a snapshot
    pub accreditation_required: bool,  // read-time namespace policy
}
```

Module fields (order matters — indices 1 and 2 are preserved so existing
off-chain dictionary readers keep working):

```rust
issuer_nonce:         Mapping<[u8; 20], u64>                     // index 1 (unchanged)
latest:               Mapping<([u8;32],[u8;32]), CredentialView> // index 2 (value grows `claim`)
admin:                Var<Address>                               // new
issuer_accreditation: Mapping<([u8;20],[u8;32]), AccreditationView>
namespace_policy:     Mapping<[u8;32], bool>   // accreditation_required
domain_separator:     Var<[u8; 32]>            // EIP-712 domain, set post-deploy
```

Deployment is a **fresh contract package** — v1 stays live untouched.
New fields are appended after `latest` so the index-1/index-2 dictionary
read paths in `adapter-casper` remain valid.

## Entry points

### Admin (native caller-auth; admin = deployer, transferable)

```
init()                                          admin = env().caller()
set_admin(new_admin: Address)                   admin only
set_domain_separator(domain_separator: [u8;32]) admin only — called by the
                                                deploy script once the
                                                package hash is known
set_namespace_policy(namespace_hash: [u8;32],
                     required: bool)            admin only
set_issuer_accreditation(issuer: [u8;20],       admin only
                         namespace_hash: [u8;32],
                         active: bool)
```

### Issuance / revocation (signature-auth, relayer-submittable)

```
issue(issuer: [u8;20],
      subject: [u8;32],
      claim: String,                    // canonical; validated on-chain
      issued_at: u64, expires_at: u64,
      nonce: u64,
      digest: [u8;32], signature: [u8;65])

revoke(subject: [u8;32],
       claim_hash: [u8;32],
       nonce: u64,
       digest: [u8;32], signature: [u8;65])   // signature unchanged
```

`issue()` checks, in order:

1. Claim parses and is canonical; `claim_hash`, `namespace_hash` derived
   on-chain (the caller cannot supply a mismatched hash/string pair).
2. `namespace_policy[ns_hash] == true` ⇒ `issuer_accreditation[(issuer, ns_hash)].active`
   must be true (`"issuer not accredited for namespace"`).
3. `nonce == issuer_nonce[issuer]` (unchanged).
4. **Digest binding — the v2 hardening.** The contract recomputes the full
   EIP-712 digest on-chain:

   ```
   struct_hash = keccak256( TYPEHASH
                 || issuer || subject || keccak256(utf8(claim))
                 || issued_at || expires_at || nonce )
   digest      = keccak256( "\x19\x01" || domain_separator || struct_hash )
   ```

   with `TYPEHASH = keccak256("Credential(address issuer,bytes32 subject,
string claim,uint64 issuedAt,uint64 expiresAt,uint256 nonce)")`.

   `issue()` requires the supplied `digest` to equal the recomputed value,
   then recovers the signer and requires `== issuer`. In v1 the stored
   fields were never bound to the signed bytes — a relayer could replay a
   signed digest with substituted args. Nonce prevented replay; nothing
   prevented substitution. On-chain recompute closes that hole and matches
   the EVM contract's native semantics.

5. Store `CredentialView` (with `claim`), increment nonce.

`revoke()` is unchanged: the digest `keccak256(subject || claim_hash ||
nonce)` is already content-bound on-chain. (It stays the raw keccak form,
not EIP-712 — revocations are always relayered, never wallet-signed.)

### Reads

```
is_capable(subject, claim_hash) -> bool                       // unchanged semantics
is_capable_from_issuer(subject, claim_hash, issuer) -> bool   // unchanged
is_capable_accredited(subject, claim_hash) -> bool            // NEW: capable
                                                              // AND issuer currently accredited
latest_credential(subject, claim_hash) -> Option<CredentialView>
credential_standing(subject, claim_hash) -> Option<StandingView>  // NEW
is_issuer_accredited(issuer, ns_hash) -> bool                     // NEW
namespace_policy_of(ns_hash) -> bool                              // NEW
issuer_nonce_of(issuer) -> u64
claim_hash_of(claim: String) -> [u8;32]          // off-chain parity helper
compute_revoke_digest(subject, claim_hash, nonce) -> [u8;32]
```

`credential_standing` computes accreditation **at read time**: if an
issuer's accreditation is later revoked, already-issued credentials lose
their accredited standing automatically — accreditation is a property of
the issuer, not a frozen fact about the credential.

## Policy semantics, stated plainly

- **Open namespaces (default):** `accreditation_required = false`. Anyone
  issues; `credential_standing` still reports whether the issuer happened
  to be accredited. Migration-friendly: every v1 flow works unchanged.
- **Accredited-only namespaces:** `issue()` reverts for unaccredited
  issuers. Intended for `rwa.*`, `kyc.*` once real issuers exist.
- **Who administers:** one `admin` account (the deployer), transferable
  via `set_admin`. Deliberately minimal — no committee, no DAO. A root
  that can accredit is governance enough for v2; `docs/casper-forward.md`
  §Risks carries the reasoning.
- **`is_capable` semantics are unchanged.** Accreditation is additive
  signal via `credential_standing` / `is_capable_accredited`; consumers
  choose their bar. PolicyGuard (M2) is where a _required_ standing gets
  enforced per-integrator.

## Off-chain changes implied

- `@ligis/core` → new `src/claim.ts`: `parseClaim`, `canonicalizeClaim`,
  `namespaceOf`, `claimHash` (alias of `capabilityHash` semantics),
  `namespaceHash`. `capabilityHash`/`parseCapability` keep working —
  a bare name is a canonical claim.
- `adapter-casper/eip712.ts` → `Credential` type gains `claim: string`;
  `capabilityHash` field is dropped from the signed struct (derivable).
- `adapter-casper/operations.ts` → `issue` passes `claim`;
  `parseCredentialViewBytes` reads the variable-length `claim` field;
  new ops for admin entry points and `credential_standing`.
- `web/lib/chain-casper.ts` → surfaces standing/accreditation on the
  existing reads.
- Deploy script → `init` (admin = deployer), then
  `set_domain_separator` computed from the new package hash.

## Migration posture

Fresh package, no state carried over. V1 credentials on the old package
remain readable; v2 becomes the address in `LIGIS_CASPER_CREDENTIAL_REGISTRY`.
Because hash space is shared, an agent's `kyc.basic` issued on v2 satisfies
any consumer checking the same claim hash — including the unchanged EVM
registries, which is the portability story continuing to hold.

## What this deliberately does not do

- Does not parse or evaluate claim _params_ on-chain — `is_capable` is
  still an exact-hash lookup. Param-aware enforcement is PolicyGuard's
  job (M2), reading params from the stored claim string or off-chain.
- Does not decentralize issuance governance (single admin, documented).
- Does not emit events — Casper has none; the indexer (M3) reconstructs
  history from `issue`/`revoke` transactions as it does today.
