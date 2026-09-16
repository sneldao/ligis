# `@ligis/adapter-genlayer`

Ligis gate + GenLayer JobEscrow demo runner for Agent Tank.

## Exports

| Export                                  | Stream | Role                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------- |
| `checkLigisGate` / `refuseIfNotCapable` | 2      | Live Casper/Pharos → `GateReceipt`                      |
| `runJobEscrowDemoViaPython`             | 3      | Full Studio Next lifecycle via `deploy.py`              |
| `createJobEscrowClient`                 | 3      | Address-validated stub (points at `pnpm demo:genlayer`) |
| Studio Next constants                   | 0      | Re-exported from `@ligis/core`                          |

## Judge repro

```bash
set -a && source .env.d/casper.env && set +a
pnpm demo:genlayer --dry-run
pnpm demo:genlayer --mock-gate   # needs: pip install -r packages/contracts-genlayer/requirements.txt
pnpm demo:genlayer
```

See [`docs/genlayer-interface-v1.md`](../../docs/genlayer-interface-v1.md).
