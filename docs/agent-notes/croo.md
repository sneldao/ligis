# CROO provider deployment

**Current state (2026-11-27):** serving release `20261127_224757` at commit
`ad72439`, on the **v2 registry** (`contract-package-8ae86730…629f12`) with
`LIGIS_CHAIN=casper`. Server-side v2 verify passes. Rollback target:
`20260920_155016` (v1 registry, pre-JSON-RPC reads — rolling back restores
the v1 env requirement; the v2 env value stays in `/opt/ligis-croo/.env`).
Release `20260920_151844` pruned 2026-11-28. `20260920_155016` still on disk — prune candidate, not yet confirmed with the owner.

The CROO provider runs on the Vultr server (`nuncio-vultr`) under PM2.

**Layout:**

- `/opt/ligis-croo/current` → symlink to `releases/<timestamp>/`
- `/opt/ligis-croo/.env` — all secrets (CROO_SDK_KEY, Casper keys, service UUIDs)
- `/opt/ligis-croo/ecosystem.config.js` — PM2 config
- `/opt/ligis-croo/logs/` — stdout + stderr logs

**Deploy:**

```bash
ssh nuncio-vultr
cd /opt/ligis-croo/releases
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp -a /opt/ligis-croo/current/ releases/$TIMESTAMP/
cd releases/$TIMESTAMP
git fetch origin && git reset --hard origin/main
pnpm install --frozen-lockfile --filter @ligis/croo-adapter...
# Build the dependency chain first — the croo-adapter compiles against the
# dist/ output of @ligis/core, the chain adapters, and agent-logic. Skipping
# this fails with "has no exported member" errors from stale/missing dist.
pnpm --filter @ligis/core --filter @ligis/adapter-casper --filter @ligis/adapter-evm --filter @ligis/agent-logic run build
pnpm --filter @ligis/croo-adapter build
ln -sfn /opt/ligis-croo/releases/$TIMESTAMP /opt/ligis-croo/current
cd /opt/ligis-croo && pm2 restart ecosystem.config.js --update-env
# Verify the startup banner lists all four services and the new alias:
#   Services: ligis.risk, ligis.verify, ligis.issue, ligis.gate, ligis.qualify
#   Service alias: <uuid> -> ligis.gate
tail -15 /opt/ligis-croo/logs/out.log
```

**Health check:**

```bash
curl http://127.0.0.1:9430/health
# Returns: { uptime, delivered, errors, lastDeliveryAt, wsConnected, inFlight }
```

**Release hygiene:** keep only the serving release + one rollback target.
Prune with `rm -rf /opt/ligis-croo/releases/<old>` — never the one `current`
resolves to or the one the PM2 process cwd points at (check
`readlink -f /proc/$(pm2 pid ligis-croo)/cwd` first).

**CROO key convention (two files, never mix):**

- `.env.d/croo.env` + `/opt/ligis-croo/.env` → `CROO_SDK_KEY` = the **Ligis
  provider** key. Rotating it breaks the live provider. Do not rotate.
- `.env.d/croo-buyer.env` → `CROO_BUYER_SDK_KEY` = a **non-Ligis buyer** key
  (e.g. "Early, Not Wrong"), used only by `scripts/croo-gate-test-order.ts`.
  CROO rejects negotiating your own service, so test orders need a different
  agent's funded key. Rotate freely; nothing depends on it.

**Required env vars in `/opt/ligis-croo/.env`:**

- `CROO_SDK_KEY` — from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_RISK` — listing UUID from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_VERIFY` — listing UUID from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_ISSUE` — listing UUID from CROO Dashboard
- `CROO_SERVICE_ID_LIGIS_GATE` — listing UUID for `ligis.gate` (once registered in the Dashboard)
- `CROO_SERVICE_ID_LIGIS_QUALIFY` — listing UUID for `ligis.qualify` (once registered in the Dashboard)
- `LIGIS_SELF_ISSUABLE_CAPABILITIES` — optional, comma-separated capabilities
  that `ligis.issue` and `ligis.qualify` may mint without external evidence.
  **Leave unset in production.** It exists for demos on low-criticality
  capabilities (e.g. `data.premium`); allowlisting `kyc.basic` makes the
  credential meaningless because the weight-4 capability becomes buyable.
  The legacy name `LIGIS_QUALIFY_SELF_ISSUABLE` is still read as a fallback
  (canonical wins when both are set) so an existing deployment's allowlist
  survives the upgrade. To keep the current live demo working while `ligis.issue`
  requires evidence:
  `LIGIS_SELF_ISSUABLE_CAPABILITIES=agent.commerce.escrow,data.premium` —
  note this deliberately excludes `kyc.basic`.
- `LIGIS_CHAIN` — `casper` or `pharos`
- `LIGIS_ISSUER_PRIVATE_KEY` — hex private key for signing credentials (required for ligis.issue)
- `LIGIS_CASPER_KEY_PATH` — path to PEM file for casper-client CLI (required for ligis.issue on Casper)
- All `LIGIS_CASPER_*` vars from `.env.d/casper.env`
- Jev vars (`AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY`, plus `LIGIS_JEV_*`) — required for `ligis.gate` intent reads; without them the gate fails open and the intent block reports `SKIPPED` while the credential check still runs

**casper-client CLI (required for ligis.issue on Casper):**
The `submitCredential` function uses `casper-client` to submit signed
transactions to the Casper network. Install it on the server:

```bash
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
sudo apt-get install -y libssl-dev pkg-config
cargo install casper-client
sudo ln -sf $HOME/.cargo/bin/casper-client /usr/local/bin/casper-client
```

**PEM file generation (required for ligis.issue on Casper):**
The `casper-client` CLI requires a PEM key file. Generate it from the
deployer's hex private key:

```bash
node -e "
const fs = require('fs');
const { PrivateKey, KeyAlgorithm } = require('casper-js-sdk');
const pk = PrivateKey.fromHex(process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY, KeyAlgorithm.SECP256K1);
fs.writeFileSync('.env.d/casper-deployer.pem', pk.exportPrivateKeyInPem());
"
```

**Key implementation notes:**

- `ligis.qualify` is the funnel collapse: one order runs check → policy-gated
  issue → re-check and returns `entryVerdict`, `finalVerdict`, `issued`,
  `skipped`, and `verificationPending`. It reuses `buildRiskReport` (exported
  from `risk.ts`) so there is exactly one scoring implementation, and
  `credential-ops.ts` so there is exactly one mint path shared with
  `ligis.issue`. **Payment alone never mints trust** — every issuance is
  evidence-gated or allowlist-gated, and `ligis.issue` enforces the same rule so
  the gate can't be bypassed by hiring the cheaper service. A fresh credential is
  immature, so a successful run reports `warn` (maturing to `pass`), never a fake
  `pass`.
- A policy refusal is a **structured deliverable**, not an error: `ligis.issue`
  returns `{ issued: false, reason: "evidence-required", detail, evidenceShape,
note }` and signs nothing, so a refusal costs no gas. Both services word the
  refusal via `evidenceRequiredRefusal()` in `credential-ops.ts`.
- The re-check is bounded (`settleAttempts` x `settleDelayMs`, default of 2 x
  1500ms) because a just-submitted credential may not be readable yet and the
  provider kills handlers at 30s. Credentials that are submitted but not yet
  readable come back in `verificationPending` with their tx hashes rather than
  as a failure.
- Service IDs and prices live in `SERVICE_PRICE_USD` / `SERVICE_ID`
  (`packages/croo-adapter/src/services.ts`) and build the provider listings,
  `croo-store-manifest.json`, and every hint that quotes a price. Change a price
  there and in the CROO Dashboard together — the code is the promise, the
  Dashboard is the charge.

- CROO sends listing UUIDs as `service_id` in WebSocket events, not service
  names. The provider maps UUIDs via `CROO_SERVICE_ID_*` env vars.
- The `order_paid` WebSocket event is sparse (only `order_id` + `negotiation_id`).
  The provider fetches full negotiation details from the API and caches them.
- CROO wraps buyer requirements in a `{ text: "..." }` envelope.
  `parseServiceRequirements` unwraps it automatically.
- Orders are marked fulfilled only after successful delivery (with 3 retries).
- Idempotency DB at `~/.ligis/croo-idempotency.db` (SQLite, auto-pruned hourly).
