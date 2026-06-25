# Trust Steward Agent

The Trust Steward is an autonomous agent whose natural-language → capability reasoning runs as an LLM call on **0G Compute** (TEE-verified inference) and whose state and credential evidence live on **0G Storage**, gated end-to-end by Ligis's on-chain identity and credentials.

> **0G does real work (not a bolt-on).** The goal→capability mapping is performed by an LLM running on 0G Compute, not by a hardcoded lookup — the TEE attestation is captured and recorded as evidence. Remove 0G Compute and the Agent loses its reasoning step; remove 0G Storage and it loses its verifiable evidence store. Either way it cannot complete the loop.

## Steward loop

1. **Boot** → `mintSelf` its own `PharosAgentID` (if it doesn't already have one).
2. **Reason** → sends the natural-language goal to 0G Compute (TEE-verified LLM), which maps it to required capabilities.
3. **Gate** → checks `isCapable` for each required capability.
4. **Act** → self-issues any missing credentials (signs with its own key, submits on-chain).
5. **Re-gate** → verifies all capabilities are now held.
6. **Record** → writes the evidence manifest (goal, reasoning, capabilities, tx hashes) to 0G Storage, then anchors the Merkle root hash on-chain via `setTokenURI`.

The primary demo path is **self-contained**: the Steward issues itself a capability credential, gates a self-test action via `isCapable`, then records it — no external contract dependency.

## 0G dependencies

| Layer | Package | Notes |
|-------|---------|-------|
| Compute | `@0gfoundation/0g-compute-ts-sdk` | TEE-verified LLM inference. One-time setup via `setupProvider()` (deposit → acknowledge provider). |
| Storage | `@0gfoundation/0g-storage-ts-sdk` (v1.2.6) | Upload/retrieve evidence manifests. Uses `Indexer` + `MemData` for in-memory JSON; returns a Merkle root anchored on-chain via `setTokenURI`. |

> The 0G Compute SDK's ESM build has a broken re-export. `compute.ts` imports via `createRequire` to use the working CJS build.

## Build phases

| Phase | Work | Status |
|-------|------|--------|
| 0 | Consolidate CLI + MCP on-chain ops into `lib/` | ✅ DONE |
| 1 | `zerog/compute.ts` — TEE-verified inference | ✅ DONE |
| 2 | `zerog/storage.ts` — evidence on 0G Storage, root in `tokenURI` | ✅ DONE |
| 3 | `agent/steward.ts` + `agent/policy.ts` — full loop | ✅ DONE |
| 4 | `agent run` CLI + `run-steward` MCP tool + `node:test` units | ✅ DONE |

## Design constraints

- **DRY** — one implementation of each on-chain op in `lib/`; CLI, MCP, and Agent all import from it.
- **No contract changes** — 0G Storage is anchored via the existing `setTokenURI` / `MetadataUpdated` path. The 41 Foundry tests stay green.
- **Testable** — `Reasoner` and `EvidenceStore` are interfaces. The agent is fully testable offline with mocks (17 TypeScript tests).
- **Resilient** — if 0G Storage fails, the manifest is still returned with `storage: null`. The agent doesn't crash; it records what it can.

## Usage

```bash
# Dry run — reason + gate only, no on-chain writes
PRIVATE_KEY=0x... ZEROG_PRIVATE_KEY=0x... \
  pnpm start -- agent run --goal "open an escrow" --dry-run

# Full run
PRIVATE_KEY=0x... ZEROG_PRIVATE_KEY=0x... \
  pnpm start -- agent run --goal "open an escrow"
```

See [Setup](setup.md) for 0G wallet initialization.
