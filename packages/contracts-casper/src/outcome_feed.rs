//! OutcomeFeed — append-only outcome/reputation receipts on Casper.
//!
//! The history axis of the Ligis trust substrate (docs/casper-forward.md
//! M2). Where CredentialRegistry answers "may it", OutcomeFeed answers
//! "is it any good": counterparty outcomes (settled payments, disputes,
//! rejected deliveries) anchored per (subject, claim_hash) so reputation
//! is a registry-level read every cohort project consumes for free.
//!
//! Design notes:
//!   - Receipts are hashes of off-chain evidence (0G manifest, payment
//!     tx, adjudication verdict). Heavy data stays off-chain; the chain
//!     carries the commitment.
//!   - `record_outcome` is permissionless in v1 — anyone may anchor an
//!     outcome, but the reporter address is stored so reputation
//!     weighting (issuer diversity, counterparty trust) is derived
//!     off-chain by the indexer, not trusted from a single writer.
//!   - Aggregates (settled count, dispute rate, last outcome) are
//!     maintained on-chain so consumers don't need the indexer for a
//!     first-pass signal.

use odra::prelude::*;
use odra::casper_types::bytesrepr::ToBytes;

pub const OUTCOME_SETTLED: u8 = 0;
pub const OUTCOME_DISPUTED: u8 = 1;
pub const OUTCOME_REJECTED: u8 = 2;
pub const OUTCOME_OTHER: u8 = 3;

/// Per-(subject, claim_hash) aggregate counters.
#[odra::odra_type]
pub struct OutcomeStats {
    pub total: u64,
    pub settled: u64,
    pub disputed: u64,
    pub rejected: u64,
    pub last_kind: u8,
    pub last_ts: u64,
}

/// A single anchored receipt.
#[odra::odra_type]
pub struct ReceiptView {
    pub seq: u64,
    pub kind: u8,
    pub receipt_hash: [u8; 32],
    pub reporter: [u8; 20],
    pub ts: u64,
}

#[odra::module]
pub struct OutcomeFeed {
    /// (subject, claim_hash) → aggregate counters.
    stats: Mapping<([u8; 32], [u8; 32]), OutcomeStats>,
    /// (subject, claim_hash, seq) → receipt_hash (audit trail).
    receipts: Mapping<([u8; 32], [u8; 32], u64), [u8; 32]>,
    /// Full receipt views keyed by the same triple for reporter/kind reads.
    receipt_meta: Mapping<([u8; 32], [u8; 32], u64), ReceiptView>,
}

#[odra::module]
impl OutcomeFeed {
    pub fn init(&mut self) {}

    /// Anchor an outcome receipt. `kind` is one of OUTCOME_*; anything
    /// else counts as OUTCOME_OTHER. Receipts are append-only — there is
    /// deliberately no delete or edit path.
    pub fn record_outcome(
        &mut self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
        kind: u8,
        receipt_hash: [u8; 32],
    ) {
        let key = (subject, claim_hash);
        let ts = self.env().get_block_time();
        let reporter = caller_to_evm_bytes(&self.env().caller());

        let mut s = self.stats.get(&key).unwrap_or(OutcomeStats {
            total: 0,
            settled: 0,
            disputed: 0,
            rejected: 0,
            last_kind: OUTCOME_OTHER,
            last_ts: 0,
        });

        s.total += 1;
        match kind {
            OUTCOME_SETTLED => s.settled += 1,
            OUTCOME_DISPUTED => s.disputed += 1,
            OUTCOME_REJECTED => s.rejected += 1,
            _ => {}
        }
        s.last_kind = kind;
        s.last_ts = ts;
        let seq = s.total;
        self.stats.set(&key, s);
        self.receipts.set(&(subject, claim_hash, seq), receipt_hash);
        self.receipt_meta.set(
            &(subject, claim_hash, seq),
            ReceiptView { seq, kind, receipt_hash, reporter, ts },
        );
    }

    /// Aggregate counters for a (subject, claim_hash) pair.
    pub fn outcome_stats(&self, subject: [u8; 32], claim_hash: [u8; 32]) -> Option<OutcomeStats> {
        self.stats.get(&(subject, claim_hash))
    }

    /// Fetch one anchored receipt by sequence number (1-based).
    pub fn receipt_at(
        &self,
        subject: [u8; 32],
        claim_hash: [u8; 32],
        seq: u64,
    ) -> Option<ReceiptView> {
        self.receipt_meta.get(&(subject, claim_hash, seq))
    }

    /// Receipt count for a pair (cheap total without stats struct).
    pub fn receipt_count(&self, subject: [u8; 32], claim_hash: [u8; 32]) -> u64 {
        self.stats
            .get(&(subject, claim_hash))
            .map(|s| s.total)
            .unwrap_or(0)
    }
}

/// Best-effort conversion of an Odra Address to the 20-byte EVM-style
/// reporter address used elsewhere in the system (trailing bytes of the
/// serialized address, matching address_to_subject_key conventions).
fn caller_to_evm_bytes(addr: &Address) -> [u8; 20] {
    let bytes = addr.to_bytes().unwrap_or_default();
    let mut out = [0u8; 20];
    let n = bytes.len();
    if n >= 20 {
        out.copy_from_slice(&bytes[n - 20..]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{OutcomeFeed, OutcomeFeedHostRef};
    use odra::host::{Deployer, NoArgs};

    const SUBJECT: [u8; 32] = [0x11; 32];
    const CLAIM_HASH: [u8; 32] = [0x22; 32];
    const RECEIPT: [u8; 32] = [0x33; 32];

    fn deploy(env: &odra::host::HostEnv) -> OutcomeFeedHostRef {
        OutcomeFeed::deploy(env, NoArgs)
    }

    #[test]
    fn record_and_read_stats() {
        let env = odra_test::env();
        let mut feed = deploy(&env);

        assert_eq!(feed.receipt_count(SUBJECT, CLAIM_HASH), 0);
        assert!(feed.outcome_stats(SUBJECT, CLAIM_HASH).is_none());

        feed.record_outcome(SUBJECT, CLAIM_HASH, 0, RECEIPT);
        feed.record_outcome(SUBJECT, CLAIM_HASH, 1, [0x44; 32]);
        feed.record_outcome(SUBJECT, CLAIM_HASH, 0, [0x55; 32]);

        let stats = feed.outcome_stats(SUBJECT, CLAIM_HASH).unwrap();
        assert_eq!(stats.total, 3);
        assert_eq!(stats.settled, 2);
        assert_eq!(stats.disputed, 1);
        assert_eq!(stats.rejected, 0);
        assert_eq!(feed.receipt_count(SUBJECT, CLAIM_HASH), 3);

        let r1 = feed.receipt_at(SUBJECT, CLAIM_HASH, 1).unwrap();
        assert_eq!(r1.kind, 0);
        assert_eq!(r1.receipt_hash, RECEIPT);
        assert!(feed.receipt_at(SUBJECT, CLAIM_HASH, 4).is_none());
    }

    #[test]
    fn pairs_are_isolated() {
        let env = odra_test::env();
        let mut feed = deploy(&env);
        feed.record_outcome(SUBJECT, CLAIM_HASH, 0, RECEIPT);
        assert!(feed.outcome_stats([0x99; 32], CLAIM_HASH).is_none());
        assert!(feed.outcome_stats(SUBJECT, [0x88; 32]).is_none());
    }
}
