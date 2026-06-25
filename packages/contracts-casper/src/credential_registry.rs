//! CredentialRegistry — EIP-712 capability credentials on Casper.
//!
//! Casper port of `CredentialRegistry.sol`. Stores the *latest* signed
//! credential per `(subject, capability_hash)` pair, with a per-issuer nonce
//! to make replays impossible. Signatures are verified via the EIP-712
//! typed-data digest, identical to the EVM side.
//!
//! Skeleton — entry points compile but signature verification + dictionary
//! layout still need to be wired against `casper-eip-712`. Flesh out alongside
//! `packages/adapter-casper/src/eip712.ts`.

use odra::prelude::*;

#[odra::odra_type]
pub struct CredentialView {
    pub issuer: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub valid: bool,
}

#[odra::module]
pub struct CredentialRegistry {
    /// Per-issuer nonce, incremented on every successful `issue`.
    issuer_nonce: Mapping<Address, u64>,
    /// Stored credentials keyed by `(subject, capability_hash)` → CredentialView.
    /// Tuple keys are encoded as a concatenated byte sequence by Odra.
    latest: Mapping<(Address, [u8; 32]), CredentialView>,
}

#[odra::module]
impl CredentialRegistry {
    pub fn init(&mut self) {}

    /// Issue a credential. Anyone may submit on behalf of the issuer — the
    /// signature is the authorization. Replays are prevented by the per-issuer
    /// nonce embedded in the typed-data digest.
    pub fn issue(
        &mut self,
        issuer: Address,
        subject: Address,
        capability_hash: [u8; 32],
        issued_at: u64,
        expires_at: u64,
        nonce: u64,
        _signature: Vec<u8>,
    ) {
        let current_nonce = self.issuer_nonce.get(&issuer).unwrap_or(0);
        assert_eq!(current_nonce, nonce, "CredentialRegistry::issue: bad nonce");

        // TODO: verify signature via casper-eip-712::verify(digest, signature, issuer)
        // Once wired, an invalid signature MUST revert here.

        self.latest.set(
            &(subject, capability_hash),
            CredentialView {
                issuer,
                issued_at,
                expires_at,
                revoked: false,
                valid: true,
            },
        );
        self.issuer_nonce.set(&issuer, current_nonce + 1);
    }

    /// Revoke a credential. Only the original issuer can revoke.
    pub fn revoke(&mut self, subject: Address, capability_hash: [u8; 32], _nonce: u64) {
        let mut view = self
            .latest
            .get(&(subject, capability_hash))
            .unwrap_or_revert(&self.env());

        let caller = self.env().caller();
        assert_eq!(view.issuer, caller, "CredentialRegistry::revoke: caller is not the issuer");

        view.revoked = true;
        view.valid = false;
        self.latest.set(&(subject, capability_hash), view);
    }

    // ---------- reads ----------

    pub fn issuer_nonce_of(&self, issuer: Address) -> u64 {
        self.issuer_nonce.get(&issuer).unwrap_or(0)
    }

    pub fn latest_credential(
        &self,
        subject: Address,
        capability_hash: [u8; 32],
    ) -> Option<CredentialView> {
        self.latest.get(&(subject, capability_hash))
    }

    pub fn is_capable(&self, subject: Address, capability_hash: [u8; 32]) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, capability_hash)) {
            Some(v) => v.valid && !v.revoked && v.expires_at > now,
            None => false,
        }
    }

    pub fn is_capable_from_issuer(
        &self,
        subject: Address,
        capability_hash: [u8; 32],
        issuer: Address,
    ) -> bool {
        let now = self.env().get_block_time();
        match self.latest.get(&(subject, capability_hash)) {
            Some(v) => v.issuer == issuer && v.valid && !v.revoked && v.expires_at > now,
            None => false,
        }
    }
}
