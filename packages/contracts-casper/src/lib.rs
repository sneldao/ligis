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
//! Signature verification uses `casper-eip-712` for EIP-712 typed-data
//! digests + the host's secp256k1 recovery, so credentials issued by the same
//! key on Pharos verify identically here.

#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod agent_id;
pub mod credential_registry;
