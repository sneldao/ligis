# Monad — testnet demos

### Monad Testnet Demos

Four live scripts against Monad testnet (chainId 10143). Each writes a
`.lastrun.txt` with tx hashes for explorer links, and exits non-zero on any
checked failure. Contracts come from `assets/networks.json`
`deployment["monad-testnet"]`.

```bash
set -a && source .env.d/deployer.env && set +a
export LIGIS_NETWORK=monad-testnet PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
export LIGIS_STEWARD_KEY=$PHAROS_DEPLOYER_KEY

npx tsx scripts/monad-lifecycle-demo.ts   # issue → GO → revoke → STOP
npx tsx scripts/monad-erc8004.ts          # ERC-8004 identity + gate feedback
npx tsx scripts/monad-passkey-issue.ts    # WebAuthn/P256 issuance (0x0100)
```

`monad-erc8004.ts` also needs `source .env.d/zerog.env` and refuses to write
feedback from the agent-owner key — feedback must come from the oracle key.

`monad-x402-demo.ts` is the payment story and needs the gate server first:

```bash
set -a && source .env.d/deployer.env && source .env.d/zerog.env && set +a
export LIGIS_X402_NETWORK=monad-testnet
export LIGIS_GATE_PAY_TO=0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec
export LIGIS_X402_ASSET=0x16f6bD0c285a630fe72275909c0f5815d276E2f4
npx tsx packages/x402-server/src/index.ts &        # :4040
export LIGIS_X402_PAYER_KEY=$ZEROG_PRIVATE_KEY
npx tsx scripts/monad-x402-demo.ts                 # 402 → 200 → revoke → 401
```

Key points:

- **`isCapable()` counts credentials from every issuer, and only an issuer can
  revoke its own.** A subject holding a third-party credential can therefore
  never be driven to `false`. The lifecycle demo issues to a dedicated subject
  (`LIGIS_MONAD_SUBJECT`, default `0x…decaf`) for exactly this reason — do not
  "simplify" it back to the controller.
- **Revoking only the newest nonce is not enough.** `isCapable()` falls back to
  the newest still-valid nonce, so both demos scan and withdraw _every_ live
  credential. Keep the scan window wide enough to cover all nonces the subject
  has accumulated, or the revoke leg silently finds nothing.
- The public RPC is limited to ~15 req/s. Pace nonce scans (~90–150ms) or they
  fail with a rate-limit error.
- Both lifecycle and x402 demos assert `gateBefore=true gateAfter=false`.
  Treat a failure there as a real regression, not a flake.
