//! Ligis contracts for Casper Network.
//!
//! This crate is a 1:1 port of the EVM contracts in
//! `packages/contracts-evm/src`:
//!
//!   - `agent_id`            ↔ `PharosAgentID.sol`     (portable agent identity)
//!   - `credential_registry` ↔ `CredentialRegistry.sol` (EIP-712 capability creds)
//!
//! The on-chain logic mirrors the EVM contracts so that a capability hash
//! computed off-chain (`keccak256("kyc.basic")`) lands on the same dictionary
//! key here as on EVM. Cross-chain credential portability depends on this.
//!
//! Credentials are signed off-chain with secp256k1 using the same EIP-712
//! layout as on Pharos, so the same issuer key produces the same signature
//! bytes on both chains. The Casper contract recovers the issuer address
//! on-chain for both `issue` and `revoke` using the pure-Rust `k256` crate.

#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod agent_id;
pub mod credential_registry;
pub mod gated_vault;
