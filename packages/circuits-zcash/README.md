# @ligis/circuits-zcash

Zecathon Week 2 — **private credential presentation**. A Noir circuit that
proves:

> _I hold a valid, unexpired Ligis credential for capability X, it is a leaf
> of the CredentialRegistry tree with root R, and this is my one-time
> nullifier for (X, context)_ — without revealing the subject, the issuer,
> the credential nonce, or which leaf.

Spec source: [`docs/zcash-shielded-credentials.md`](../../docs/zcash-shielded-credentials.md)
§ Week 2 and [`docs/zecathon-entry.md`](../../docs/zecathon-entry.md) § Circuit spec.
Background: [`docs/zk-reputation-evidence.md`](../../docs/zk-reputation-evidence.md).

## Status

Scaffold. Compiles, `nargo test` passes, and a sample proof is generated and
verified locally with UltraHonk. **Not wired into `/api/gate` or the four
signals yet**, and the registry root is computed off-chain (see _Root_ below).

## Inputs

| Kind    | Name               | Type          | Meaning                                                                                   |
| ------- | ------------------ | ------------- | ----------------------------------------------------------------------------------------- |
| public  | `registry_root`    | Field         | Poseidon Merkle root of the CredentialRegistry leaf set (depth 16, 65,536 leaves)         |
| public  | `capability_hash`  | Field         | `uint256(keccak256(capability)) mod p` — same keccak as `@ligis/core` `capabilityHash()`  |
| public  | `context`          | Field         | Presentation context (e.g. `keccak("gate:<id>:<intent>") mod p`); scopes the nullifier    |
| public  | `current_time`     | u64           | Unix seconds the gate checks expiry against                                               |
| public  | `nullifier`        | Field         | `H(identity_secret, capability_hash, context)` — gate rejects a repeat                    |
| private | `identity_secret`  | Field         | Holder secret (derived from Zcash viewing/spending key material); never leaves the prover |
| private | `issuer`           | Field         | Issuer EVM address as a field                                                             |
| private | `expires_at`       | u64           | Credential expiry; must be `> current_time`                                               |
| private | `credential_nonce` | Field         | CredentialRegistry nonce for (subject, capability)                                        |
| private | `leaf_index`       | Field         | Leaf position (decomposed to 16 path bits)                                                |
| private | `merkle_path`      | `[Field; 16]` | Sibling hashes, bottom-up                                                                 |

Hashes are Poseidon over BN254 with circomlib parameters (`noir-lang/poseidon`
v0.3.0 `bn254::hash_N` ≡ `circomlibjs` `buildPoseidon`), so the tree is
rebuilt in TS byte-for-byte:

```text
identity_commitment = H(identity_secret)
leaf                = H(identity_commitment, capability_hash, issuer, expires_at, nonce)
node                = H(left, right)            // empty leaf = 0
nullifier           = H(identity_secret, capability_hash, context)
```

**Output:** there is no explicit `eligible` field — a proof exists iff every
constraint holds (member of R, capability matches, unexpired, nullifier
correct). Verified proof ⇒ eligible.

**Not revealed:** subject address, issuer, which credential/leaf, nonce,
expiry, holder secret.

## Root

The EVM `CredentialRegistry` stores credentials in mappings and has no Merkle
root on-chain today. The intended root is built off-chain from
`CredentialIssued` / `CredentialRevoked` events (only valid, unrevoked
credentials become leaves; revocation = rebuild without the leaf) with
`CredentialTree` from this package, then anchored (a root registry contract or
signed root) so the gate can check `registry_root`. That anchoring step, and
the holder-side mapping from subject address to `identity_commitment`, are the
open Week 3 items.

## Proving system

The docs list Groth16 (Sapling) or Halo2 (Orchard) as "whichever compiles
first". This scaffold uses **Noir + Barretenberg UltraHonk** because it was the
toolchain installable and compiling locally today (no trusted setup, ~14.6 KB
proof, ~1.4 s execute+prove+verify on an M-series Mac). The statement and
public inputs are proving-system-agnostic.

## Toolchain

- `nargo` 1.0.0-beta.22 (`noirup`)
- `bb` **5.0.0-nightly.20260522** (the version `bbup` maps to nargo beta.22).
  The test/script look for `$BB_BIN`, then `~/.bb-versions/<version>/bb`, then
  `bb` on PATH, and skip the end-to-end proof if none is compatible.

## Commands

```bash
pnpm --filter @ligis/circuits-zcash build          # tsc → dist/
pnpm --filter @ligis/circuits-zcash build:circuit  # nargo compile
pnpm --filter @ligis/circuits-zcash test           # nargo test (6) + TS tests (tree + e2e proof)
pnpm --filter @ligis/circuits-zcash prove:sample   # sample tree → proof → verify → tamper/replay checks
```

`circuit/Prover.toml` is the deterministic sample witness written by
`prove:sample` (public test fixtures, not real key material).
