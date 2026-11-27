# MetaMask plugin and Airwallex procurement controller

## MetaMask Agent Wallet plugin (`packages/metamask-plugin`)

Real oclif plugin for `mm` (agent-wallet 7.2.0): `mm ligis pay` signs an
EIP-3009 authorization through `ctx.walletExecutor` only after a fresh
schema-valid gate GO; `mm ligis assess` is the same binding without signing
(`requiresAuth=false` — runs logged-out with `--from`). Scope is
command-scoped, not wallet-wide — the host lifecycle is sealed
(`docs/wallet-enforcement.md`).

- SDK types quirk: the `/plugin` subpath `.d.ts` uses extensionless relative
  imports → the package compiles under `moduleResolution: Bundler`;
  `@metamask/agent-sdk/*` is bundled-not-published, shimmed in
  `src/agent-sdk-shims.d.ts`. Declaration emit is off (TS2742, pnpm paths).
- Validity fields `validAfter`/`validBefore` are unix **seconds**
  (EIP-3009 on-chain unit); the guard converts its ms-epoch `now` once in
  `parseOperation`. `decisionConfidence` ignores `SKIPPED` signals.
- Policy is operator-side: `LIGIS_WALLET_POLICY` (inline JSON),
  `LIGIS_WALLET_POLICY_FILE`, or `--policy <path>` — never from the agent.

Local dev link + live demo (recorded 2026-10-14, GO and STOP both live
against `https://ligis.vercel.app/api/gate`):

```bash
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins link "$PWD/packages/metamask-plugin" --accept-permissions
# Monad testnet demo asset: Ligis test USDC 0x16f6bD0c285a630fe72275909c0f5815d276E2f4
LIGIS_WALLET_POLICY_FILE=./policy.json mm ligis assess --chain-id 10143 \
  --payee 0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec --value 5000000 \
  --asset 0x16f6bD0c285a630fe72275909c0f5815d276E2f4 --from 0x1111... --json
```

`mm ligis pay` additionally needs `mm login` (MetaMask account auth) — not
yet exercised end-to-end.

### Airwallex procurement controller (`@ligis/procurement`)

PO-justified payouts over the Airwallex transfers rail. Ligis's executor is the
only thing holding Airwallex credentials — a STOP means the transfer API call
is never made. Checks whether a payment is still justified by the ORIGINAL
purchase order (supplier destination fingerprint, price tolerance, prior
attempts, mandate), not just whether the agent has budget.

```bash
node --import tsx --test packages/procurement/test/*.test.ts   # tests
pnpm --filter @ligis/procurement build                          # build
pnpm demo:airwallex                                             # fixture demo
# live sandbox: put AWX_CLIENT_ID + AWX_API_KEY (+ optional AWX_BENEFICIARY_ID)
# in .env.d/airwallex.env (see .env.d/airwallex.env.example)
```

Key invariants (asserted by the demo; exit non-zero on violation):

- STOP/REVIEW ⇒ zero new transfers; the rail is never touched.
- Never two PAID attempts for one invoice.
- Timeouts → attempt UNKNOWN, no auto-retry; reconcile by `request_id` first.
- Retries of a failed transfer use a NEW `request_id` and set `replaces`.
- Approvals bind exactly (orderId + invoiceRef + amount + fingerprint), single-use.
- Changed payout destination = hard STOP, never approvable. The check covers
  the request's fingerprint/beneficiary_id AND the live rail record —
  `getBeneficiaryFingerprint(id)` re-reads the beneficiary's bank_details;
  drift or lookup failure fails closed (STOP), never approvable.
- Ambiguous create errors → UNKNOWN (timeouts, 429, 5xx, network); only a
  definite 4xx rejection (400/401/403/404/422) marks the attempt CANCELLED as
  "rejected by rail: <code>". UNKNOWN never auto-retries.

Airwallex gotchas (confirmed against https://www.airwallex.com/docs):

- `transfers/create` requires `reason`, `reference`, `request_id`,
  `transfer_currency`; `transfer_amount` is a STRING; `beneficiary_id` is a
  top-level field; `transfer_method` LOCAL|SWIFT. No `payment_currency`.
- `GET /transfers?request_id=` is a supported server-side filter — reconcile
  ambiguous creates with it instead of listing everything.
- Failed transfers end `CANCELLED` (never `FAILED`) with
  `failure_type`/`failure_reason`.
- Sandbox simulation: `POST /api/v1/simulation/transfers/{id}/transition` body
  `{ next_status: SENT|PAID|FAILED|..., failure_type? }`.
- Auth: `POST /authentication/login` with `x-client-id`/`x-api-key` headers,
  no body → 30-min bearer. Rate limit 10 req/s per endpoint.
