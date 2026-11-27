# Web — chain switching, reads, issuer desk, motion system

### Web Chain Switching (Pharos ↔ Casper)

The web frontend supports switching between Pharos Atlantic and Casper Testnet
via the `?chain=` query parameter. All pages are chain-aware:

- `web/lib/chain.ts` — EVM read layer (viem + Pharos contracts)
- `web/lib/chain-casper.ts` — Casper read layer (CasperAdapter + block scanning)
- `web/lib/chain-router.ts` — unified dispatch, branches on `chain.kind`

Information architecture (see `web/DESIGN.md`): `/` is editorial landing,
`/field` is the immersive registry (semantic zoom, Esc to leave), `/gate` is
the verb. The dock names only Gate and Field; moat routes live in ⌘K.

Key points:

- Casper addresses use `account-hash-...` format (not `0x...`)
- Casper has no EVM-style event logs; issuer activity and capability history
  are reconstructed by scanning recent blocks for `issue`/`revoke` transactions
- Server actions (`web/app/actions.ts`) accept `chainId` via hidden form field
- The steward API route already branches: `stewardLoopCasper` vs `stewardLoop`

Required Vercel env vars for Casper reads:
`LIGIS_CASPER_RPC_URL`, `LIGIS_CASPER_NETWORK`, `LIGIS_CASPER_AGENT_ID`,
`LIGIS_CASPER_CREDENTIAL_REGISTRY`. For live writes also set
`LIGIS_CASPER_DEPLOYER_PUBKEY` and `LIGIS_CASPER_DEPLOYER_PRIVATE_KEY`.
For the Casper self-issued check (`web/lib/verify.ts`) also set
`LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH` and `LIGIS_CASPER_DEPLOYER_EVM_ADDRESS`
— without them the check logs a warning and is skipped (fail-open).

### Chain-agnostic reads + issuer desk (Monad-era product layer)

- Chains now: Pharos Atlantic, Casper Testnet, Monad testnet
  (`web/lib/network.ts`, `DEFAULT_CHAIN` = Monad).
- **`?chain=` absent means resolve everywhere** (`web/lib/resolve.ts`,
  union semantics, per-chain provenance). `/gate`, the landing verify read,
  and `/embed/verify` all default to resolution; `?chain=` scopes for
  demos/debug. Subject format drives candidates: `0x…` → EVM chains,
  `account-hash-…` → Casper.
- `/vouch` — issuer desk: steward key signs EIP-712 `issue` / `revoke` on
  EVM registries (`web/lib/vouch.ts`, `vouchIssue`/`vouchRevoke` server
  actions in `web/app/actions.ts`). Needs `LIGIS_STEWARD_KEY` on Vercel;
  source `.env.d/steward.env` locally for writes.
- `server-only` is a real web dep now — direct `tsx` tests of server modules
  fail without it.
- The whole web suite runs under `--conditions=react-server`
  (`pnpm --filter @ligis/web test`), where the `server-only` guard is a no-op so
  `bodyToIntent` / `queryToIntent` / `runGateDecision` import for real. Root
  `pnpm run test:ts` delegates to it rather than globbing `web/test/**` itself —
  the `@/*` alias only resolves from the `web` cwd.
  (Intent parsing lives in `web/lib/gate-intent.ts` and execution in
  `web/lib/gate-run.ts` — not `route.ts`, where Next's generated route types
  reject non-route exports and break `next build`.)
- `/api/gate` GET accepts the same mandate the form writes:
  `mandatePayees` (comma-separated), `mandateMaxUsd`, `mandateExpectedUsd`.
- Counters honor `LIGIS_COUNTERS_DIR` and default to `/tmp/.ligis` on Vercel.
  Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash/Vercel KV REST) for
  durable counts — `record()` stays sync, `aggregateAsync()` reads the
  backend, `/admin/counters` shows which is active.
- Decision → receipt mapping (`web/lib/decision-receipt.ts`): right-payee
  and right-amount → `policy`, in-scope → `identity`, verified-payee →
  `capability`. SKIPPED folds to `unknown` and is kept, so the receipt shows
  what didn't answer. `GateDecision` renders it as a collapsible "Signal
  ledger" via the shared `SignalStack`.
- `pnpm --dir web smoke:ssr` defaults `BASE_URL=http://127.0.0.1:3000` —
  other dev servers squat on 3000; run with
  `BASE_URL=http://127.0.0.1:3001` against the Ligis dev server.
- `scripts/smoke-demo-credentials.ts` and `web/lib/demo-subjects.ts` must
  stay in sync (no cross-import — server-only modules can't be imported
  by root scripts).

## Web motion + specimen system

- `SubjectSpecimen` (`web/components/SubjectSpecimen.tsx`) renders the `/field`
  portrait for any subject string (EVM, Casper `account-hash-…`, or partial
  input — `lib/specimen.ts` normalizes it to a stable seed). Sizes: `plate`
  (verdicts) and `chip` (inline, used by `AddressDisplay`).
- Page choreography is global CSS keyed off `body.page-enter`,
  `.route-shell > *`, `h1.display`, and uppercase `border-terra` buttons — new
  routes get it by using those structures. All motion is gated by
  `prefers-reduced-motion: no-preference`.
- Don't use ✓/✗ glyphs in display text — the display font lacks them.
