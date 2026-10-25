// Ligis — Zecathon Week 2: private credential presentation.
//
// Statement: "I hold a valid, unexpired Ligis credential for capability X
// that is a leaf of the CredentialRegistry tree with root R, and this is my
// one-time nullifier for (X, context)" — without revealing the subject,
// issuer, credential nonce, or which leaf.
//
// Hash: Poseidon over BN254 (circomlib-compatible parameters), so the tree can
// be rebuilt off-chain in TS (circomlibjs) from CredentialRegistry events.
//
// A proof exists iff the holder is eligible; there is no separate `eligible`
// output (a failing constraint means no proof can be produced).
use poseidon::poseidon::bn254;

/// Tree depth: 2^16 = 65,536 credential leaves.
global DEPTH: u32 = 16;

/// identity_commitment = H(identity_secret). The registry tree stores this
/// commitment instead of the subject address.
pub fn identity_commitment(identity_secret: Field) -> Field {
    bn254::hash_1([identity_secret])
}

/// leaf = H(identity_commitment, capability_hash, issuer, expires_at, nonce)
pub fn credential_leaf(
    commitment: Field,
    capability_hash: Field,
    issuer: Field,
    expires_at: u64,
    credential_nonce: Field,
) -> Field {
    bn254::hash_5(
        [commitment, capability_hash, issuer, expires_at as Field, credential_nonce],
    )
}

/// nullifier = H(identity_secret, capability_hash, context): one per
/// (holder, capability, context). The gate rejects a nullifier it has seen.
pub fn nullifier_for(identity_secret: Field, capability_hash: Field, context: Field) -> Field {
    bn254::hash_3([identity_secret, capability_hash, context])
}

/// Recompute the Merkle root from a leaf, its index, and sibling path.
pub fn merkle_root<let N: u32>(leaf: Field, leaf_index: Field, path: [Field; N]) -> Field {
    let bits: [bool; N] = leaf_index.to_le_bits();
    let mut node = leaf;
    for i in 0..N {
        let (left, right) = if bits[i] {
            (path[i], node)
        } else {
            (node, path[i])
        };
        node = bn254::hash_2([left, right]);
    }
    node
}

fn main(
    // ── public ──────────────────────────────────────────────────────────
    registry_root: pub Field,
    capability_hash: pub Field,
    context: pub Field,
    current_time: pub u64,
    nullifier: pub Field,
    // ── private ─────────────────────────────────────────────────────────
    identity_secret: Field,
    issuer: Field,
    expires_at: u64,
    credential_nonce: Field,
    leaf_index: Field,
    merkle_path: [Field; DEPTH],
) {
    assert(identity_secret != 0, "identity secret must be non-zero");
    assert(issuer != 0, "issuer must be non-zero");
    assert(expires_at > current_time, "credential expired");

    let commitment = identity_commitment(identity_secret);
    let leaf = credential_leaf(
        commitment,
        capability_hash,
        issuer,
        expires_at,
        credential_nonce,
    );
    assert(merkle_root(leaf, leaf_index, merkle_path) == registry_root, "not a registry member");
    assert(nullifier_for(identity_secret, capability_hash, context) == nullifier, "bad nullifier");
}

// ─── in-circuit tests (`nargo test`) ─────────────────────────────────────

fn sample() -> (Field, Field, Field, u64, Field, Field, Field, u64, Field, Field, [Field; DEPTH]) {
    let secret = 0x1234;
    let cap = 0xcafe;
    let issuer = 0xa11ce;
    let expires_at: u64 = 2_000_000_000;
    let nonce = 7;
    let index = 5;
    let mut path = [0; DEPTH];
    path[0] = 0x11;
    path[1] = 0x22;
    path[2] = 0x33;
    let leaf = credential_leaf(identity_commitment(secret), cap, issuer, expires_at, nonce);
    let root = merkle_root(leaf, index, path);
    let ctx = 0x9a7e;
    (
        root, cap, ctx, 1_800_000_000, nullifier_for(secret, cap, ctx), secret, issuer, expires_at,
        nonce, index, path,
    )
}

#[test]
fn test_valid_membership() {
    let (root, cap, ctx, now, nf, secret, issuer, exp, nonce, idx, path) = sample();
    main(
        root,
        cap,
        ctx,
        now,
        nf,
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}

#[test(should_fail_with = "credential expired")]
fn test_expired() {
    let (root, cap, ctx, _now, nf, secret, issuer, exp, nonce, idx, path) = sample();
    main(
        root,
        cap,
        ctx,
        exp,
        nf,
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_root() {
    let (root, cap, ctx, now, nf, secret, issuer, exp, nonce, idx, path) = sample();
    main(
        root + 1,
        cap,
        ctx,
        now,
        nf,
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_capability() {
    let (root, cap, ctx, now, _nf, secret, issuer, exp, nonce, idx, path) = sample();
    let nf = nullifier_for(secret, cap + 1, ctx);
    main(
        root,
        cap + 1,
        ctx,
        now,
        nf,
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_secret() {
    let (root, cap, ctx, now, _nf, _secret, issuer, exp, nonce, idx, path) = sample();
    let other = 0x9999;
    main(
        root,
        cap,
        ctx,
        now,
        nullifier_for(other, cap, ctx),
        other,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}

#[test(should_fail_with = "bad nullifier")]
fn test_nullifier_bound_to_context() {
    let (root, cap, ctx, now, _nf, secret, issuer, exp, nonce, idx, path) = sample();
    let replayed = nullifier_for(secret, cap, ctx + 1);
    main(
        root,
        cap,
        ctx,
        now,
        replayed,
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    );
}
