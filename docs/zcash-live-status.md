# Zcash integration status

Date: 2026-10-25
POC: Ligis Zecathon integration
TL;DR: Live shielded note retrieval and decryption work on testnet. The pinned UltraHonk WASM verifier passes local valid-proof and tampering tests without a native binary. Deployment verification and a wallet-controlled post-GO transfer remain pending.

## Reproduce the live read

```bash
pnpm --filter @ligis/core build
pnpm demo:zcash
LIGIS_ZCASH_LIVE=1 node --import tsx --test packages/core/test/zcash-lwd.test.ts
```

The Node light client uses `CompactTxStreamer` over TLS/HTTP2 at
`https://testnet.zec.rocks:443`. The captured transaction fixture supports
repeatable offline decryption tests. This code does not sync or run a full node.

Transaction: `d2b389c8fd108561f3cdc45cfcb373e7474dbb8804368fcd560135f9cb443f90`.
The light server reports inclusion at height 4,540,356. The decrypted Ironwood
note contains 100,000,000 zatoshis (1 TAZ) and a `LIGIS:v1:` JSON memo.
Faucet request: `01M5SKS8EGMJ3MK633ED1ZJ02P` at
<https://fauzec.com/api/v1/status/testnet/01M5SKS8EGMJ3MK633ED1ZJ02P>.

The faucet sent this transaction. Ligis did not build, sign, or release it after
a GO. Public deterministic keys were used, so this receipt demonstrates note
decryption, not confidentiality against someone who has those keys. Never send
mainnet ZEC to these addresses. Viewing keys disclose incoming activity and must
not be published for real users.

## Security boundaries

- `readLiveAttestation` returns an untrusted memo claim. It does not register a
  credential or grant a capability. Any sender can put an issuer address in a
  memo; decrypting that memo does not authenticate the issuer.
- The light server supplies transaction bytes and inclusion height. The client
  does not independently prove chain inclusion or consensus validity.
- The TypeScript reader matches the note diversifier to the address receiver;
  it does not rederive `pk_d` or validate the note commitment. It is a disclosure
  prototype, not a complete payment-proof verifier.
- The action's input nullifier identifies a spent input, not the new received
  note's future nullifier. It is unrelated to the Ligis application replay tag.
- Node-only APIs are exported under `@ligis/core/zcash-lwd`.
- Web reads disable built-in credential fixtures unless
  `LIGIS_ZCASH_DEMO_FIXTURES=1` is explicitly set. Live block-height reads do not
  make fixture credentials live or discover a wallet's notes.
- Core local replay bookkeeping is process-local. The web ZK gate has a separate
  atomic KV option; a production deployment needs durable replay protection.

## Remaining work before a complete payments claim

1. Verify pinned UltraHonk proofs in the deployed runtime, with tampering and
   unavailable-verifier tests. Native `bb` verification currently works locally;
   the opt-in WASM backend is implemented and tested locally but not yet verified on Vercel.
   Set `LIGIS_ZK_VERIFIER=wasm` to select it. The exact pinned bb.js version is
   `5.0.0-nightly.20260522`. Cold initialization downloads CRS to a writable
   temporary cache; this must be checked in the deployed runtime. Run
   `LIGIS_ZK_TEST_WASM=1 pnpm --filter @ligis/circuits-zcash exec tsx --test test/wasm-verifier.test.ts`
   to reproduce valid-proof, altered-root, and altered-proof checks.
   This backend verifies proofs only; it does not provide serverless proving.
2. Use an authenticated issuer/registry proof for authorization. Keep unsigned
   memo reads out of the verified-payee decision.
3. Build a testnet wallet executor with fresh private keys. Bind approval to the
   exact recipient, amount, network, and request, and prohibit sends after STOP
   or UNKNOWN. Handle ambiguous broadcasts without automatic duplicate sends.
4. Record a new post-GO transaction and confirmation. Keep the faucet receipt
   separate from that evidence.
5. Run web build, browser QA, and replay tests across instances before deploying.

## Submission provenance

Ligis predates Zecathon. The Zcash adapter, circuit package, and Zcash-specific
web integration began in the build window on October 25. Existing Ligis product
code and registries are reused. This disclosure does not establish eligibility:
the organizers must decide whether that reuse is permitted. Submit in exactly
one track, Shielded Payments, by October 28, 2026 at 23:59 UTC.
