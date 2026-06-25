//! AgentId — portable agent identity on Casper.
//!
//! Casper port of `PharosAgentID.sol`. Each agent has:
//!   - a numeric `token_id` (auto-incrementing)
//!   - a `controller` (account hash of the current owner)
//!   - a `token_uri` (off-chain metadata pointer, e.g. `0g://<root>`)
//!
//! Two reverse indexes for fast lookup: `walletOfAgent(controller) → token_id`
//! and `ownerOf(token_id) → controller`.
//!
//! Skeleton — entry points compile but the bodies are minimal stubs. Flesh
//! out once the EVM ↔ Casper invariants are finalized.

use odra::prelude::*;

#[odra::module]
pub struct AgentId {
    next_id: Var<u64>,
    owner_of: Mapping<u64, Address>,
    wallet_of_agent: Mapping<Address, u64>,
    token_uri: Mapping<u64, String>,
}

#[odra::module]
impl AgentId {
    pub fn init(&mut self) {
        self.next_id.set(1);
    }

    /// Mint a new agent id whose controller is the caller.
    pub fn mint_self(&mut self, token_uri: String) -> u64 {
        let caller = self.env().caller();
        self.mint_internal(caller, token_uri)
    }

    /// Mint an agent id for an explicit controller (admin-style mint).
    pub fn mint(&mut self, controller: Address, token_uri: String) -> u64 {
        // TODO: gate this on an admin role once roles are introduced. For now
        // anyone can mint for any address (matches Phase-1 PharosAgentID behavior).
        self.mint_internal(controller, token_uri)
    }

    /// Rotate the controller key of an existing agent id.
    pub fn rotate(&mut self, token_id: u64, new_controller: Address) {
        let current = self.owner_of.get(&token_id).unwrap_or_revert(&self.env());
        let caller = self.env().caller();
        assert_eq!(current, caller, "AgentId::rotate: caller is not the current controller");

        self.owner_of.set(&token_id, new_controller);
        self.wallet_of_agent.set(&current, 0);
        self.wallet_of_agent.set(&new_controller, token_id);
    }

    /// Update the off-chain metadata pointer of an agent id.
    pub fn set_token_uri(&mut self, token_id: u64, uri: String) {
        let current = self.owner_of.get(&token_id).unwrap_or_revert(&self.env());
        let caller = self.env().caller();
        assert_eq!(current, caller, "AgentId::set_token_uri: caller is not the controller");

        self.token_uri.set(&token_id, uri);
    }

    // ---------- reads ----------

    pub fn owner_of(&self, token_id: u64) -> Option<Address> {
        self.owner_of.get(&token_id)
    }

    pub fn wallet_of_agent(&self, controller: Address) -> u64 {
        self.wallet_of_agent.get(&controller).unwrap_or(0)
    }

    pub fn token_uri_of(&self, token_id: u64) -> String {
        self.token_uri.get(&token_id).unwrap_or_default()
    }

    // ---------- internals ----------

    fn mint_internal(&mut self, controller: Address, token_uri: String) -> u64 {
        let token_id = self.next_id.get_or_default();
        self.next_id.set(token_id + 1);

        self.owner_of.set(&token_id, controller);
        self.wallet_of_agent.set(&controller, token_id);
        if !token_uri.is_empty() {
            self.token_uri.set(&token_id, token_uri);
        }
        token_id
    }
}

#[cfg(test)]
mod tests {
    use super::AgentId;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn mint_and_rotate() {
        let env = odra_test::env();
        let mut contract = AgentId::deploy(&env, NoArgs);

        let alice = env.get_account(0);
        let bob = env.get_account(1);

        env.set_caller(alice);
        let token_id = contract.mint_self("0g://root1".to_string());
        assert_eq!(contract.owner_of(token_id), Some(alice));
        assert_eq!(contract.wallet_of_agent(alice), token_id);

        contract.rotate(token_id, bob);
        assert_eq!(contract.owner_of(token_id), Some(bob));
        assert_eq!(contract.wallet_of_agent(alice), 0);
        assert_eq!(contract.wallet_of_agent(bob), token_id);
    }
}
