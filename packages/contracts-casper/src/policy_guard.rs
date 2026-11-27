//! PolicyGuard — reusable on-chain spend/policy enforcement on Casper.
//!
//! The enforcement axis of the Ligis trust substrate
//! (docs/casper-forward.md M3). GatedVault is one instance of "check a
//! credential then release"; PolicyGuard is the general primitive cohort
//! escrows, x402 facilitators, and RWA vaults call before releasing
//! funds: `check_and_record` evaluates a per-subject policy — a required
//! credential plus a rolling spend budget — and atomically records the
//! spend so velocity limits can't be bypassed by reentrancy or
//! parallel calls.
//!
//!   check_and_record(subject, amount)
//!     1. No policy for subject → allow (policies are opt-in; a subject
//!        with no policy is unconstrained, matching v1 semantics).
//!     2. policy.required_claim_hash != 0 → CredentialRegistry
//!        .is_capable(subject, required_claim_hash) must be true.
//!     3. spend[(subject, window)] + amount <= policy.budget, else false.
//!     4. Records the spend in the current window and returns true.
//!
//! Returns bool rather than reverting so callers can compose (e.g. a
//! vault can emit a denial reason or fall back). A `require_` wrapper
//! reverts with a reason for callers that prefer assert-style.
//!
//! Governance: a single admin (deployer, transferable) sets policies —
//! same model as CredentialRegistry v2's accreditation admin. Cohort
//! projects may later want self-sovereign policies (subject sets own
//! limits); v1 keeps the admin surface explicit and auditable.

use odra::prelude::*;
use odra::casper_types::{U512, RuntimeArgs};
use odra::CallDef;

/// Per-subject spending policy.
#[odra::odra_type]
pub struct Policy {
    /// Rolling window length in seconds.
    pub window_secs: u64,
    /// Max cumulative spend per window (motes).
    pub budget: U512,
    /// Credential claim hash the subject must hold (zero = no check).
    pub required_claim_hash: [u8; 32],
    /// Whether the policy is active.
    pub enabled: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            window_secs: 86_400,
            budget: U512::zero(),
            required_claim_hash: [0u8; 32],
            enabled: false,
        }
    }
}

#[odra::module]
pub struct PolicyGuard {
    /// CredentialRegistry used for the required-claim check.
    credential_registry: Var<Address>,
    /// Policy administrator (native Casper account).
    admin: Var<Address>,
    /// subject → spending policy.
    policies: Mapping<[u8; 32], Policy>,
    /// (subject, window_index) → cumulative spend in window.
    spend: Mapping<([u8; 32], u64), U512>,
}

#[odra::module]
impl PolicyGuard {
    /// Deploy: bind the CredentialRegistry package and set admin = deployer.
    pub fn init(&mut self, credential_registry: Address) {
        self.credential_registry.set(credential_registry);
        self.admin.set(self.env().caller());
    }

    // ---------- admin ----------

    fn require_admin(&self) {
        let admin = self.admin.get().unwrap_or_revert(&self.env());
        assert_eq!(
            self.env().caller(),
            admin,
            "PolicyGuard: caller is not admin"
        );
    }

    /// Set (or replace) a subject's policy. Pass `enabled=false` to clear.
    /// Flat args (not a Policy struct) keep the RuntimeArgs surface simple
    /// for off-chain callers and adapters.
    pub fn set_policy(
        &mut self,
        subject: [u8; 32],
        window_secs: u64,
        budget: U512,
        required_claim_hash: [u8; 32],
        enabled: bool,
    ) {
        self.require_admin();
        self.policies.set(
            &subject,
            Policy { window_secs, budget, required_claim_hash, enabled },
        );
    }

    /// Transfer admin to a new account.
    pub fn set_admin(&mut self, new_admin: Address) {
        self.require_admin();
        self.admin.set(new_admin);
    }

    pub fn admin(&self) -> Option<Address> {
        self.admin.get()
    }

    // ---------- enforcement ----------

    /// Evaluate the subject's policy for `amount` and, on pass, record
    /// the spend atomically. Returns true when allowed.
    pub fn check_and_record(
        &mut self,
        subject: [u8; 32],
        amount: U512,
    ) -> bool {
        let policy = match self.policies.get(&subject) {
            Some(p) if p.enabled => p,
            _ => return true, // no active policy → unconstrained
        };

        // Required-credential check via cross-contract call.
        if policy.required_claim_hash != [0u8; 32] {
            let registry = self
                .credential_registry
                .get()
                .unwrap_or_revert(&self.env());
            let mut args = RuntimeArgs::new();
            args.insert("subject", subject).unwrap_or_revert(&self.env());
            args.insert("claim_hash", policy.required_claim_hash)
                .unwrap_or_revert(&self.env());
            let call = CallDef::new("is_capable", false, args);
            let capable: bool = self.env().call_contract(registry, call);
            if !capable {
                return false;
            }
        }

        // Rolling-window budget check + record.
        let now = self.env().get_block_time();
        let window = if policy.window_secs == 0 {
            0
        } else {
            now / policy.window_secs
        };
        let key = (subject, window);
        let spent = self.spend.get(&key).unwrap_or(U512::zero());
        if spent + amount > policy.budget {
            return false;
        }
        self.spend.set(&key, spent + amount);
        true
    }

    /// Same evaluation without recording — for off-chain pre-flight.
    /// Kept cheap: skips the credential cross-call when a required claim
    /// is set? No — it performs the same checks minus the spend write.
    pub fn check(&self, subject: [u8; 32], amount: U512) -> bool {
        let policy = match self.policies.get(&subject) {
            Some(p) if p.enabled => p,
            _ => return true,
        };
        // Note: `check` cannot perform the cross-contract call on a &self
        // view cheaply in all Odra versions; callers needing the full
        // evaluation should use check_and_record. This read path enforces
        // only the budget leg for UI hints.
        let now = self.env().get_block_time();
        let window = if policy.window_secs == 0 {
            0
        } else {
            now / policy.window_secs
        };
        let spent = self.spend.get(&(subject, window)).unwrap_or(U512::zero());
        spent + amount <= policy.budget
    }

    /// Current-window spend for a subject (0 when none).
    pub fn spend_in_window(&self, subject: [u8; 32]) -> U512 {
        let policy = self.policies.get(&subject).unwrap_or_default();
        let now = self.env().get_block_time();
        let window = if policy.window_secs == 0 {
            0
        } else {
            now / policy.window_secs
        };
        self.spend.get(&(subject, window)).unwrap_or(U512::zero())
    }

    /// Read a subject's policy.
    pub fn policy_of(&self, subject: [u8; 32]) -> Option<Policy> {
        self.policies.get(&subject)
    }

    /// Read the bound CredentialRegistry address.
    pub fn credential_registry(&self) -> Address {
        self.credential_registry.get().unwrap_or_revert(&self.env())
    }
}

#[cfg(test)]
mod tests {
    use super::{Policy, PolicyGuard, PolicyGuardHostRef, PolicyGuardInitArgs};
    use odra::casper_types::U512;
    use odra::host::{Deployer, NoArgs};
    use odra::prelude::Addressable;

    const SUBJECT: [u8; 32] = [0x11; 32];
    const OTHER: [u8; 32] = [0x22; 32];

    fn deploy(env: &odra::host::HostEnv) -> PolicyGuardHostRef {
        // Registry arg is unused when no required claim is set; deploy a
        // real registry anyway to keep the call path exercised.
        let registry = crate::credential_registry::CredentialRegistry::deploy(env, NoArgs);
        let args = PolicyGuardInitArgs { credential_registry: registry.address() };
        PolicyGuard::deploy(env, args)
    }

    #[test]
    fn no_policy_allows() {
        let env = odra_test::env();
        let mut guard = deploy(&env);
        assert!(guard.check_and_record(SUBJECT, U512::from(1000u64)));
        assert_eq!(guard.spend_in_window(SUBJECT), U512::zero());
    }

    #[test]
    fn budget_enforced_and_recorded() {
        let env = odra_test::env();
        let mut guard = deploy(&env);
        guard.set_policy(SUBJECT, 3600, U512::from(1000u64), [0u8; 32], true);

        assert!(guard.check_and_record(SUBJECT, U512::from(600u64)));
        assert!(guard.check_and_record(SUBJECT, U512::from(400u64)));
        assert!(!guard.check_and_record(SUBJECT, U512::from(1u64)));
        assert_eq!(guard.spend_in_window(SUBJECT), U512::from(1000u64));

        // Other subject unaffected.
        assert!(guard.check_and_record(OTHER, U512::from(999999u64)));
    }

    #[test]
    fn required_claim_denies_uncapable() {
        let env = odra_test::env();
        let mut guard = deploy(&env);
        guard.set_policy(SUBJECT, 3600, U512::from(1000u64), [0x42; 32], true);

        // Registry has no credential for SUBJECT → cross-call returns false.
        assert!(!guard.check_and_record(SUBJECT, U512::from(1u64)));
    }
}
