# Ligis — Agent Notes

## Security floor

CI blocks `main` on any remaining **high/critical** npm advisory:
`node scripts/security-audit.mjs` (self-test: `--self-test`, raw list:
`pnpm run audit:deps:all`). Fix rules:

- **Direct dep** → normal version bump.
- **Transitive** → add a `pnpm.overrides` floor (root `package.json`), e.g.
  `"follow-redirects": ">=1.16.1"`. Floors are `>=` security floors, not
  pins — Dependabot bumps above them are legitimate (see dependabot.yml).
- **Unfixable transitive** (no reachable patch) → dismiss by policy in BOTH
  `.github/dependabot.yml` (`ignore`) and `scripts/security-audit.mjs`
  (`DISMISSED`) — the lists are mirrored; CI blocks on a dismissal that
  exists in only one file. Current dismissals: uuid (GHSA-w5hq-g745-h8pq),
  decode-uri-component (GHSA-vcc3-ghjq-m6fr) — wallet-SDK client-side
  transitives.

## 0G Compute

**Default provider:** Qwen 2.5 7B
(`0xa48f01287233509FD694a22Bf840225062E67836` on Galileo testnet).

Changed from Gemma 3 27B (`0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08`) which
was unreachable (compute-network-8.integratenetwork.work down since mid-2026).

Qwen 2.5 7B requires ≥1.0 OG minimum reserve in provider ledger balance. Run
the following once per wallet to set up:

```bash
export $(grep -v '^#' .env.d/zerog.env | grep -v '^$' | xargs)
npx tsx -e "
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
const QWEN = '0xa48f01287233509FD694a22Bf840225062E67836';
const provider = new ethers.JsonRpcProvider(process.env.ZEROG_RPC_URL);
const wallet = new ethers.Wallet(process.env.ZEROG_PRIVATE_KEY, provider);
const broker = await createZGComputeNetworkBroker(wallet);
broker.ledger.addLedger(5);
broker.inference.acknowledgeProviderSigner(QWEN);
broker.ledger.transferFund(QWEN, 'inference', ethers.parseEther('1.5'));
console.log('0G Compute ready with Qwen 2.5 7B');
"
```

If 0G Compute is unavailable (network issues, service down), the CLI and
web steward automatically fall back to `LocalReasoner` (keyword-based
matching). The fallback is labeled in output as `model: "local-keyword-match"`.

## Reasoner chain (`LIGIS_REASONER_CHAIN`)

Every steward surface — CLI, MCP server, and web (`steward.ts` +
`steward-casper.ts`) — resolves its `Reasoner` through
`resolveReasonerChain(spec, registry)` in `@ligis/core`
(`src/reasoner-select.ts`). Spec is a comma-separated ordered fallback;
`--reasoner` flag > `LIGIS_REASONER_CHAIN` > `LIGIS_REASONER` > default
`zerog,local`. Entries:

- `zerog` (aliases `0g`, `0g-compute`) — 0G Compute TEE inference; skipped
  when `ZEROG_PRIVATE_KEY` is unset (`tryLoadZeroGConfig()`)
- `local` — `LocalReasoner` keyword matching
- `qwen-max` (aliases `qwen`, `qwen3-max`, `qwen-3.8-max`) — Alibaba Model
  Studio via OpenAI-compatible endpoint; needs `DASHSCOPE_API_KEY`
  (or `ALIBABA_API_KEY`), optional `LIGIS_QWEN_MODEL` / `LIGIS_QWEN_BASE_URL`
- `kimi` (alias `moonshot`) — Moonshot AI; needs `MOONSHOT_API_KEY`,
  optional `LIGIS_KIMI_MODEL` / `LIGIS_KIMI_BASE_URL` (`.cn` keys need the
  `.cn` endpoint)
- `openai-compat` — any OpenAI-compatible provider; needs
  `OPENAI_COMPAT_API_KEY` + `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_MODEL`

`OpenAICompatReasoner` always reports `verified: false` — only 0G's TEE path
is verifiable — and echoes the served model id, so receipts show e.g.
`provider: "alibaba-dashscope"`. Unknown chain names throw; unconfigured
entries are skipped. `LIGIS_REASONER_TIMEOUT_MS` sets the remote timeout
(default 30s).

## Topic notes

Read the ones relevant to your task before you start.

| Working on                                                                 | Read                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Casper contracts, deploys, Casper demos, x402 demo, testnet budget         | [docs/agent-notes/casper.md](docs/agent-notes/casper.md)                                 |
| GenLayer JobEscrow, `/genlayer`                                            | [docs/agent-notes/genlayer.md](docs/agent-notes/genlayer.md)                             |
| Web app: chain switching, chain-agnostic reads, issuer desk, motion system | [docs/agent-notes/web.md](docs/agent-notes/web.md)                                       |
| Zcash shielded channel, `/zcash`                                           | [docs/agent-notes/zcash.md](docs/agent-notes/zcash.md)                                   |
| Monad testnet demos                                                        | [docs/agent-notes/monad.md](docs/agent-notes/monad.md)                                   |
| CROO provider on the Vultr server: deploy, health check, keys, env vars    | [docs/agent-notes/croo.md](docs/agent-notes/croo.md)                                     |
| Jev intent layer, gate fingerprint, watchdog, demo credentials             | [docs/agent-notes/jev.md](docs/agent-notes/jev.md)                                       |
| `/arena` demo                                                              | [docs/agent-notes/arena.md](docs/agent-notes/arena.md)                                   |
| MetaMask Agent Wallet plugin, Airwallex procurement controller             | [docs/agent-notes/wallet-and-procurement.md](docs/agent-notes/wallet-and-procurement.md) |

New event-specific work goes in an adapter or example package and its
notes go in `docs/agent-notes/`, not in `packages/core` or this file.
