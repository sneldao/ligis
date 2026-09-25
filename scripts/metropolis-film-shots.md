# Metropolis film shot list (Ready today)

Recorded for the 3-minute Metropolis demo. All beats use live Monad
testnet state — no mocks.

## Prep (once)

```bash
set -a && source .env.d/deployer.env && set +a
pnpm smoke:demo-credentials monad-testnet   # GO / revoked / none still honest
pnpm seed:field monad                       # field density if thin
```

Open two browser tabs:

1. `https://ligis.vercel.app/gate?chain=monad-testnet`
2. `https://ligis.vercel.app/field?chain=monad-testnet&enter=1`

Keep `scripts/monad-lifecycle-demo.lastrun.txt` handy for explorer links:

- issue: `0x5a48242c…e38eb6e4`
- revoke: `0xc6423b94…c7bd8980`
- capability: `demo.metropolis.revocation`

## Shot list (~3 min)

| #   | Beat           | Surface                              | Action                                                 | Hold |
| --- | -------------- | ------------------------------------ | ------------------------------------------------------ | ---- |
| 1   | Cold open      | `/gate?chain=monad-testnet`          | Click **verified agent** → ✓ GO                        | 8s   |
| 2   | Revocation     | same                                 | Click **revoked credential** → ✗ STOP (revoked)        | 12s  |
| 3   | Unverified     | same                                 | Click **unverified wallet** → ✗ STOP (none)            | 6s   |
| 4   | Same hash      | voice + gate capability line         | Say: same `capabilityHash` as Casper/Pharos            | 5s   |
| 5   | Field          | `/field?chain=monad-testnet&enter=1` | Fly in; click a **LIVE** (terra) specimen → FocusPanel | 20s  |
| 6   | Dossier        | FocusPanel                           | Open dossier → credentials / history (Envio if set)    | 15s  |
| 7   | Explorer sting | Monad explorer                       | Paste revoke tx from lastrun; show success             | 10s  |
| 8   | Close          | gate GO sample again                 | “One read. Before money moves.”                        | 5s   |

## Optional insert (if time)

Re-run `pnpm demo:monad` in a terminal pane and cut to GO→STOP in the CLI
output, then refresh the gate revoked sample.

## Out of scope for this cut

- Browser wallet writes
- ERC-8004 / P256
- Mid-stream x402 kill on Monad

## Status

- Jev transport: still answering via AI Gateway at $0 (smoke 2026-09-25)
- Field: LIVE specimens from `listAgents` + `pnpm seed:field`
- Film capture: operator-run (this file is the shot list)
