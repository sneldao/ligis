# Zcash — shielded presentation channel

### Zcash Shielded Presentation Channel (Zecathon 2026)

`ZcashChainAdapter` in `@ligis/adapter-zcash` (`packages/adapter-zcash/src/zcash.ts`) implements
`ChainAdapter` for Zcash shielded addresses (`u1…`, `utest1…`, `zs1…`,
`ztestsapling1…`). It bridges the public capability credential model to
private shielded spend:

- **Viewing-Key Selective Disclosure (Week 1):** Verified off-chain via
  registered disclosures or Zebra/zcashd `z_listreceivedbyaddress` memo
  inspection (`encodeZcashMemoAttestation` / `parseZcashMemoAttestation`).
- **Nullifier Replay Protection:** Replaying an already-spent nullifier
  reports `revoked: true, capable: false` so replay attempts trigger a hard
  `STOP`.
- **Smoke test:** `npx tsx scripts/smoke-demo-credentials.ts zcash-testnet`
  (checks verified shielded payee → `go`, replayed nullifier → `revoked`,
  and unverified shielded address → `none`).
- **Demo script:** `pnpm demo:zcash` (or `npx tsx scripts/zcash-shielded-demo.ts`)
  walks through viewing-key selective disclosure → gate `GO` → shielded transfer
  → nullifier replay attempt → gate `STOP`, writing `scripts/lastrun/zcash-shielded-demo.lastrun.txt`.
