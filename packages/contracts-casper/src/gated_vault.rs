//! GatedVault — credential-gated escrow vault on Casper.
//!
//! A DeFi primitive that gates fund withdrawal behind a Ligis capability
//! credential. The vault reads `is_capable` from the deployed
//! `CredentialRegistry` contract via a cross-contract call.
//!
//! Use case: an RWA marketplace escrows buyer funds. The funds are only
//! released to the seller if the seller holds a valid `rwa.accredited`
//! credential. This makes Ligis credentials a first-class DeFi access
//! control primitive on Casper — not just an identity layer.
//!
//! Flow:
//!   1. `init(credential_registry, required_capability)` — deploy vault
//!   2. `deposit()` — anyone deposits CSPR (attached value)
//!   3. `withdraw(amount)` — only callable by agents with the required
//!      credential (verified via CredentialRegistry.is_capable)
//!   4. `balance_of(account)` — read deposit balance

use odra::prelude::*;
use odra::casper_types::{U512, RuntimeArgs, bytesrepr::ToBytes};
use odra::CallDef;

#[odra::module]
pub struct GatedVault {
    /// Address of the deployed CredentialRegistry contract.
    credential_registry: Var<Address>,
    /// The capability hash required to withdraw funds (e.g. rwa.accredited).
    required_capability: Var<[u8; 32]>,
    /// Deposits per account.
    deposits: Mapping<Address, U512>,
    /// Total deposits locked in the vault.
    total_deposits: Var<U512>,
}

#[odra::module]
impl GatedVault {
    /// Initialize the vault with the CredentialRegistry address and the
    /// required capability hash for withdrawals.
    pub fn init(&mut self, credential_registry: Address, required_capability: [u8; 32]) {
        self.credential_registry.set(credential_registry);
        self.required_capability.set(required_capability);
        self.total_deposits.set(U512::zero());
    }

    /// Deposit CSPR into the vault. The attached value is credited to the
    /// caller's balance.
    pub fn deposit(&mut self) {
        let caller = self.env().caller();
        let amount = self.env().attached_value();
        assert!(amount > U512::zero(), "GatedVault::deposit: must attach value");

        let current = self.deposits.get(&caller).unwrap_or(U512::zero());
        self.deposits.set(&caller, current + amount);
        let total = self.total_deposits.get_or_default();
        self.total_deposits.set(total + amount);
    }

    /// Withdraw funds from the vault. The caller must hold a valid Ligis
    /// credential for the required capability, verified on-chain via a
    /// cross-contract call to CredentialRegistry.is_capable.
    pub fn withdraw(&mut self, amount: U512) {
        let caller = self.env().caller();
        let balance = self.deposits.get(&caller).unwrap_or(U512::zero());
        assert!(
            balance >= amount,
            "GatedVault::withdraw: insufficient balance"
        );

        // Cross-contract call: check capability on the CredentialRegistry.
        let registry = self.credential_registry.get().unwrap_or_revert(&self.env());
        let cap_hash = self.required_capability.get_or_default();

        // Build the call to CredentialRegistry.is_capable(subject, capability_hash)
        let subject_bytes = address_to_subject_key(&caller);
        let mut args = RuntimeArgs::new();
        args.insert("subject", subject_bytes).unwrap_or_revert(&self.env());
        args.insert("capability_hash", cap_hash).unwrap_or_revert(&self.env());
        let call = CallDef::new("is_capable", false, args);

        let capable: bool = self.env().call_contract(registry, call);

        assert!(
            capable,
            "GatedVault::withdraw: caller does not hold the required credential"
        );

        // Deduct balance and send funds.
        self.deposits.set(&caller, balance - amount);
        let total = self.total_deposits.get_or_default();
        self.total_deposits.set(total - amount);
        self.env().transfer_tokens(&caller, &amount);
    }

    /// Read the deposit balance of an account.
    pub fn balance_of(&self, account: Address) -> U512 {
        self.deposits.get(&account).unwrap_or(U512::zero())
    }

    /// Read the total deposits locked in the vault.
    pub fn total_deposits(&self) -> U512 {
        self.total_deposits.get_or_default()
    }

    /// Read the required capability hash.
    pub fn required_capability(&self) -> [u8; 32] {
        self.required_capability.get_or_default()
    }

    /// Read the CredentialRegistry address.
    pub fn credential_registry(&self) -> Address {
        self.credential_registry.get().unwrap_or_revert(&self.env())
    }
}

/// Convert an Odra Address (Casper account) to a 32-byte subject key
/// for the CredentialRegistry's `is_capable` check.
fn address_to_subject_key(addr: &Address) -> [u8; 32] {
    let bytes = addr.to_bytes().unwrap_or_default();
    let mut key = [0u8; 32];
    let len = bytes.len().min(32);
    key[..len].copy_from_slice(&bytes[..len]);
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::Deployer;

    #[test]
    fn vault_initializes_correctly() {
        let env = odra_test::env();
        // Use a dummy address — the vault just needs to store it.
        let dummy_addr = env.get_account(0);
        let vault = GatedVault::deploy(
            &env,
            GatedVaultInitArgs {
                credential_registry: dummy_addr,
                required_capability: [0u8; 32],
            },
        );

        assert_eq!(vault.total_deposits(), U512::zero());
        assert_eq!(vault.required_capability(), [0u8; 32]);
        assert_eq!(vault.credential_registry(), dummy_addr);
    }
}
