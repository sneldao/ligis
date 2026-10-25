// Ligis — Zecathon private credential presentation (Week 2 circuit, Week 3
// payee binding).
//
// Statement: "I hold a valid, unexpired Ligis credential for capability X,
// issued for the Zcash payee address whose hash is P, that is a leaf of the
// CredentialRegistry tree with root R, and this is my one-time nullifier for
// (X, context)" — without revealing the holder secret, issuer, credential
// nonce, expiry, or which leaf. P is public so a proof made for one payee
// cannot be presented for another.
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
/// commitment, so the public leaf set does not reveal which payees hold
/// credentials (the leaf cannot be recomputed from the address alone).
pub fn identity_commitment(identity_secret: Field) -> Field {
    bn254::hash_1([identity_secret])
}

/// leaf = H(identity_commitment, payee_hash, capability_hash, issuer, expires_at, nonce)
/// where payee_hash = keccak256(lowercased Zcash address) mod p.
pub fn credential_leaf(
    commitment: Field,
    payee_hash: Field,
    capability_hash: Field,
    issuer: Field,
    expires_at: u64,
    credential_nonce: Field,
) -> Field {
    bn254::hash_6([
        commitment,
        payee_hash,
        capability_hash,
        issuer,
        expires_at as Field,
        credential_nonce,
    ])
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
    payee_hash: pub Field,
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
        payee_hash,
        capability_hash,
        issuer,
        expires_at,
        credential_nonce,
    );
    assert(merkle_root(leaf, leaf_index, merkle_path) == registry_root, "not a registry member");
    assert(nullifier_for(identity_secret, capability_hash, context) == nullifier, "bad nullifier");
}

// ─── in-circuit tests (`nargo test`) ─────────────────────────────────────

struct Sample {
    root: Field,
    payee: Field,
    cap: Field,
    ctx: Field,
    now: u64,
    nf: Field,
    secret: Field,
    issuer: Field,
    exp: u64,
    nonce: Field,
    idx: Field,
    path: [Field; DEPTH],
}

fn sample() -> Sample {
    let secret = 0x1234;
    let payee = 0xbeef;
    let cap = 0xcafe;
    let issuer = 0xa11ce;
    let exp: u64 = 2_000_000_000;
    let nonce = 7;
    let idx = 5;
    let mut path = [0; DEPTH];
    path[0] = 0x11;
    path[1] = 0x22;
    path[2] = 0x33;
    let leaf = credential_leaf(identity_commitment(secret), payee, cap, issuer, exp, nonce);
    let ctx = 0x9a7e;
    Sample {
        root: merkle_root(leaf, idx, path),
        payee,
        cap,
        ctx,
        now: 1_800_000_000,
        nf: nullifier_for(secret, cap, ctx),
        secret,
        issuer,
        exp,
        nonce,
        idx,
        path,
    }
}

fn run(s: Sample) {
    main(
        s.root,
        s.payee,
        s.cap,
        s.ctx,
        s.now,
        s.nf,
        s.secret,
        s.issuer,
        s.exp,
        s.nonce,
        s.idx,
        s.path,
    );
}

#[test]
fn test_valid_membership() {
    run(sample());
}

#[test(should_fail_with = "credential expired")]
fn test_expired() {
    let mut s = sample();
    s.now = s.exp;
    run(s);
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_root() {
    let mut s = sample();
    s.root += 1;
    run(s);
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_payee() {
    // Week 3: a credential issued for one payee cannot be presented for another.
    let mut s = sample();
    s.payee = 0xdead;
    run(s);
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_capability() {
    let mut s = sample();
    s.cap += 1;
    s.nf = nullifier_for(s.secret, s.cap, s.ctx);
    run(s);
}

#[test(should_fail_with = "not a registry member")]
fn test_wrong_secret() {
    let mut s = sample();
    s.secret = 0x9999;
    s.nf = nullifier_for(s.secret, s.cap, s.ctx);
    run(s);
}

#[test(should_fail_with = "bad nullifier")]
fn test_nullifier_bound_to_context() {
    let mut s = sample();
    s.nf = nullifier_for(s.secret, s.cap, s.ctx + 1);
    run(s);
}
