# @ligis/metamask-plugin

Ligis guarded-pay plugin for the MetaMask Agent Wallet. Adds two commands:

- `mm ligis pay` — builds an EIP-3009 `TransferWithAuthorization`, asks the
  Ligis gate under protected operator policy, and signs through the host
  executor (`ctx.walletExecutor`) only after a fresh, schema-valid `GO` bound
  to that exact operation.
- `mm ligis assess` — the same binding + gate call, without signing. Reports
  the verdict and whether it would have cleared the operator confidence floor.

## Scope — read this before relying on it

This is a **command-scoped guard, not wallet-wide enforcement**. The Agent
Wallet plugin lifecycle is sealed: plugins cannot override `run` /
`beforeExecute`, and `oclif.hooks` manifests are rejected. `ligis:pay` governs
only its own signing path. `mm transfer`, `mm swap`, and every other command
bypass the gate entirely — that is a host-architecture fact, not a bug this
package can fix. See `docs/wallet-enforcement.md` for the full threat model.

## Trust boundary

- The **operator policy** is the protected half: it comes from the operator's
  environment (`LIGIS_WALLET_POLICY` inline JSON, `LIGIS_WALLET_POLICY_FILE`
  path, or `--policy <path>`), never from the agent's request. No policy →
  `policy-missing` → nothing signs.
- The **mandate flags** (`--mandate-max-usd`, `--mandate-max-seconds`,
  `--mandate-capability`) are untrusted and may only _tighten_ policy.
  Anything looser → `agent-policy-loosening`.
- The gate endpoint is never caller-selectable; it is read from the policy.
- Refusal codes: `policy-missing`, `agent-policy-loosening`,
  `unsupported-operation`, `policy-refused`, `decision-unavailable`,
  `decision-malformed`, `decision-timeout`, `decision-not-go`,
  `stale-approval`, `signer-failed` — all fail closed, all before signing.

## Install (dev)

```bash
pnpm build                       # tsc + oclif manifest
mm plugins install ./packages/metamask-plugin
```

Then, with a policy file (shape in `docs/wallet-enforcement.md`):

```bash
export LIGIS_WALLET_POLICY_FILE=./policy.json
mm ligis assess --chain-id 10143 \
  --payee 0x… --value 5000000 --asset 0xUSDC \
  --purpose "buy oracle data"
mm ligis pay --chain-id 10143 \
  --payee 0x… --value 5000000 --asset 0xUSDC
```

`--value` is base units (whole tokens only — `5000000` = 5 USDC at 6
decimals). `--from` defaults to the wallet's selected EVM account
(`wallet-read`). Manifest capabilities: `ligis:pay` = `wallet-submit` +
`wallet-read`; `ligis:assess` = `wallet-read`.

## Known limitations

- **Validity units.** `validAfter`/`validBefore` are unix **seconds**
  end-to-end — the EIP-3009 on-chain unit. `createPaymentGuard` converts its
  ms-epoch clock once in `parseOperation`, so the values the guard binds are
  exactly what settles on-chain.
- The signature the host returns is an in-memory EIP-712 signature — it
  proves wallet possession at assessment time; broadcast/settlement is a
  separate step the command does not perform.
- `ligis:assess` is informational: `wouldSign` reflects the policy floor at
  call time; `ligis pay` always re-assesses against a fresh decision.

## Tests

```bash
pnpm test   # 9 tests — mock executor + fake gate transport, no wallet/funds
```

Covers the executor bridge (exact typed-data envelope, denial→refusal), and
the end-to-end guarded path: GO signs once through the executor; STOP,
UNKNOWN, malformed decisions, and sub-floor GO never reach it.
