//! CredentialRegistry — EIP-712 capability credentials on Casper.
//!
//! Casper port of `CredentialRegistry.sol`. Stores the *latest* signed
//! credential per `(subject, capability_hash)` pair, with a per-issuer nonce
//! to make replays impossible. Credentials are signed off-chain using
//! secp256k1 EIP-712 typed data; this contract recovers the issuer address
//! from the digest + signature and verifies it matches the supplied issuer.
//!
//! The signature format is the EVM-style 65-byte envelope:
//!   r (32 bytes) || s (32 bytes) || v (1 byte, 27 or 28)
//!
//! Both `issue` and `revoke` recover the secp256k1 issuer address on-chain
//! and enforce it, so relayers can submit transactions but cannot forge them.

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use odra::prelude::*;
use sha3::{Digest, Keccak256};

#[odra::odra_type]
pub struct CredentialView {
    pub issuer: [u8; 20],
    pub subject: [u8; 32],
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
}

#[odra::module]
pub struct CredentialRegistry {
    /// Per-issuer nonce, incremented on every successful `issue`.
    issuer_nonce: Mapping<[u8; 20], u64>,
    /// Stored credentials keyed by `(subject, capability_hash)` → CredentialView.
    /// Tuple keys are encoded as a concatenated byte sequence by Odra.
    latest: Mapping<([u8; 32], [u8; 32]), CredentialView>,
}

/// Recover the 20-byte Ethereum-style issuer address from an EIP-712 digest
/// and a 65-byte EVM-style signature.
fn recover_issuer(digest: [u8; 32], signature: [u8; 65]) -> Option<[u8; 20]> {
    // EVM v = 27/28 → recovery id 0/1.
    let recid_byte = match signature[64] {
        27 => 0u8,
        28 => 1u8,
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

#[odra::module]
impl CredentialRegistry {
    pub fn init(&mut self) {}

    /// Issue a credential. The caller acts as a relayer; authorization comes
    /// from a valid secp256k1 EIP-712 signature over the supplied digest.
    /// Replays are prevented by the per-issuer nonce embedded in the digest.
    pub fn issue(
        &mut self,
        issuer: [u8; 20],
        subject: [u8; 32],
        capability_hash: [u8; 32],
        issued_at: u64,
        expires_at: u64,
        nonce: u64,
        digest: [u8; 32],
        signature: [u8; 65],
    ) {
        let current_nonce = self.issuer_nonce.get(&issuer).unwrap_or(0);
        assert_eq!(current_nonce, nonce, "CredentialRegistry::issue: bad nonce");

        let recovered = recover_issuer(digest, signature)
            .unwrap_or_revert(&self.env());
        assert_eq!(
            recovered, issuer,
            "CredentialRegistry::issue: signature does not match issuer"
        );

        self.latest.set(
            &(subject, capability_hash),
            CredentialView {
                issuer,
                subject,
                issued_at,
                expires_at,
                revoked: false,
                valid: true,
            },
        );
        self.issuer_nonce.set(&issuer, current_nonce + 1);
    }

    /// Revoke a credential. Only the original issuer can revoke.
    /// Authorization comes from a valid secp256k1 signature over the supplied
    /// digest; the recovered signer must match the stored credential issuer.
    pub fn revoke(
        &mut self,
        subject: [u8; 32],
        capability_hash: [u8; 32],
        _nonce: u64,
        digest: [u8; 32],
        signature: [u8; 65],
    ) {
        let mut view = self
            .latest
            .get(&(subject, capability_hash))
            .unwrap_or_revert(&self.env());

        let recovered = recover_issuer(digest, signature)
            .unwrap_or_revert(&self.env());
        assert_eq!(
            recovered, view.issuer,
            "CredentialRegistry::revoke: unauthorized"
        );

        view.revoked = true;
        view.valid = false;
        self.latest.set(&(subject, capability_hash), view);
    }

    // ---------- reads ----------

    pub fn issuer_nonce_of(&self, issuer: [u8; 20]) -> u64 {
        self.issuer_nonce.get(&issuer).unwrap_or(0)
    }

    pub fn latest_credential(
        &self,
        subject: [u8; 32],
        capability_hash: [u8; 32],
    ) -> Option<CredentialView> {
        self.latest.get(&(subject, capability_hash))
    }

    pub fn is_capable(&self, subject: [u8; 32], capability_hash: [u8; 32]) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, capability_hash)) {
            Some(v) => v.valid && !v.revoked && v.expires_at > now,
            None => false,
        }
    }

    pub fn is_capable_from_issuer(
        &self,
        subject: [u8; 32],
        capability_hash: [u8; 32],
        issuer: [u8; 20],
    ) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, capability_hash)) {
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
        capability_hash: [u8; 32],
        nonce: u64,
    ) -> [u8; 32] {
        let mut buf = [0u8; 96];
        buf[..32].copy_from_slice(&subject);
        buf[32..64].copy_from_slice(&capability_hash);
        buf[64..72].copy_from_slice(&nonce.to_be_bytes());
        Keccak256::digest(buf).into()
    }
}

#[cfg(test)]
mod tests {
    use super::{test_helpers::*, CredentialRegistry};
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

    fn capability() -> [u8; 32] {
        [
            0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33,
            0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd,
            0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
            0x88, 0x99,
        ]
    }

    fn make_digest(subject: [u8; 32], capability: [u8; 32]) -> [u8; 32] {
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(&subject);
        buf[32..].copy_from_slice(&capability);
        Keccak256::digest(buf).into()
    }

    #[test]
    fn issue_and_verify() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );

        assert!(contract.is_capable(subject(), capability()));
        let latest = contract
            .latest_credential(subject(), capability())
            .unwrap();
        assert_eq!(latest.issuer, issuer.address);
        assert!(latest.valid);
        assert!(!latest.revoked);
        assert_eq!(contract.issuer_nonce_of(issuer.address), 1);
    }

    #[test]
    #[should_panic]
    fn issue_rejects_bad_signature() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let mut sig = sign_digest(&issuer.key, digest);
        // Corrupt the signature.
        sig[10] ^= 0xff;

        contract.issue(
            issuer.address,
            subject(),
            capability(),
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
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let other = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        // Submit with a different issuer address than the signer.
        contract.issue(
            other.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
    }

    #[test]
    fn issue_increments_issuer_nonce() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();

        let digest0 = make_digest(subject(), capability());
        let sig0 = sign_digest(&issuer.key, digest0);
        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest0,
            sig0,
        );
        assert_eq!(contract.issuer_nonce_of(issuer.address), 1);

        let digest1 = make_digest(capability(), subject());
        let sig1 = sign_digest(&issuer.key, digest1);
        contract.issue(
            issuer.address,
            subject(),
            capability(),
            1,
            u64::MAX,
            1,
            digest1,
            sig1,
        );
        assert_eq!(contract.issuer_nonce_of(issuer.address), 2);
    }

    #[test]
    #[should_panic]
    fn issue_rejects_reused_nonce() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );

        // Re-using nonce 0 must fail.
        let digest2 = make_digest(capability(), subject());
        let sig2 = sign_digest(&issuer.key, digest2);
        contract.issue(
            issuer.address,
            subject(),
            capability(),
            1,
            u64::MAX,
            0,
            digest2,
            sig2,
        );
    }

    #[test]
    fn revoke_makes_credential_not_capable() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );
        assert!(contract.is_capable(subject(), capability()));

        let revoke_digest = make_revoke_digest(subject(), capability(), 0);
        let revoke_sig = sign_digest(&issuer.key, revoke_digest);
        contract.revoke(subject(), capability(), 0, revoke_digest, revoke_sig);
        assert!(!contract.is_capable(subject(), capability()));

        let latest = contract
            .latest_credential(subject(), capability())
            .unwrap();
        assert!(latest.revoked);
        assert!(!latest.valid);
    }

    #[test]
    #[should_panic]
    fn revoke_rejects_unauthorized_signer() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let attacker = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );

        let revoke_digest = make_revoke_digest(subject(), capability(), 0);
        let revoke_sig = sign_digest(&attacker.key, revoke_digest);
        contract.revoke(
            subject(),
            capability(),
            0,
            revoke_digest,
            revoke_sig,
        );
    }

    #[test]
    fn expired_credential_is_not_capable() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            0,
            0,
            digest,
            sig,
        );

        assert!(!contract.is_capable(subject(), capability()));
    }

    #[test]
    fn is_capable_from_issuer_requires_matching_issuer() {
        let env = odra_test::env();
        let mut contract = CredentialRegistry::deploy(&env, NoArgs);
        let issuer = issuer_fixture();
        let other = issuer_fixture();
        let digest = make_digest(subject(), capability());
        let sig = sign_digest(&issuer.key, digest);

        contract.issue(
            issuer.address,
            subject(),
            capability(),
            0,
            u64::MAX,
            0,
            digest,
            sig,
        );

        assert!(contract.is_capable_from_issuer(subject(), capability(), issuer.address));
        assert!(!contract.is_capable_from_issuer(subject(), capability(), other.address));
    }
}
