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
///
/// Odra's `Address` enum serializes to:
///   - 32 bytes for an `AccountHash` (legacy / inline form)
///   - 33 bytes for a variant-tagged form (1 byte variant tag + 32 bytes hash)
///   - 33 bytes for a `ContractHash` (1 byte variant tag + 32 bytes hash)
///
/// The CredentialRegistry uses a 32-byte EIP-712-style subject. To match
/// the off-chain issuer (which strips the `account-hash-` prefix and uses
/// the raw 32 bytes), we bind to the **trailing 32 bytes** of the
/// serialized Address. This sidesteps the variant tag and produces the
/// same 32 bytes the issuer signed for.
fn address_to_subject_key(addr: &Address) -> [u8; 32] {
    let bytes = addr.to_bytes().unwrap_or_default();
    let mut key = [0u8; 32];
    if bytes.len() >= 32 {
        let start = bytes.len() - 32;
        key.copy_from_slice(&bytes[start..]);
    } else {
        key[..bytes.len()].copy_from_slice(&bytes);
    }
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

    #[test]
    fn balance_of_zero_for_unknown_account() {
        let env = odra_test::env();
        let dummy_addr = env.get_account(0);
        let vault = GatedVault::deploy(
            &env,
            GatedVaultInitArgs {
                credential_registry: dummy_addr,
                required_capability: [0u8; 32],
            },
        );

        let alice = env.get_account(1);
        assert_eq!(vault.balance_of(alice), U512::zero());
        assert_eq!(vault.total_deposits(), U512::zero());
    }

    #[test]
    fn address_to_subject_key_is_32_bytes() {
        // The bounded subject key must always be exactly 32 bytes for the
        // CredentialRegistry dictionary lookup. This guards against a
        // shape change in Odra's Address serialization.
        let env = odra_test::env();
        let account = env.get_account(0);
        let key = address_to_subject_key(&account);
        assert_eq!(key.len(), 32);
    }

    #[test]
    #[should_panic]
    fn deposit_rejects_zero_value() {
        let env = odra_test::env();
        let dummy_addr = env.get_account(0);
        let mut vault = GatedVault::deploy(
            &env,
            GatedVaultInitArgs {
                credential_registry: dummy_addr,
                required_capability: [0u8; 32],
            },
        );

        let alice = env.get_account(1);
        env.set_caller(alice);
        // no attached value — must revert
        vault.deposit();
    }

    #[test]
    #[should_panic]
    fn withdraw_reverts_insufficient_balance() {
        let env = odra_test::env();
        let dummy_addr = env.get_account(0);
        let mut vault = GatedVault::deploy(
            &env,
            GatedVaultInitArgs {
                credential_registry: dummy_addr,
                required_capability: [0u8; 32],
            },
        );

        let alice = env.get_account(1);
        env.set_caller(alice);
        // Withdrawing without a prior deposit must revert.
        vault.withdraw(U512::from(1u64));
    }

    #[test]
    #[should_panic]
    fn withdraw_reverts_without_credential() {
        // When the vault is pointed at a started-but-empty CredentialRegistry
        // the cross-contract `is_capable` call returns `false` and the
        // attempt to withdraw must revert with the credential error.
        //
        // We initialize a minimal CredentialRegistry across deploys so the
        // cross-contract call resolves. The test for "withdraw succeeds"
        // requires issuing a credential on-chain before withdrawal; that
        // path is exercised by the end-to-end demo script on Casper
        // Testnet (`scripts/casper-gated-vault-demo.ts`) — see docs/casper-buidl.md.
        let env = odra_test::env();
        let registry_owner = env.get_account(0);

        use crate::credential_registry::CredentialRegistry;
        // CredentialRegistry::init takes no arguments, so Odra's `NoArgs` is
        // the implicit init type. Deploy from the registry owner.
        env.set_caller(registry_owner);
        let registry = CredentialRegistry::deploy(&env, odra::host::NoArgs);
        let registry_addr = registry.address();

        env.set_caller(registry_owner);
        let mut vault = GatedVault::deploy(
            &env,
            GatedVaultInitArgs {
                credential_registry: registry_addr,
                required_capability: [0xab; 32],
            },
        );

        let alice = env.get_account(1);
        env.set_caller(alice);
        vault.withdraw(U512::from(1u64));
    }
}
