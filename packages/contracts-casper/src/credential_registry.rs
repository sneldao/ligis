//! CredentialRegistry — EIP-712 capability credentials on Casper (v2).
//!
//! Casper port of `CredentialRegistry.sol`, upgraded to the v2 interface in
//! `docs/credential-registry-v2.md`. Stores the *latest* signed credential
//! per `(subject, claim_hash)` pair, where the claim is a canonical,
//! parameterized capability string (e.g. `rwa.accredited:jurisdiction=us`).
//!
//! v2 changes over the original port:
//!
//!   - Credentials are self-describing: the canonical `claim` string is
//!     stored and validated on-chain; `claim_hash` is derived in-contract
//!     (a relayer cannot submit a mismatched claim/hash pair).
//!   - Digest binding: `issue` recomputes the full EIP-712 digest on-chain
//!     (typehash over the claim string + stored fields, domain separator
//!     set by the admin post-deploy). In v1 the supplied digest was never
//!     checked against the stored fields — a relayer could replay an
//!     issuer's signature with substituted args. Now the signature
//!     provably commits to what is stored, matching EVM semantics.
//!   - Issuer accreditation: an admin accredits `(issuer, namespace)`;
//!     namespaces flagged `accreditation_required` reject unaccredited
//!     issuers at `issue()`. Accreditation is evaluated at READ time in
//!     `credential_standing` / `is_capable_accredited`, so revoking an
//!     issuer's accreditation withdraws standing from existing creds.
//!
//! The signature format remains the EVM-style 65-byte envelope
//! (r || s || v). `revoke` keeps its existing raw-keccak digest binding
//! (subject || claim_hash || nonce) — revocations are relayered, never
//! wallet-signed.

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use odra::prelude::*;
use sha3::{Digest, Keccak256};

// ---------- claim grammar (mirrors packages/core/src/claim.ts) ----------

const MAX_CLAIM_LEN: usize = 192;
const MAX_CLAIM_PARAMS: usize = 8;

fn valid_seg_char(b: u8) -> bool {
    matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-')
}
fn valid_seg_start(b: u8) -> bool {
    matches!(b, b'a'..=b'z' | b'0'..=b'9')
}
fn valid_param_key(b: u8, first: bool) -> bool {
    if first {
        matches!(b, b'a'..=b'z')
    } else {
        matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_')
    }
}
fn valid_param_val(b: u8) -> bool {
    matches!(b, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'+' | b'.' | b'-')
}

/// Validate a canonical claim. Returns `(capability_end, namespace_end)`
/// — the byte offsets of the first ':' (or end) and the first '.'.
fn parse_claim(claim: &str) -> Option<(usize, usize)> {
    let bytes = claim.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_CLAIM_LEN {
        return None;
    }
    let cap_end = bytes.iter().position(|&b| b == b':').unwrap_or(bytes.len());
    let cap = &bytes[..cap_end];

    // capability: ≥ 2 dot-separated segments, each [a-z0-9][a-z0-9_-]*
    let mut ns_end = 0usize;
    let mut count = 0usize;
    let mut start = 0usize;
    for i in 0..=cap.len() {
        if i == cap.len() || cap[i] == b'.' {
            let seg = &cap[start..i];
            if seg.is_empty()
                || !valid_seg_start(seg[0])
                || !seg.iter().all(|&b| valid_seg_char(b))
            {
                return None;
            }
            if count == 0 {
                ns_end = i;
            }
            count += 1;
            start = i + 1;
        }
    }
    if count < 2 {
        return None;
    }

    // params: key=value tokens, strictly ascending unique keys, ≤ 8
    if cap_end < bytes.len() {
        let mut prev_key: Option<&[u8]> = None;
        let mut n = 0usize;
        for tok in claim[cap_end + 1..].split(':') {
            n += 1;
            if n > MAX_CLAIM_PARAMS {
                return None;
            }
            let eq = tok.find('=')?;
            let key = &tok.as_bytes()[..eq];
            let val = &tok.as_bytes()[eq + 1..];
            if key.is_empty()
                || !key
                    .iter()
                    .enumerate()
                    .all(|(i, &b)| valid_param_key(b, i == 0))
            {
                return None;
            }
            if val.is_empty() || !val.iter().all(|&b| valid_param_val(b)) {
                return None;
            }
            if let Some(p) = prev_key {
                if key <= p {
                    return None; // out of order or duplicate
                }
            }
            prev_key = Some(key);
        }
    }
    Some((cap_end, ns_end))
}

fn keccak(bytes: &[u8]) -> [u8; 32] {
    Keccak256::digest(bytes).into()
}

fn u256_be(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

// ---------- types ----------

#[odra::odra_type]
pub struct CredentialView {
    pub issuer: [u8; 20],
    pub subject: [u8; 32],
    pub claim: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
}

#[odra::odra_type]
pub struct AccreditationView {
    pub active: bool,
    pub granted_at: u64,
}

#[odra::odra_type]
pub struct StandingView {
    pub issuer: [u8; 20],
    pub claim: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
    /// Read-time: is the credential's issuer currently accredited for the
    /// claim's namespace? Not a snapshot — revoking accreditation withdraws
    /// standing from existing credentials.
    pub issuer_accredited: bool,
    /// Read-time: does the claim's namespace require accreditation to issue?
    pub accreditation_required: bool,
}

#[odra::module]
pub struct CredentialRegistry {
    /// Per-issuer nonce, incremented on every successful `issue`. (index 1)
    issuer_nonce: Mapping<[u8; 20], u64>,
    /// Stored credentials keyed by `(subject, claim_hash)` → CredentialView.
    /// (index 2 — preserved for existing off-chain dictionary readers)
    latest: Mapping<([u8; 32], [u8; 32]), CredentialView>,
    /// Administrator (native Casper account) for accreditation + policy ops.
    admin: Var<Address>,
    /// (issuer, namespace_hash) → accreditation record.
    issuer_accreditation: Mapping<([u8; 20], [u8; 32]), AccreditationView>,
    /// namespace_hash → accreditation_required flag.
    namespace_policy: Mapping<[u8; 32], bool>,
    /// EIP-712 domain separator for this deployment (set post-deploy by the
    /// admin, since it commits to the contract package hash).
    domain_separator: Var<[u8; 32]>,
}

/// Recover the 20-byte Ethereum-style issuer address from an EIP-712 digest
/// and a 65-byte EVM-style signature.
fn recover_issuer(digest: [u8; 32], signature: [u8; 65]) -> Option<[u8; 20]> {
    // EVM v = 27/28 → recovery id 0/1. EIP-2098 compact signatures encode
    // the recovery bit in the high bit of `s`, which produces `v` values
    // 0/1 folded into our 64-byte signature. We fall back to deriving the
    // recovery id from the high bit of `s` when v is 0/1.
    let recid_byte = match signature[64] {
        27 => 0u8,
        28 => 1u8,
        0 | 1 => signature[64],
        _ => return None,
    };
    let recid = RecoveryId::try_from(recid_byte).ok()?;

    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&signature[..64]);
    let sig = Signature::from_bytes((&sig_bytes).into()).ok()?;

    let vk = VerifyingKey::recover_from_prehash(&digest, &sig, recid).ok()?;
    let point = vk.to_encoded_point(false);
    let pk_bytes = point.as_bytes();
    if pk_bytes.len() != 65 || pk_bytes[0] != 0x04 {
        return None;
    }

    let hash = Keccak256::digest(&pk_bytes[1..]);
    let mut issuer = [0u8; 20];
    issuer.copy_from_slice(&hash[12..]);
    Some(issuer)
}

/// Keccak-256 of (subject || claim_hash || nonce_be) — the canonical
/// digest the contract binds to a revoke signature. Mirrors the
/// `make_revoke_digest` helper in `test_helpers` and the off-chain
/// `buildRevokeDigest` in `packages/adapter-casper/src/eip712.ts`.
fn keccak_revoke_digest(
    subject: [u8; 32],
    claim_hash: [u8; 32],
    nonce: u64,
) -> [u8; 32] {
    let mut buf = [0u8; 72];
    buf[..32].copy_from_slice(&subject);
    buf[32..64].copy_from_slice(&claim_hash);
    buf[64..72].copy_from_slice(&nonce.to_be_bytes());
    keccak(&buf)
}

/// Recompute the EIP-712 `Credential` digest the contract binds to an
/// issue signature — the v2 hardening that makes the signature provably
/// commit to the stored fields.
///
///   TYPEHASH = keccak256("Credential(address issuer,bytes32 subject,
///     string claim,uint64 issuedAt,uint64 expiresAt,uint256 nonce)")
///   struct_hash = keccak256(TYPEHASH || issuer || subject ||
///     keccak256(utf8(claim)) || issued_at || expires_at || nonce)
///   digest = keccak256("\x19\x01" || domain_separator || struct_hash)
fn eip712_credential_digest(
    domain_separator: [u8; 32],
    issuer: [u8; 20],
    subject: [u8; 32],
    claim: &str,
    issued_at: u64,
    expires_at: u64,
    nonce: u64,
) -> [u8; 32] {
    let typehash = keccak(
        b"Credential(address issuer,bytes32 subject,string claim,uint64 issuedAt,uint64 expiresAt,uint256 nonce)",
    );
    let mut sh = Vec::with_capacity(32 * 7);
    sh.extend_from_slice(&typehash);
    sh.extend_from_slice(&[0u8; 12]);
    sh.extend_from_slice(&issuer); // address → 32B left-padded
    sh.extend_from_slice(&subject);
    sh.extend_from_slice(&keccak(claim.as_bytes())); // string → keccak
    sh.extend_from_slice(&u256_be(issued_at));
    sh.extend_from_slice(&u256_be(expires_at));
    sh.extend_from_slice(&u256_be(nonce));
    let struct_hash = keccak(&sh);

    let mut d = Vec::with_capacity(66);
    d.extend_from_slice(b"\x19\x01");
    d.extend_from_slice(&domain_separator);
    d.extend_from_slice(&struct_hash);
    keccak(&d)
}

#[odra::module]
impl CredentialRegistry {
    /// Deploy-time init: the deployer becomes the admin. The EIP-712 domain
    /// separator is set afterwards via `set_domain_separator` because it
    /// commits to the contract package hash, unknown until deployed.
    pub fn init(&mut self) {
        self.admin.set(self.env().caller());
    }

    // ---------- admin (native caller-auth) ----------

    fn require_admin(&self) {
        let admin = self.admin.get().unwrap_or_revert(&self.env());
        assert_eq!(
            self.env().caller(),
            admin,
            "CredentialRegistry: caller is not admin"
        );
    }

    /// Transfer admin to a new account.
    pub fn set_admin(&mut self, new_admin: Address) {
        self.require_admin();
        self.admin.set(new_admin);
    }

    /// Set the EIP-712 domain separator for this deployment.
    pub fn set_domain_separator(&mut self, domain_separator: [u8; 32]) {
        self.require_admin();
        self.domain_separator.set(domain_separator);
    }

    /// Flag a namespace as requiring (or not requiring) issuer
    /// accreditation for `issue()`.
    pub fn set_namespace_policy(&mut self, namespace_hash: [u8; 32], required: bool) {
        self.require_admin();
        self.namespace_policy.set(&namespace_hash, required);
    }

    /// Grant or revoke an issuer's accreditation for a namespace.
    pub fn set_issuer_accreditation(
        &mut self,
        issuer: [u8; 20],
        namespace_hash: [u8; 32],
        active: bool,
    ) {
        self.require_admin();
        self.issuer_accreditation.set(
            &(issuer, namespace_hash),
            AccreditationView {
                active,
                granted_at: self.env().get_block_time(),
            },
        );
    }

    pub fn admin(&self) -> Option<Address> {
        self.admin.get()
    }

    // ---------- issuance / revocation ----------

    /// Issue a credential. The caller acts as a relayer; authorization
    /// comes from a secp256k1 signature over the EIP-712 digest, which the
    /// contract recomputes on-chain so the signature provably binds the
    /// stored claim and fields. Replays are prevented by the per-issuer
    /// nonce; unaccredited issuers are rejected in accredited-only
    /// namespaces.
    pub fn issue(
        &mut self,
        issuer: [u8; 20],
        subject: [u8; 32],
        claim: String,
        issued_at: u64,
        expires_at: u64,
        nonce: u64,
        digest: [u8; 32],
        signature: [u8; 65],
    ) {
        // 1. Validate the canonical claim; derive hashes on-chain.
        let (_, ns_end) =
            parse_claim(&claim).unwrap_or_revert(&self.env());
        let claim_hash = keccak(claim.as_bytes());
        let namespace_hash = keccak(&claim.as_bytes()[..ns_end]);

        // 2. Namespace accreditation gate.
        if self
            .namespace_policy
            .get(&namespace_hash)
            .unwrap_or(false)
        {
            let accredited = self
                .issuer_accreditation
                .get(&(issuer, namespace_hash))
                .map(|a| a.active)
                .unwrap_or(false);
            assert!(
                accredited,
                "CredentialRegistry::issue: issuer not accredited for namespace"
            );
        }

        // 3. Nonce.
        let current_nonce = self.issuer_nonce.get(&issuer).unwrap_or(0);
        assert_eq!(current_nonce, nonce, "CredentialRegistry::issue: bad nonce");

        // 4. Digest binding + signature.
        let domain = self
            .domain_separator
            .get()
            .unwrap_or_revert(&self.env());
        let expected = eip712_credential_digest(
            domain, issuer, subject, &claim, issued_at, expires_at, nonce,
        );
        assert_eq!(
            digest, expected,
            "CredentialRegistry::issue: digest does not bind credential fields"
        );
        let recovered = recover_issuer(digest, signature)
            .unwrap_or_revert(&self.env());
        assert_eq!(
            recovered, issuer,
            "CredentialRegistry::issue: signature does not match issuer"
        );

        // 5. Store.
        self.latest.set(
            &(subject, claim_hash),
            CredentialView {
                issuer,
                subject,
                claim,
                issued_at,
                expires_at,
                revoked: false,
                valid: true,
            },
        );
        self.issuer_nonce.set(&issuer, current_nonce + 1);
    }

    /// Revoke a credential. Only the original issuer can revoke.
    /// Authorization comes from a valid secp256k1 signature over the
    /// supplied digest; the recovered signer must match the stored
    /// credential issuer. The nonce is bound into the digest so signature
    /// replay across nonces is impossible.
    pub fn revoke(
        &mut self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
        nonce: u64,
        digest: [u8; 32],
        signature: [u8; 65],
    ) {
        let mut view = self
            .latest
            .get(&(subject, claim_hash))
            .unwrap_or_revert(&self.env());

        // Bind the nonce into the recovered-message check. The digest that
        // the client signs must be the digest of (subject || claim_hash ||
        // nonce); a different nonce produces a different digest and the
        // recovered signer will not match the stored issuer.
        let typed_digest = keccak_revoke_digest(subject, claim_hash, nonce);
        assert_eq!(
            digest, typed_digest,
            "CredentialRegistry::revoke: digest does not bind nonce"
        );

        let recovered = recover_issuer(digest, signature)
            .unwrap_or_revert(&self.env());
        assert_eq!(
            recovered, view.issuer,
            "CredentialRegistry::revoke: unauthorized"
        );

        view.revoked = true;
        view.valid = false;
        self.latest.set(&(subject, claim_hash), view);
    }

    // ---------- reads ----------

    pub fn issuer_nonce_of(&self, issuer: [u8; 20]) -> u64 {
        self.issuer_nonce.get(&issuer).unwrap_or(0)
    }

    pub fn latest_credential(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
    ) -> Option<CredentialView> {
        self.latest.get(&(subject, claim_hash))
    }

    /// The credential plus its read-time standing: whether the issuer is
    /// currently accredited and whether the namespace requires it.
    pub fn credential_standing(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
    ) -> Option<StandingView> {
        let view = self.latest.get(&(subject, claim_hash))?;
        let (issuer_accredited, accreditation_required) =
            self.standing_for(&view.claim, view.issuer);
        Some(StandingView {
            issuer: view.issuer,
            claim: view.claim,
            issued_at: view.issued_at,
            expires_at: view.expires_at,
            revoked: view.revoked,
            valid: view.valid,
            issuer_accredited,
            accreditation_required,
        })
    }

    /// Is `issuer` currently accredited for `namespace_hash`?
    pub fn is_issuer_accredited(
        &self,
        issuer: [u8; 20],
        namespace_hash: [u8; 32],
    ) -> bool {
        self.issuer_accreditation
            .get(&(issuer, namespace_hash))
            .map(|a| a.active)
            .unwrap_or(false)
    }

    /// Does `namespace_hash` require issuer accreditation to issue?
    pub fn namespace_policy_of(&self, namespace_hash: [u8; 32]) -> bool {
        self.namespace_policy.get(&namespace_hash).unwrap_or(false)
    }

    // ---------- helpers ----------

    /// Compute the canonical revoke digest the contract binds to. The
    /// off-chain signer must produce this exact digest.
    pub fn compute_revoke_digest(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
        nonce: u64,
    ) -> [u8; 32] {
        keccak_revoke_digest(subject, claim_hash, nonce)
    }

    /// Validate a claim and return its keccak hash — off-chain parity
    /// helper so clients can confirm canonicality before signing.
    pub fn claim_hash_of(&self, claim: String) -> [u8; 32] {
        parse_claim(&claim).unwrap_or_revert(&self.env());
        keccak(claim.as_bytes())
    }

    /// (issuer_accredited, accreditation_required) for a claim + issuer.
    fn standing_for(&self, claim: &str, issuer: [u8; 20]) -> (bool, bool) {
        let ns_hash = match parse_claim(claim) {
            Some((_, ns_end)) => keccak(&claim.as_bytes()[..ns_end]),
            None => return (false, false),
        };
        (
            self.is_issuer_accredited(issuer, ns_hash),
            self.namespace_policy.get(&ns_hash).unwrap_or(false),
        )
    }

    pub fn is_capable(&self, subject: [u8; 32], claim_hash: [u8; 32]) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, claim_hash)) {
            Some(v) => v.valid && !v.revoked && v.expires_at > now,
            None => false,
        }
    }

    /// `is_capable` plus the accreditation signal: true only when the
    /// credential is valid AND its issuer is currently accredited for the
    /// claim's namespace.
    pub fn is_capable_accredited(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
    ) -> bool {
        if !self.is_capable(subject, claim_hash) {
            return false;
        }
        match self.latest.get(&(subject, claim_hash)) {
            Some(v) => {
                self.standing_for(&v.claim, v.issuer).0
            }
            None => false,
        }
    }

    pub fn is_capable_from_issuer(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
        issuer: [u8; 20],
    ) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, claim_hash)) {
            Some(v) => v.issuer == issuer && v.valid && !v.revoked && v.expires_at > now,
            None => false,
        }
    }
}

#[cfg(test)]
mod test_helpers {
    use k256::ecdsa::{RecoveryId, Signature, SigningKey};
    use rand::thread_rng;
    use sha3::{Digest, Keccak256};

    pub const TEST_DOMAIN: [u8; 32] = [0x42; 32];

    pub struct TestIssuer {
        pub key: SigningKey,
        pub address: [u8; 20],
    }

    pub fn issuer_fixture() -> TestIssuer {
        let key = SigningKey::random(&mut thread_rng());
        let vk = key.verifying_key();
        let point = vk.to_encoded_point(false);
        let pk_bytes = point.as_bytes();
        let hash = Keccak256::digest(&pk_bytes[1..]);
        let mut address = [0u8; 20];
        address.copy_from_slice(&hash[12..]);
        TestIssuer { key, address }
    }

    pub fn sign_digest(sk: &SigningKey, digest: [u8; 32]) -> [u8; 65] {
        let (sig, recid): (Signature, RecoveryId) =
            sk.sign_prehash_recoverable(&digest).expect("sign failed");
        let mut out = [0u8; 65];
        out[..64].copy_from_slice(&sig.to_bytes());
        out[64] = 27 + recid.to_byte();
        out
    }

    pub fn make_revoke_digest(
        subject: [u8; 32],
        claim_hash: [u8; 32],
        nonce: u64,
    ) -> [u8; 32] {
        let mut buf = [0u8; 72];
        buf[..32].copy_from_slice(&subject);
        buf[32..64].copy_from_slice(&claim_hash);
        buf[64..72].copy_from_slice(&nonce.to_be_bytes());
        Keccak256::digest(buf).into()
    }

    fn keccak(bytes: &[u8]) -> [u8; 32] {
        Keccak256::digest(bytes).into()
    }

    fn u256_be(v: u64) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[24..].copy_from_slice(&v.to_be_bytes());
        out
    }

    /// Mirror of the contract's `eip712_credential_digest`.
    pub fn make_issue_digest(
        domain: [u8; 32],
        issuer: [u8; 20],
        subject: [u8; 32],
        claim: &str,
        issued_at: u64,
        expires_at: u64,
        nonce: u64,
    ) -> [u8; 32] {
        let typehash = keccak(
            b"Credential(address issuer,bytes32 subject,string claim,uint64 issuedAt,uint64 expiresAt,uint256 nonce)",
        );
        let mut sh = Vec::with_capacity(32 * 7);
        sh.extend_from_slice(&typehash);
        sh.extend_from_slice(&[0u8; 12]);
        sh.extend_from_slice(&issuer);
        sh.extend_from_slice(&subject);
        sh.extend_from_slice(&keccak(claim.as_bytes()));
        sh.extend_from_slice(&u256_be(issued_at));
        sh.extend_from_slice(&u256_be(expires_at));
        sh.extend_from_slice(&u256_be(nonce));
        let struct_hash = keccak(&sh);
        let mut d = Vec::with_capacity(66);
        d.extend_from_slice(b"\x19\x01");
        d.extend_from_slice(&domain);
        d.extend_from_slice(&struct_hash);
        keccak(&d)
    }
}

#[cfg(test)]
mod tests {
    use super::{test_helpers::*, CredentialRegistry, CredentialRegistryHostRef};
    use odra::host::{Deployer, NoArgs};
    use sha3::{Digest, Keccak256};

    fn subject() -> [u8; 32] {
        [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
            0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14,
            0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
            0x1f, 0x20,
        ]
    }

    const CLAIM: &str = "kyc.basic";
    const PARAM_CLAIM: &str = "agent.spend:currency=cspr:max=1000";

    fn claim_hash(claim: &str) -> [u8; 32] {
        Keccak256::digest(claim.as_bytes()).into()
    }

    fn ns_hash(ns: &str) -> [u8; 32] {
        Keccak256::digest(ns.as_bytes()).into()
    }

    /// Deploy + configure the domain separator so issue() works.
    fn deploy_registry(
        env: &odra::host::HostEnv,
    ) -> CredentialRegistryHostRef {
        let mut contract = CredentialRegistry::deploy(env, NoArgs);
        contract.set_domain_separator(TEST_DOMAIN);
        contract
    }

    fn issue_default(
        contract: &mut CredentialRegistryHostRef,
        issuer: &TestIssuer,
        claim: &str,
        nonce: u64,
    ) {
        let digest = make_issue_digest(
            TEST_DOMAIN,
            issuer.address,
            subject(),
            claim,
            0,
            u64::MAX,
            nonce,
        );
        let sig = sign_digest(&issuer.key, digest);
        contract.issue(
            issuer.address,
            subject(),
            claim.to_string(),
            0,
            u64::MAX,
            nonce,
            digest,
            sig,
        );
    }

    #[test]
    fn issue_and_verify() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        assert!(contract.is_capable(subject(), ch));
        let latest = contract.latest_credential(subject(), ch).unwrap();
        assert_eq!(latest.issuer, issuer.address);
        assert_eq!(latest.claim, CLAIM);
        assert!(latest.valid);
        assert!(!latest.revoked);
        assert_eq!(contract.issuer_nonce_of(issuer.address), 1);
    }

    #[test]
    fn issue_stores_parameterized_claim() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, PARAM_CLAIM, 0);

        let ch = claim_hash(PARAM_CLAIM);
        assert!(contract.is_capable(subject(), ch));
        let latest = contract.latest_credential(subject(), ch).unwrap();
        assert_eq!(latest.claim, PARAM_CLAIM);
    }

    #[test]
    fn claim_hash_of_validates_and_hashes() {
        let env = odra_test::env();
        let contract = deploy_registry(&env);
        assert_eq!(
            contract.claim_hash_of(CLAIM.to_string()),
            claim_hash(CLAIM)
        );
        assert_eq!(
            contract.claim_hash_of(PARAM_CLAIM.to_string()),
            claim_hash(PARAM_CLAIM)
        );
    }

    #[test]
    #[should_panic]
    fn issue_rejects_noncanonical_claim() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        // params out of order — non-canonical
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), "x.y:b=2:a=1", 0,
            u64::MAX, 0,
        );
        let sig = sign_digest(&issuer.key, digest);
        contract.issue(
            issuer.address,
            subject(),
            "x.y:b=2:a=1".to_string(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    #[test]
    #[should_panic]
    fn issue_rejects_dotless_capability() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), "nodots", 0, u64::MAX, 0,
        );
        let sig = sign_digest(&issuer.key, digest);
        contract.issue(
            issuer.address,
            subject(),
            "nodots".to_string(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    #[test]
    #[should_panic]
    fn issue_rejects_bad_signature() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), CLAIM, 0, u64::MAX, 0,
        );
        let mut sig = sign_digest(&issuer.key, digest);
        sig[10] ^= 0xff;
        contract.issue(
            issuer.address,
            subject(),
            CLAIM.to_string(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    /// The v2 hardening: a digest signed over claim A cannot be replayed
    /// with claim B — the stored fields must match the signed fields.
    #[test]
    #[should_panic]
    fn issue_rejects_substituted_claim() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        // Issuer signs a digest for CLAIM.
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), CLAIM, 0, u64::MAX, 0,
        );
        let sig = sign_digest(&issuer.key, digest);
        // Relayer submits the same digest+signature but a different claim.
        contract.issue(
            issuer.address,
            subject(),
            PARAM_CLAIM.to_string(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    #[test]
    #[should_panic]
    fn issue_rejects_wrong_issuer() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let other = issuer_fixture();
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), CLAIM, 0, u64::MAX, 0,
        );
        let sig = sign_digest(&issuer.key, digest);
        contract.issue(
            other.address,
            subject(),
            CLAIM.to_string(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    #[test]
    #[should_panic]
    fn issue_rejects_reused_nonce() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);
        issue_default(&mut contract, &issuer, PARAM_CLAIM, 0); // nonce 0 again
    }

    #[test]
    fn issue_increments_issuer_nonce() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);
        assert_eq!(contract.issuer_nonce_of(issuer.address), 1);
        issue_default(&mut contract, &issuer, PARAM_CLAIM, 1);
        assert_eq!(contract.issuer_nonce_of(issuer.address), 2);
    }

    // ---------- accreditation ----------

    #[test]
    fn accreditation_required_namespace_blocks_unaccredited() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        contract.set_namespace_policy(ns_hash("rwa"), true);
        assert!(contract.namespace_policy_of(ns_hash("rwa")));

        // Unaccredited issue must revert.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || issue_default(&mut contract, &issuer, "rwa.accredited", 0),
        ));
        assert!(result.is_err());
    }

    #[test]
    fn accredited_issuer_can_issue_in_required_namespace() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        contract.set_namespace_policy(ns_hash("rwa"), true);
        contract.set_issuer_accreditation(issuer.address, ns_hash("rwa"), true);
        assert!(contract.is_issuer_accredited(issuer.address, ns_hash("rwa")));

        issue_default(&mut contract, &issuer, "rwa.accredited", 0);
        assert!(contract.is_capable(subject(), claim_hash("rwa.accredited")));
        assert!(contract.is_capable_accredited(
            subject(),
            claim_hash("rwa.accredited")
        ));
    }

    #[test]
    fn open_namespace_allows_unaccredited_issuance() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);
        assert!(contract.is_capable(subject(), claim_hash(CLAIM)));
        // But the accredited read is false.
        assert!(!contract.is_capable_accredited(subject(), claim_hash(CLAIM)));
    }

    /// Standing is read-time: revoking accreditation withdraws standing
    /// from already-issued credentials.
    #[test]
    fn standing_tracks_accreditation_lifecycle() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        contract.set_namespace_policy(ns_hash("rwa"), true);
        contract.set_issuer_accreditation(issuer.address, ns_hash("rwa"), true);
        issue_default(&mut contract, &issuer, "rwa.accredited", 0);

        let ch = claim_hash("rwa.accredited");
        let standing = contract.credential_standing(subject(), ch).unwrap();
        assert!(standing.issuer_accredited);
        assert!(standing.accreditation_required);
        assert_eq!(standing.claim, "rwa.accredited");

        contract.set_issuer_accreditation(issuer.address, ns_hash("rwa"), false);
        let standing = contract.credential_standing(subject(), ch).unwrap();
        assert!(!standing.issuer_accredited);
        // The credential itself is still valid — standing is metadata.
        assert!(contract.is_capable(subject(), ch));
        assert!(!contract.is_capable_accredited(subject(), ch));
    }

    // ---------- admin ----------

    #[test]
    fn deployer_is_admin() {
        let env = odra_test::env();
        let contract = deploy_registry(&env);
        assert_eq!(contract.admin().unwrap(), env.caller());
    }

    #[test]
    #[should_panic]
    fn non_admin_cannot_set_policy() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        env.set_caller(env.get_account(1));
        contract.set_namespace_policy(ns_hash("rwa"), true);
    }

    #[test]
    #[should_panic]
    fn non_admin_cannot_accredit() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        env.set_caller(env.get_account(1));
        contract.set_issuer_accreditation(issuer.address, ns_hash("rwa"), true);
    }

    #[test]
    fn admin_can_transfer_admin() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let new_admin = env.get_account(1);
        contract.set_admin(new_admin);
        assert_eq!(contract.admin().unwrap(), new_admin);

        // New admin can now set policy.
        env.set_caller(new_admin);
        contract.set_namespace_policy(ns_hash("rwa"), true);
        assert!(contract.namespace_policy_of(ns_hash("rwa")));
    }

    // ---------- revoke ----------

    #[test]
    fn revoke_makes_credential_not_capable() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        assert!(contract.is_capable(subject(), ch));

        let revoke_digest = make_revoke_digest(subject(), ch, 0);
        let revoke_sig = sign_digest(&issuer.key, revoke_digest);
        contract.revoke(subject(), ch, 0, revoke_digest, revoke_sig);
        assert!(!contract.is_capable(subject(), ch));

        let latest = contract.latest_credential(subject(), ch).unwrap();
        assert!(latest.revoked);
        assert!(!latest.valid);
    }

    #[test]
    #[should_panic]
    fn revoke_rejects_wrong_nonce() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        let revoke_digest = make_revoke_digest(subject(), ch, 0);
        let revoke_sig = sign_digest(&issuer.key, revoke_digest);
        contract.revoke(subject(), ch, 7, revoke_digest, revoke_sig);
    }

    #[test]
    #[should_panic]
    fn revoke_rejects_bad_digest() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        let bogus = [0u8; 32];
        let sig = sign_digest(&issuer.key, bogus);
        contract.revoke(subject(), ch, 0, bogus, sig);
    }

    #[test]
    #[should_panic]
    fn revoke_rejects_unauthorized_signer() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let attacker = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        let revoke_digest = make_revoke_digest(subject(), ch, 0);
        let revoke_sig = sign_digest(&attacker.key, revoke_digest);
        contract.revoke(subject(), ch, 0, revoke_digest, revoke_sig);
    }

    // ---------- expiry / multi ----------

    #[test]
    fn expired_credential_is_not_capable() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let digest = make_issue_digest(
            TEST_DOMAIN, issuer.address, subject(), CLAIM, 0, 0, 0,
        );
        let sig = sign_digest(&issuer.key, digest);
        contract.issue(
            issuer.address,
            subject(),
            CLAIM.to_string(),
            0,
            0,
            0,
            digest,
            sig,
        );
        assert!(!contract.is_capable(subject(), claim_hash(CLAIM)));
    }

    #[test]
    fn is_capable_from_issuer_requires_matching_issuer() {
        let env = odra_test::env();
        let mut contract = deploy_registry(&env);
        let issuer = issuer_fixture();
        let other = issuer_fixture();
        issue_default(&mut contract, &issuer, CLAIM, 0);

        let ch = claim_hash(CLAIM);
        assert!(contract.is_capable_from_issuer(subject(), ch, issuer.address));
        assert!(!contract.is_capable_from_issuer(subject(), ch, other.address));
    }
}
