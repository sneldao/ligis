# @ligis/circuits-zcash

Zecathon Weeks 2–3 — **private, payee-bound credential presentation**. A Noir circuit that
proves:

> _I hold a valid, unexpired Ligis credential for capability X, issued to
> the Zcash address with hash P, it is a leaf of the CredentialRegistry tree
> with root R, and this is my one-time nullifier for (X, context)_ — without revealing the subject, the issuer,
> the credential nonce, or which leaf.

Spec source: [`docs/zcash-shielded-credentials.md`](../../docs/zcash-shielded-credentials.md)
§ Week 2 and [`docs/zecathon-entry.md`](../../docs/zecathon-entry.md) § Circuit spec.
Background: [`docs/zk-reputation-evidence.md`](../../docs/zk-reputation-evidence.md).

## Status

Compiles, `nargo test` passes, and a sample proof is generated and verified
locally with UltraHonk. `/api/gate` verifies proofs server-side via
`@ligis/circuits-zcash/verify` (`bb` + committed `src/vk.ts`) — see
[`docs/decide-api.md`](../../docs/decide-api.md) § ZK credential proofs. The
registry root is built from CredentialRegistry events by `build-root` (see
_Root_ below), served at `GET /api/zk/root`, and trusted via
`LIGIS_ZK_ROOT_MANIFEST` (or pinned in `LIGIS_ZK_TRUSTED_ROOTS`).
`pnpm demo:zcash-zk` (repo root) runs the whole flow offline.

Entry points: `.` (prover side, Poseidon/tree), `./fields` (pure field +
context-label helpers), `./verify` (`resolveBb`, `verifyMembershipProof`),
`./registry` (root builder, manifest check, holder witness, log decoding),
`./demo` (deterministic demo registry, public fixture keys), `./sample`.
After editing `main.nr`, run `pnpm write:vk` and `prove:sample -- --fixture`
(regenerates `test/fixtures/membership-proof.json` used by web tests).

## Inputs

| Kind    | Name               | Type          | Meaning                                                                                   |
| ------- | ------------------ | ------------- | ----------------------------------------------------------------------------------------- |
| public  | `registry_root`    | Field         | Poseidon Merkle root of the CredentialRegistry leaf set (depth 16, 65,536 leaves)         |
| public  | `payee_hash`       | Field         | `uint256(keccak256(lower(trim(zcash address)))) mod p` — the payee the credential is for  |
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
leaf                = H(identity_commitment, payee_hash, capability_hash, issuer, expires_at, nonce)
node                = H(left, right)            // empty leaf = 0
nullifier           = H(identity_secret, capability_hash, context)
```

**Output:** there is no explicit `eligible` field — a proof exists iff every
constraint holds (member of R, capability matches, unexpired, nullifier
correct). Verified proof ⇒ eligible.

**Not revealed:** subject EVM address, issuer, which credential/leaf, nonce,
expiry, holder secret. **Revealed by design:** `payee_hash` — the gate must
check it against the payee it is about to pay (it is a hash of an address the
gate already knows, so it leaks nothing new to the gate).

## Root

The EVM `CredentialRegistry` stores credentials in mappings and has no Merkle
root on-chain. `src/registry.ts` builds one off-chain:

1. **Events.** `CredentialIssued` / `CredentialRevoked` from the registry
   (`fetchRegistryEvents`: read-only `eth_getLogs`, chunked), sorted by
   (block, logIndex). A revoke only counts when it comes from the issuer of
   the credential.
2. **Subject → identity commitment.** The EVM subject signs (EIP-191)

   ```text
   ligis-zk-commitment:v1
   subject:<evm address, lowercase>
   zcash:<zcash address, lowercase>
   commitment:<0x Poseidon(identity_secret)>
   ```

   so the holder's commitment and payee address are attested by the subject
   the issuer credentialed. Bad signatures are dropped.

3. **Leaves.** One per unrevoked, unexpired-at-`asOf`, registered credential:
   `H(commitment, payee_hash, capability_hash, issuer, expires_at, nonce)`.
4. **Manifest.** `{ version, circuit, depth, root, asOf, leafCount, leaves,
source, skipped }`. `checkManifest` re-derives the root from the leaves;
   the gate does this on load. Holders call `witnessFromManifest` with their
   own secret + credential fields to get `(index, path)`.

```bash
# deterministic demo fixture
pnpm --filter @ligis/circuits-zcash build-root -- --demo --out web/.zk-root.json
# real registry (read-only), registrations collected from subjects
pnpm --filter @ligis/circuits-zcash build-root -- --rpc <url> --registry 0x… \
  --from-block <deploy block> --registrations regs.json --out manifest.json
```

Revocation = rebuild and republish (the revoked leaf disappears, so does the
old root's trust once the operator rotates). Open: anchoring the root
on-chain (root registry contract or issuer-signed root) instead of trusting
the operator's published manifest.

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
pnpm --filter @ligis/circuits-zcash test           # nargo test (7) + TS tests (tree, registry, e2e proof)
pnpm --filter @ligis/circuits-zcash prove:sample   # sample tree → proof → verify → tamper check
pnpm --filter @ligis/circuits-zcash prove:sample -- --nonce n1 --json /tmp/zk.json  # gate zkProof (demo holder)
pnpm --filter @ligis/circuits-zcash build-root -- --demo --out manifest.json       # publishable root manifest
pnpm --filter @ligis/circuits-zcash fetch-crs      # pre-fetch bb's CRS over https (sandboxes that block http)
pnpm --filter @ligis/circuits-zcash write:vk       # regenerate src/vk.ts
```

`circuit/Prover.toml` is the deterministic sample witness written by
`prove:sample` (public test fixtures, not real key material).
