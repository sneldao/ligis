# Hermes Plugin Hackathon — Third Entry Plan: `ligis`

> **Status:** **built and verified live** 2026-11-11. Plan approved ~04:40 EST,
> plugin working end-to-end in a running Hermes session by ~06:10 EST.
> Deadline 5:00 PM EST today.
> **Decision:** ship a third entry (`ligis`) _after_ securing elcaro and lemma.
> **Recommended posture:** escalation-by-default with opt-in enforce (see §7).

---

## Build outcome (what actually happened)

| Gate                                   | Result                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hermes plugins validate .`            | **passed**, zero warnings, "security scan — safe", no python dependencies                                  |
| `hermes plugins doctor . --ci`         | **passed** — 4 tools, 1 hook                                                                               |
| `tests/test_ligis.py`                  | **60/60 pass** (offline, no network)                                                                       |
| `fixtures/selftest.py`                 | **4/4 fixtures reproduce live** from raw JSON-RPC                                                          |
| Catalog CI simulation on a clean clone | **all four gates pass** (validate, payload scan, self-updater grep, confinement)                           |
| Catalog entry structural validation    | **valid** (`validate_plugin_catalog.py`)                                                                   |
| **Live Hermes session**                | tools return correct values; **the gate blocked an uncredentialed payment and allowed a credentialed one** |
| **Catalog PR**                         | **#153409** open, pinned `8986a62`                                                                         |

**Three real bugs found and fixed by testing rather than reading:**

1. **Handler signature.** Hermes dispatches `handler(args: dict, **kwargs)` —
   one arguments dict, not keyword arguments. The handlers had keyword
   parameters, so every live call failed with `TypeError`. The offline suite
   did not catch it because it called the handlers directly with keywords.
   Fixed, and four tests now assert the signature so it cannot regress.
2. **A tuple of patterns searched with `.search()`** — a single-pattern API.
   The payment-tool-name match raised `AttributeError`.
3. **A message-shaped tool (`send_message`) read as payment-shaped.**
   Communication tools are now excluded explicitly.

Plus two smaller fixes: `CredentialStatus` carried no registry address (so
the gate's message could not name the registry it read), and the zero address
is truthy — so "no credential" needed an explicit comparison.

**One behaviour worth knowing:** in `escalate` mode the gate _does_ fire on an
uncredentialed payee, but a non-interactive surface (`hermes -z`) auto-approves
the escalation, so the call proceeds. `enforce` mode produces an absolute
block that no surface auto-approves. The demo uses `enforce` for the blocked
case precisely because that is the shot that cannot be waved through.

**One operational trap:** the gateway caches plugin code. A plugin update is
not live until the gateway restarts, and a restart is refused while a turn is
running (`hermes gateway restart --yes` interrupts). Two of the early
"the hook does not fire" readings were this, not a code fault.

---

## The gap found in the honest review (2026-11-11, ~07:00 EST)

The competitive framing was re-checked against the catalog before building the
demo, and two things changed.

### 1. The crypto audience is 2%, not 16%

A loose keyword regex over 1,732 descriptions said 16% crypto-adjacent. With
tight patterns (x402, stablecoin, ethereum, evm, solana, on-chain, ERC-\*,
web3, btc, monad, zcash, casper) it is **34 of 1,732 = 2%**. Of the 63
payment-related entries, 26 are crypto-central (41%).

**Consequence for the demo:** the film must open on the _block_, not the
chain. "My agent tried to pay someone and it stopped" needs no crypto
literacy. The chain appears as the _how_, in one line.

### 2. The chain claims must be narrowed — one was an overclaim

Measured across Monad Testnet and Pharos Atlantic for the demo subject:

| Capability              | Monad                         | Pharos Atlantic          |
| ----------------------- | ----------------------------- | ------------------------ |
| `agent.commerce.escrow` | issuer `0x0DBCF…`, valid      | issuer `0x0DBCF…`, valid |
| `kyc.basic`             | issuer `0xd21a…`, **revoked** | issuer `0x0DBCF…`, valid |

The capability _hash_ is identical everywhere (it is keccak-256 of the name),
but the _issuer_ differs per chain — the hash makes a capability addressable
everywhere; the issuer still issues per chain. The README's "same credential
on two chains" claim was wrong and is now corrected.

Also measured: `isCapable()` falls back to the newest still-valid nonce, so
the newest credential being revoked does not clear the subject — which is why
`demo.metropolis.revocation` still reads `false`, and why "revoked" and
"never issued" are genuinely different reads.

### 3. The real x402 flow was not being gated — the most important finding

The gate detects payment-shaped calls, but the payee is **not visible in the
tool arguments** in a real x402 payment:

- the 402 response carries `accepts[].payTo` in **plaintext** — it arrives as
  a _tool result_, not an argument;
- the signed retry carries it **base64-encoded** inside `X-PAYMENT` /
  `PAYMENT-SIGNATURE`, so no plain hex address appears in the command string.

Reproduced against the real shapes from `packages/x402-server/src/index.ts`:

```
_looks_like_payment -> True
_extract_payee      -> ''      <-- gate goes SILENT on the real x402 flow
```

So the plugin as shipped would have gated `cast send` but **not** the x402
payment flow it is named for. That is a product defect, not a framing issue.

**Product work this triggers (see §11):**

1. `transform_tool_result` hook — detect a 402 body in a tool result, read
   `accepts[].payTo`, check the credential, and **annotate the result** so the
   agent sees the verdict _before_ it signs.
2. `pre_tool_call` — decode the base64 `X-PAYMENT` / `PAYMENT-SIGNATURE`
   header and extract `accepted.payTo` / `authorization.to`.

Both are small, both are real, and together they make the plugin actually
work on the flow it exists for.

---

## 0. The one-page version

**Entry:** `ligis` — verify that a payee holds a live, third-party-issued,
revocable, **on-chain capability credential** before the agent pays them.

**The gap it fills.** 1,733 catalog entries; 57 touch payments; 20 touch
on-chain; **zero** read a credential registry to ask whether a _counterparty_
is entitled to a payment. The nearest neighbour (`toll`) is a hosted API on
one chain answering a different question ("is this coin safe"). `spendwarden`
is operator policy. `counterparty` is static sanctions lists. `vet402` is
endpoint reputation.

**Why now.** ERC-8478 — _"x402 Payee Verification for ERC-8004 Agents"_ —
was opened 2026-10-30 and is **still an open PR (#2132)**. It states the
problem we solve, measures it (5,575 of Robinhood Chain's x402 answers
bind `payTo` to the agent's own wallet in only 5 cases), and defines a
payee-binding check whose reference implementation is by `toll` — already
in the catalog. **Ligis is an independent, local, cross-chain,
revocation-aware implementation of that exact problem.**

**Why it wins the hackathon.** The judges "favor plugins that do more than
a prompt or a skill could." A prompt cannot `eth_call` a registry and
decode an ABI word. A skill cannot revoke a credential. And unlike every
hosted competitor, Ligis needs **no API key, no steward key, no
`requires_env`, and no `agent.secret_scope`** — read-only JSON-RPC against
a public RPC.

**The demo shot.** Same capability hash resolves on two unrelated EVM
chains. A revoked credential returns `false` from the chain. A payment to
an uncredentialed counterparty is stopped by the agent's own hook.

---

## 1. Pre-flight — do these first (15 min, before any code)

Ordered by EV. **All three are about protecting the two entries already
submitted**, not about the third.

### 1.1 Chase the elcaro catalog PR — _highest EV action available_

- PR: `NousResearch/hermes-agent#149503`, state `OPEN`,
  `mergeStateStatus: BLOCKED`, review `CHANGES_REQUESTED` by `teknium1`
  (2026-11-10 08:33), no CI checks reported.
- The author pushed all four blockers' fixes and re-pinned at `a1bcb95`
  (2026-11-10 14:28). **~14 h of reviewer silence.**
- **Action:** comment on the PR asking for re-review of the delta
  `f24b2f3c → a1bcb95`. Four blockers, all four addressed (verified
  locally below). Keep it short and factual; do not re-litigate.

**Blocker-by-blocker verification (already done locally — cite these in the
comment so the reviewer does not have to re-derive them):**

| #   | Reviewer asked                                             | Fix                                                                                                                  | Where                                                           |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Read secrets via `agent.secret_scope.get_secret`           | `config.get_secret()` → `agent.secret_scope.get_secret_str`                                                          | `hermes-plugin/config.py:49`, `engine.py:89`, `threatlog.py:46` |
| 2   | Force the env-driven second passes off                     | engine built with `classifier=None, serv_reasoner=None, jev_reasoner=None, laya_reasoner=None, jev_vl_reasoner=None` | `hermes-plugin/engine.py:39-43`                                 |
| 3   | Bound the quadratic regexes                                | replaced lazy `.*?` scans with linear two-pointer span scans + bounded windows                                       | `elcaro_engine/detectors/delimiter.py:105+`, `placement.py:30+` |
| 4   | Key `_pending` by session                                  | `OrderedDict` keyed by `session_id`, LRU-bounded                                                                     | `hermes-plugin/guard.py:70,259-270`                             |
| rec | Bump `pyproject.toml` + `dashboard/manifest.json` to 1.1.0 | both now `1.1.0`                                                                                                     | verified                                                        |

### 1.2 Confirm elcaro's ≤90 s demo video actually posted on X

- `~/Downloads/elcaro-hermes-montage.mp4` — **88.0 s** (under the 90 s
  limit). Exists, correct length.
- **But** the visible X timeline shows launch posts (Nov 6 "Meet elcaro",
  Nov 7 "v1.1 upgrade is live"), which look like announcements rather than
  the required "show the plugin working" video.
- **Action:** confirm the video is posted with the `@NousResearch` tag.
  Both visible posts tag it, but the _video_ is unconfirmed.
- If missing → **this outranks the third entry.** A merged, polished entry
  with no demo video scores zero.

### 1.3 Re-confirm lemma is complete

`lemma` PR #149514 is **MERGED** (2026-11-10 09:45), pinned `98b061d`.
Video shipped (64 s `lemma-culture-dish.mp4`), typeform + X post sent
per `HERMES.md`. **Nothing to do.** ✅

---

## 2. What we are building

### 2.1 Form

Native Hermes plugin (Python), **standalone repo layout**, living at
`sneldao/ligis` → `hermes-plugin/`.

```
sneldao/ligis/
└── hermes-plugin/
    ├── plugin.yaml            # manifest v2
    ├── __init__.py            # register(ctx)
    ├── schemas.py             # tool schemas (model-facing)
    ├── tools.py               # handlers
    ├── chains.py              # registry/RPC config + ABI encode/decode
    ├── caphash.py             # keccak256 capability hashing
    ├── fixtures/              # verified / revoked / unverified subjects
    ├── skill/
    │   └── SKILL.md           # bundled skill
    └── README.md
```

### 2.2 The three tools

| Tool                     | Does                                                                                                                | Why it can't be a prompt/skill                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ligis_check_capability` | subject + capability → `capable / revoked / expired / none` + issuer, expiry, nonce, chain, capability hash         | needs `eth_call` + ABI decode + keccak                            |
| `ligis_capability_hash`  | capability name → chain-agnostic keccak256 hash                                                                     | the cross-chain identity primitive itself                         |
| `ligis_verify_payee`     | four-signal gate: right-payee / right-amount / in-scope / verified-payee → `GO / STOP / UNKNOWN` + the signal stack | concurrent multi-chain reads, each signal independently `SKIPPED` |

### 2.3 The hook — the "more than a skill" surface

`pre_tool_call` — intercept **payment-shaped** tool calls, resolve the
payee, check its credential, and escalate/block.

Recognised shapes (mirroring `spendwarden`'s proven detection surface):

- `cast send`, `solana transfer`, `bitcoin-cli sendtoaddress`,
  `near call --deposit`
- `curl` carrying `X-PAYMENT`
- MCP tools whose name matches a payment verb

**Hook contract** (verified against `elcaro/hermes-plugin/guard.py:295`
and `policy.py:320`):

```python
def pre_tool_call(tool_name: str, args: dict, task_id: str, **kwargs) -> dict | None:
    ...
    return {"action": "block",   "message": "..."}   # absolute
    return {"action": "approve", "message": "..."}   # escalate to Hermes gate
    return None                                       # allowed
```

`None` = allowed. `{"action": "block"}` = veto. `{"action": "approve"}` =
escalate to Hermes's own approval prompt (never auto-approve; refuse
when nobody can answer — cron, `--yolo`, approvals off).

### 2.4 Design constraints (from the catalog admission rules)

- **Rule 11 (credentials):** read-only chain calls need **no credentials at
  all** → `requires_env` empty, no `agent.secret_scope` usage, no
  `config_schema` secrets. This is a deliberate, reviewable advantage.
- **Rule 13 (disclosure):** declare exactly — HTTPS JSON-RPC POSTs to the
  user's configured RPC; read-only; the RPC operator sees the caller's IP
  and the queried addresses; no keys; no signing; no transactions.
- **Rule 16 (no forks):** `ligis` is a distinct lineage from `elcaro` and
  `lemma`. Distinct names, distinct repos. ✅
- **Rule 17 (no binaries):** `sneldao/ligis` has **no** committed `.wasm`,
  `.so`, `.pyc`, `.zip`, or `.tar.gz` (verified via `git ls-files`). ✅
  Pure-Python only — no compiled extension.
- **Rule 9 (no core override):** extend only via `ctx.register_*`. No
  monkey-patching, no `sys.modules` writes. ✅
- **Rule 5 (owner submits):** `sneldao` is the owner of `sneldao/ligis`
  and has push. `thisyearnofear` and `udirobert` both get 403. **The
  catalog PR for `ligis` must be opened as `sneldao`.**
- **Name:** `ligis` — no collision in 1,733 entries.

### 2.5 Chain + registry config

Read from `assets/networks.json` (already in-repo) with env override:

| Chain           | chainId | Registry                                     | RPC                                    |
| --------------- | ------- | -------------------------------------------- | -------------------------------------- |
| Pharos Atlantic | 688689  | `0x9E6eC93200E185c11423eb3A5150449D49d3473A` | `https://atlantic.dplabs-internal.com` |
| Monad Testnet   | 10143   | `0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a` | `https://testnet-rpc.monad.xyz`        |

**Casper** and **Zcash** are adapter-level in the Ligis monorepo. **Out of
scope for the hackathon build** — Python support for Casper JSON-RPC and
Zcash shielded verification would blow the deadline. The plugin ships
EVM-first and the README says so plainly. Claim it as "EVM today,
chain-agnostic by construction" — **never** as "multi-chain" unless the
demo shows two live chains, which it does (Pharos + Monad).

### 2.6 ABI (all verified live)

```
isCapable(address,bytes32) -> bool
  selector 0x3f37c189
  calldata = 0x3f37c189
           + 0-padded subject address   (32 bytes)
           + capabilityHash              (32 bytes)

latestCredential(address,bytes32) -> CredentialView
  selector 0xfef4f1e6
  CredentialView = (address issuer, uint256 issuedAt, uint256 expiresAt,
                    bool revoked, bool valid)
```

`capabilityHash = keccak256(utf8(capability_name))` — **not** the EIP-712
domain separator, just the raw keccak of the name. Verified byte-identical
to production (§3).

---

## 3. Verified facts (do not re-derive; cite these)

**Capability hash.** `keccak256("agent.commerce.escrow")` =
`0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8` —
**byte-identical** to the `capabilityHash` the live production gate
returns. `keccak256("kyc.basic")` =
`0x71389c3c607929c3bacb18fee6a304d8e2f68a55746507b46d1b9529064596d5`.

**Live chain reads, raw JSON-RPC, no keys, no hosted API:**

| Fixture                                      | Chain                      | `isCapable` | Meaning     |
| -------------------------------------------- | -------------------------- | ----------- | ----------- |
| `0xd21a…27Ec` + `agent.commerce.escrow`      | Monad 10143                | `0x…01`     | **capable** |
| `0xd21a…27Ec` + `kyc.basic`                  | **Pharos Atlantic 688689** | `0x…01`     | **capable** |
| `0xd21a…27Ec` + `demo.metropolis.revocation` | Monad 10143                | `0x…00`     | **revoked** |
| `0x0000…dEaD` + `kyc.basic`                  | Monad 10143                | `0x…00`     | **none**    |

**The headline:** the _same_ capability hash resolves to _capable_ on two
unrelated EVM chains with different registries, different RPCs, different
deployers. That is the portability proof, live.

**Production cross-check.** `POST https://ligis.vercel.app/api/gate` with
the demo subject returns `verified-payee: GO`, confidence `1`,
`chain: monad-testnet`, `issuer: 0x0DBCF8D105A0a14BE81Ee733c303849474293aAf`,
`revoked: false`, `expiresAt: 2027-10-13T15:25:15.000Z`, provenance
`"jev go jev-1.14.0 (direct, 144ms)"`. The plugin must reproduce this
**from the chain**, without the hosted API.

---

## 4. Build order

### Phase A — core library (target: 90 min)

1. `caphash.py` — keccak256. **Pure-Python fallback required**: Python's
   stdlib `hashlib` has SHA3-256, which is _not_ keccak-256 (different
   padding). Use `pycryptodome` if importable, else `eth_hash`, else a
   vendored pure-Python keccak (~60 lines). **Never** add a hard
   dependency that could fail catalog `--install-deps`.
   _(Both `pycryptodome` and `eth_hash` are present in this dev env.)_
2. `chains.py` — registry map, ABI selector constants, encode/decode for
   `isCapable` and `latestCredential` (uint256 → int, bool → bool,
   address → checksummed), JSON-RPC POST via `urllib` (stdlib only).
3. `tools.py` — the three tools + the hook.
4. `schemas.py` — model-facing descriptions. Say what comes back.
5. `__init__.py` — `register(ctx)`. **Import-clean, no network at
   registration** (`hermes plugins doctor` blocks sockets during
   registration — see `guard.py` docs and lemma's `__init__.py`).

### Phase B — fixtures + validation (target: 45 min)

6. `fixtures/` — three subjects, committed as JSON, used by the demo and
   the skill. Same subjects as the other two entries
   (`0xd21a…27Ec` / `0x…dEaD`) so the demo reads consistently.
7. **Live test harness** — assert the four §3 rows. Any row failing ⇒
   stop and debug.
8. `hermes plugins validate hermes-plugin --install-deps`
   → must pass with **no errors**; read every warning.
9. `hermes plugins doctor hermes-plugin --ci` → must exit 0.
10. `hermes plugins validate .` from repo root (the exact CI gate).

### Phase C — polish (target: 60 min)

11. `README.md` — the disclosure paragraph, the four verified fixtures
    with their chain reads, the ERC-8478 positioning, and the honest
    "EVM-only today" scope note.
12. `skill/SKILL.md` — when to check a counterparty's credential.
13. `plugin.yaml` — manifest v2; `provides_tools` must **exactly** match
    registrations (the "declared tools" check fails otherwise); declare
    `provides_hooks: [pre_tool_call]`; `config_schema` for `rpc_url`
    override, `mode` (`escalate`/`enforce`/`off`), `capability`, `chains`.
14. **Optional, only if time:** a Desktop pane. Nice, not required. The
    deadline wins over the pane.

### Phase D — submission (target: 90 min)

15. Commit on a branch in `sneldao/ligis`; push **as `sneldao`**.
16. Open the catalog PR as `sneldao`:
    `NousResearch/hermes-agent` → `plugin-catalog/ligis.yaml`, with
    `repo: https://github.com/sneldao/ligis`, `subdir: hermes-plugin`,
    full 40-char `sha:`, `version`, `maintainer: sneldao`,
    `tier: community`, `category: tools`, `requires_hermes: ">=0.23.1"`,
    and the `capabilities` block matching reality exactly.
17. PR description: what it does, which surfaces it uses, the disclosure
    paragraph, and the four verified fixtures. Screenshots if any.
18. Demo video ≤90 s, plugin working on screen. Reuse the same capture
    approach as elcaro/lemma (real captured session, not a mock).
19. Post to X tagging `@NousResearch`.
20. Typeform: `https://form.typeform.com/to/FwJLvOln` — PR link + video
    link. (The form can be sent while the PR is open — that is how lemma
    was submitted.)

---

## 5. Timeline (from ~05:00 EST)

| Time        | Block                                                     | Gate                                                |
| ----------- | --------------------------------------------------------- | --------------------------------------------------- |
| 05:00–05:15 | §1 pre-flight: comment on elcaro PR; confirm elcaro video | —                                                   |
| 05:15–06:45 | Phase A — core library                                    | keccak + 4 live reads pass                          |
| 06:45–07:30 | Phase B — fixtures, validate, doctor                      | **`hermes plugins validate` + `doctor --ci` clean** |
| 07:30–08:30 | Phase C — README, skill, manifest                         | —                                                   |
| **08:30**   | **GO / NO-GO**                                            | **see §6**                                          |
| 08:30–10:30 | Phase D — commit, PR, video, X, typeform                  | all three links submitted                           |
| 10:30–13:00 | buffer; polish elcaro/lemma; respond to reviewer          | —                                                   |
| 13:00–15:00 | contingency                                               | —                                                   |

---

## 6. The 08:30 GO / NO-GO gate

**GO** only if **all** of:

1. `hermes plugins validate hermes-plugin --install-deps` passes with zero
   errors;
2. `hermes plugins doctor hermes-plugin --ci` exits 0;
3. the four §3 fixture rows reproduce live from raw JSON-RPC, including
   the Pharos row;
4. `ligis_verify_payee` returns a **four-signal stack** (not a boolean)
   with `SKIPPED` kept distinct from `GO` and `UNKNOWN`;
5. the `pre_tool_call` hook demonstrably returns `{"action": "approve"}`
   for an uncredentialed payee in `escalate` mode.

**NO-GO** ⇒ kill the third entry immediately and spend the remaining
~6.5 h on elcaro's demo video, polish, and reviewer responsiveness, plus
lemma's announcement. **One merged, bulletproof entry beats two good ones
and a broken one.**

---

## 7. Enforcement posture (decided: escalate by default)

**Recommendation: `escalate` by default, `enforce` opt-in.**

- **Enforce** (block) is the stronger demo and the stronger "more than a
  skill" story — but it breaks any agent whose payee is simply not
  on-chain, and that is the common case. A plugin that blocks by default
  reads as reckless to a reviewer.
- **Escalate** asks Hermes's own approval prompt, showing the credential
  evidence. It is the same posture `spendwarden` uses (`mode: enforce`
  is opt-in there), so it reads as _considered_ rather than _aggressive_ —
  and it still demonstrates the plugin doing something a prompt cannot.
- **`enforce` remains one config flip away**, and the demo can show it:
  run one shot in enforce, one in escalate, and say which is which.
- **Never auto-approve.** Escalation must refuse when nobody can answer
  (cron, `--yolo`, approvals off) — Rule 12.

`mode` values: `escalate` (default) · `enforce` · `off`.

---

## 8. Risks

| #   | Risk                                                     | Mitigation                                                                                        |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **Elcaro never merges** — CHANGES_REQUESTED, 14 h silent | §1.1 today; elcaro is a stronger entry than a third                                               |
| 2   | **Elcaro demo video never posted**                       | §1.2 today; outranks the third entry                                                              |
| 3   | **Payment-gate niche is crowded** (57 entries)           | differentiation is _entirely_ the credential read; a hosted-API wrapper loses to `toll` on polish |
| 4   | **keccak≠SHA3** — stdlib `hashlib` gives the wrong hash  | pure-Python keccak fallback; test vector asserted                                                 |
| 5   | **Reviewer stalls the third PR too**                     | PR is only one of three submission artifacts; form + video go in regardless                       |
| 6   | **Over-claiming multi-chain**                            | say "EVM today, chain-agnostic by construction"; demo two live chains or don't claim it           |
| 7   | **Rule 5 account mismatch**                              | open the `ligis` catalog PR as **`sneldao`** (only account with push)                             |
| 8   | **Catalog CI needs `--install-deps` to pass**            | no hard deps; pure stdlib + optional keccak backends                                              |

---

## 9. Evidence appendix

**Catalog landscape (1,733 entries, all downloaded and analysed).**

| Axis                     | Count  |
| ------------------------ | ------ |
| payment / x402           | 57     |
| `pre_tool_call` hook     | 83     |
| credential / attestation | 408    |
| on-chain / blockchain    | **20** |
| revocation + credential  | 9      |
| mention Zcash            | **0**  |
| mention Casper           | **0**  |
| multi-chain EVM          | 3      |
| distinct maintainers     | 1,240  |

**Competitor read (all from the live catalog).**

- `toll` — hosted MCP, zero local code, Robinhood Chain only; token safety
  - ERC-8004 registration + x402 terms. _Closest; different question._
- `counterparty` — static sanctions/ownership lists; corporate entities.
- `spendwarden` — operator spend policy + local SQLite ledger; observe by
  default, enforce opt-in. _Shape precedent for our posture (§7)._
- `vet402` — endpoint purchase reputation; hosted; allows unknown by default.
- `true402-swap-guard` — token honeypot/rug detection.
- `proofly` — post-hoc tx-receipt verification, read-only JSON-RPC on Base.
- `emporium` — sells agent skills for USDC over x402, settles on delivery.
- `talos` — smart-contract security on files the agent writes.

**Market (Tavily + primary sources).**

- **ERC-8478** — _x402 Payee Verification for ERC-8004 Agents_. Created
  2026-10-30, PR #2132 open, status Draft. Requires EIP-712, ERC-1271,
  ERC-3009, ERC-8004. Defines the payee binding, EIP-712 payee delegation
  with `walletSetAt` rotation epoch, and a fixed outcome set where
  _"not read is never the same as verified or mismatch."_ Measured: on
  Robinhood Chain, 5,575 x402 answers, `payTo` == agent's registered
  `agentWallet` in **5**. Reference implementation by `toll`
  (ERC-8004 agent 20030) — already in the Hermes catalog.
- **ERC-8004** — ratified Jan 2026; Identity/Reputation/Validation
  registries; co-developed by MetaMask, the EF, Google, Coinbase. Identity
  is chain-scoped (CAIP-10) — **does not cover capability scope**.
- **Skyfire** — the four layers of an agent payment: identity, delegated
  authorization, spend limits, transaction-level authorization. x402 covers
  only settlement.
- **x401 / Proof+Circle** — identity proof (HTTP 401) alongside x402
  (HTTP 402); credentials are human-mandate-focused.
- **KYA** — "Know Your Agent", the agent-side analogue of KYC.

**Positioning sentence for the PR description:**

> Every x402 payer today learns the payee's address from the HTTP answer
> that is asking for the money. ERC-8478, opened three weeks ago, says
> out loud that this is a gap. `ligis` closes it the way the rest of the
> agent stack already works: with a credential. Not a list of known-good
> endpoints, not a spend cap — a **capability credential issued by a third
> party, revocable by that issuer, and verifiable from the chain** — with
> the same capability hash resolving identically on every chain. No API
> key, no hosted service, no trust in us: one `eth_call` against a public
> RPC, and the answer is a fact about the chain rather than a score.

---

## 11. Product development before submission (added 07:00 EST)

**Yes — product development first, and it is now mandatory rather than
optional.** The review found a defect (§ "The gap found in the honest
review"): the gate does not fire on a real x402 payment, because the payee
is not in the tool arguments. A plugin that does not work on the flow it is
named for is worse than no plugin, and a judge who tries it will find that
in ten seconds.

### 11.1 The two surfaces to build

**A. `transform_tool_result` — the 402 challenge (the important one).**

A 402 response carries `accepts[].payTo` in plaintext. It arrives as a
_tool result_. So the agent learns the payee **after** the request and
**before** it signs — which is exactly the window ERC-8478 describes.

The hook should:

1. detect a 402 in the result (HTTP status, `PAYMENT-REQUIRED`, or a JSON
   body with `x402Version` + `accepts[]`);
2. extract every `accepts[].payTo`;
3. check each payee's credential;
4. **annotate the result** with the verdict, so the agent sees
   `[LIGIS] payee 0x… holds no live 'agent.commerce.escrow' credential`
   _before_ it signs — rather than blocking something it has not done yet.

Annotation, not blocking, is right here: the agent has not committed to
paying, and it may have legitimate reasons. The value is that the
information is in front of it at the decision point.

**B. `pre_tool_call` — the signed retry.**

The retry carries `X-PAYMENT` / `PAYMENT-SIGNATURE` with the payee
base64-encoded. Decoding it yields `accepted.payTo` and
`payload.authorization.to`. Extract and check it, then gate as today.

Implementation: decode base64 → parse JSON → read `accepted[].payTo` and
`payload.authorization.to` → also handle a plain `X-PAYMENT` JSON body
(the v1 shape, not base64).

**C. `ligis_verify_payment` — the tool form of the same check.**

A tool that takes an x402 payment requirement (or a `PAYMENT-SIGNATURE`
header) and returns the payee verdict, so an agent that pays through a
wallet MCP server (`mpp_fetch`, `pay`, `switch402`) — where the plugin
cannot see the arguments at all — can still ask the question explicitly.
This is the path that covers `hermes-mpp`-style auto-pay flows, where
neither hook can fire.

### 11.2 What NOT to build

- **Do not implement ERC-8478's payee binding** (the `agentWallet` /
  EIP-712 delegation check). It needs ERC-8004 registry reads plus EIP-712
  signature recovery, and `eth_keys`/`ecdsa` are not available in the
  plugin's dependency budget without adding a dependency the catalog
  reviewer would have to approve. It is also the _seller's_ side of the
  problem; our side is _entitlement_, which is a different and complementary
  question. State the relationship in the README instead.
- **Do not add chains.** EVM-only stays. Pharos + Monad is enough to show
  the hash is chain-agnostic; Casper and Zcash are a separate week's work
  and would muddy the demo.
- **Do not build a Desktop pane.** Polish comes from the demo and the
  README, not from a pane we cannot test before the deadline.

### 11.3 What the product work buys, honestly

|                                     | Before       | After                                  |
| ----------------------------------- | ------------ | -------------------------------------- |
| `cast send <addr>`                  | gated ✓      | gated ✓                                |
| `curl -H 'X-PAYMENT: <base64>'`     | **silent ✗** | gated ✓                                |
| MCP server auto-pay (`mpp_fetch`)   | silent ✗     | explicit `ligis_verify_payment` call ✓ |
| 402 challenge in a tool result      | invisible    | annotated before signing ✓             |
| Non-crypto payment (`cast`, `curl`) | gated ✓      | gated ✓                                |

That table is the honest scope of the plugin after the work. It should go in
the README verbatim — a judge reading it learns both what the plugin does and
where its edges are, which reads as competence rather than as a gap.

### 11.4 Revised order of work (from 07:00 EST, deadline 17:00 EST)

| Time        | Block                                                                                       | Gate                                         |
| ----------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 07:00–08:30 | **Product work**: 402 annotation hook + X-PAYMENT decoding + `ligis_verify_payment` + tests | new tests pass; live 402 annotation observed |
| 08:30–09:00 | Correct the README/manifest overclaims; add the scope table                                 | —                                            |
| 09:00–09:30 | Re-run validate + doctor + live fixtures; commit; **SHA bump PR**                           | catalog CI green on the new pin              |
| 09:30–11:30 | **Demo film** (HyperFrames, real captured bytes)                                            | ≤90 s, rendered                              |
| 11:30–12:30 | Review the render; fix                                                                      | —                                            |
| 12:30–13:00 | X post tagging @NousResearch                                                                | —                                            |
| 13:00–13:30 | Typeform submission (PR link + video link)                                                  | submitted                                    |
| 13:30–17:00 | Buffer; answer reviewer; keep the demo honest if anything breaks                            | —                                            |

**The 08:30 gate still holds:** if the product work is not working and
validated by 09:30, the plugin ships without it — but then the README must
say plainly that the gate covers `cast`-style transfers and does not yet
cover the base64 x402 retry. An honest narrower plugin beats an overclaiming
one.

---

- [ ] `ligis_check_capability`, `ligis_capability_hash`,
      `ligis_verify_payee`, `ligis_chains`, `ligis_verify_payment` registered
      and working
- [ ] `pre_tool_call` hook returning `approve` on an uncredentialed payee
- [ ] `transform_tool_result` hook annotating a 402 challenge with the
      payee's credential verdict
- [ ] base64 `X-PAYMENT` / `PAYMENT-SIGNATURE` payee extraction
- [ ] Four fixture rows reproduce live from raw JSON-RPC
- [ ] `hermes plugins validate hermes-plugin --install-deps` → 0 errors
- [ ] `hermes plugins doctor hermes-plugin --ci` → exit 0
- [ ] `plugin.yaml` `provides_tools` exactly matches registrations
- [ ] README disclosure names: RPC hosts, read-only, no keys, no signing
- [ ] README carries the honest scope table (§11.3) and no chain overclaim
- [ ] Committed + pushed to `sneldao/ligis` as `sneldao`
- [ ] `plugin-catalog/ligis.yaml` PR open with a 40-char SHA pin
- [ ] Demo video ≤ 90 s, plugin working on screen
- [ ] X post tagging `@NousResearch`
- [ ] Typeform submitted with both links
