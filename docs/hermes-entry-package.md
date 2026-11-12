# ligis — Hermes entry package

> **Status:** submitted. Demo posted to X, typeform received, catalog PR open
> and awaiting re-review after the security fixes.
> **Deadline:** was 5:00 PM EST, Tue Nov 11 2026 — submission made before it.
> **Catalog PR:** https://github.com/NousResearch/hermes-agent/pull/153409
> **Sibling entry:** `elcaro` (#149503) — **merged** 2026-11-11 21:42 UTC.

---

## 1. The video

**File:** `~/Downloads/ligis-hermes-demo.mp4`
**Length:** 46.0 s (limit is 90 s) · 1080×1920 vertical · 30 fps

**Branding:** the film uses the **Ligis** design system — the
tokens and faces are copied from `web/app/globals.css` and
`web/app/fonts`:

|            |                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Paper      | `#f4f1ec` / `#ece7df`                                                                           |
| Ink        | `#1c1b1a` (mono: `#241f1a`)                                                                     |
| Terracotta | `#9f4c2f` — the accent, used only for ceremony (CTA, the `i`, the STOP)                         |
| Sage       | `#5a6d53` — good                                                                                |
| Revoke     | `#a13a2a` — loss                                                                                |
| Sky        | `#356584` — in progress                                                                         |
| Faces      | Fraunces (display) · Hanken Grotesk (UI) · JetBrains Mono (addresses, hashes, capability names) |

Containment is by **hairline and whitespace**, never a box — matching the
product's own rule that a verdict is a 2px left rule in tone, not a card.
The terminal is a printed specimen sheet, not a dark IDE panel.

Source film: the HyperFrames 0.9.30 composition (`index.html` + assets,
with the fonts copied from `web/app/fonts/`). The terminal pane carries
**real captured bytes** — a real 402 from the Ligis x402 server and the
real `[LIGIS]` annotation the plugin appended. Nothing in the film is mocked.

The composition was built in `/tmp/ligis_film/`, which the machine has
since reclaimed; the mp4 is the receipt. Rebuilding it means recreating the
composition from this beat sheet — the tokens are `web/app/globals.css`
verbatim, the faces are `web/app/fonts/`, and the captured bytes are in
`/tmp/ligis_video/*.txt` (also ephemeral) or re-capturable with one
`hermes --cli -z` call against a live x402 server.

### Beat sheet (in case you want to re-cut)

| Time      | What is on screen                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0–7.6   | "Your agent pays strangers for you" — the two columns: what the agent knows (`payTo`, a URL, a price it was told) vs what it should know (a capability, issued by a third party, revocable, readable from the chain) |
| 7.6–13.6  | The real 402: `HTTP/1.1 402 Payment Required`, the `accepts[]` body, `"payTo": "0x0000…dEaD"`                                                                                                                        |
| 13.6–21.9 | **The payload:** the `[LIGIS] VERIFIED-PAYEE` note — _does NOT hold a live 'agent.commerce.escrow' credential_, the registry address, `no key · no hosted service`, and a **STOP** in Fraunces terracotta            |
| 21.9–30.3 | Revocation: `demo.metropolis.revocation → revoked` _(still present in the registry)_ — _a spend cap cannot see this. neither can a URL reputation list._                                                             |
| 30.3–38.1 | Portability: `keccak256("agent.commerce.escrow") = 0x17775e48…a3ebf8` — same bytes, every chain; Monad ✓ · Pharos ✓ · same issuer                                                                                    |
| 38.1–41.2 | **The climax:** `[LIGIS] Blocked terminal:` … **BLOCKED** — _no transaction was ever signed_                                                                                                                         |
| 41.2–46.0 | Endcard: `ligis` — _Is this payee entitled to be paid? Read the credential registry. No key, no hosted service._ + `hermes plugins install ligis`                                                                    |

**Audio:** print-room foley, no music — quiet room tone throughout, a
typewriter tick as each terminal line lands, a paper slide between beats,
and a rubber stamp on STOP, BLOCKED, and the endcard logo (the film's
document is also its soundtrack).

**Checks:** `hyperframes check` — 0 errors in every category (lint, runtime,
layout, motion, contrast, audio).

---

## 2. The X post

Post the video with the caption below. Tag **@NousResearch**.

> Your agent is about to pay a stranger. Nothing tells it whether that stranger is entitled to be paid — the destination address just comes from the HTTP answer asking for the money.
>
> ligis is a Hermes plugin that answers it with a credential: issued by a third party, revocable by them, readable from the chain. No key, no hosted service — one read-only `eth_call`.
>
> It reads the x402 402 challenge, tells the agent what the payee holds before it signs, and blocks the payment when it can't be credentialed.
>
> `hermes plugins install ligis`
>
> @NousResearch

**Shorter variant** if the first gets no traction:

> Your agent pays strangers. ligis checks the stranger first — with a credential that a third party issued and can revoke, read straight from the chain. No key, no hosted service.
>
> @NousResearch

**Optional P.S.** (adds the standards hook, but lengthens it):

> P.S. this is the gap ERC-8478 ("x402 Payee Verification for ERC-8004 Agents", opened 3 weeks ago) states in spec form. We implemented it.

---

## 3. The Typeform

**Form:** https://form.typeform.com/to/FwJLvOln

Fill in:

| Field                    | Value                                                      |
| ------------------------ | ---------------------------------------------------------- |
| **Plugin name**          | `ligis`                                                    |
| **Repository / PR link** | `https://github.com/NousResearch/hermes-agent/pull/153409` |
| **Demo video link**      | _(the URL of your X post — paste it after posting)_        |
| **Description**          | see below                                                  |

**Description (paste-ready):**

> ligis verifies that a payee holds a live, third-party-issued, revocable on-chain capability credential before your agent pays them. Hermes agents pay other agents, and the destination address comes from the HTTP answer asking for the money — nothing in the x402 flow ties that address to anything the payee has proven about itself, which is the gap ERC-8478 states in spec form.
>
> Five tools and two surfaces, all read-only: ligis_check_capability, ligis_capability_hash, ligis_verify_payee (the four-signal verdict: right-payee / right-amount / in-scope / verified-payee), ligis_verify_payment, and ligis_chains. A pre_tool_call hook intercepts payment-shaped tool calls and escalates to Hermes's approval prompt when the payee cannot be credentialed; a transform_tool_result hook annotates an x402 402 challenge with the payee's verdict before the agent signs anything.
>
> No key, no account, no hosted service, no agent.secret_scope: the credential registry is public chain state, so verifying a credential is a read — one eth_call against a public RPC. The only thing trusted is the chain.
>
> Two things it does that nothing else in the catalog does: a credential that was issued and then revoked still reads as present in the registry and is correctly reported as revoked (a spend cap and a URL-reputation list cannot see this), and a capability is indexed by the keccak-256 hash of its NAME, so the same capability resolves to the same bytes on every chain.

---

## 4. Where everything lives

| Thing              | Where                                                       |
| ------------------ | ----------------------------------------------------------- |
| Plugin source      | `sneldao/ligis` → `hermes-plugin/`                          |
| Pinned commit      | `b7f80a38fd20616650e6de8e6cbcab3f97a3de3a`                  |
| Catalog PR         | https://github.com/NousResearch/hermes-agent/pull/153409    |
| Catalog entry file | `plugin-catalog/ligis.yaml` in the PR                       |
| Demo video         | `~/Downloads/ligis-hermes-demo.mp4`                         |
| Film source        | ephemeral (`/tmp`) — the mp4 is the receipt; tokens/faces are `web/app/` |
| Build plan         | `docs/hermes-plugin-plan.md` in `sneldao/ligis`             |

**To rebuild the video:** recreate the composition per the beat sheet above
(tokens from `web/app/globals.css`, faces from `web/app/fonts/`), then
`npx --yes hyperframes@0.9.30 render --output ligis-demo.mp4`.

---

## 5. Verification state (all green as of 08:35 EST)

| Check                                                    | Result                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hermes plugins validate --install-deps hermes-plugin`   | **passed**, no warnings, "security scan — safe", no Python dependencies                                                                                                 |
| `hermes plugins doctor hermes-plugin --ci`               | **passed** — 5 tools, 2 hooks                                                                                                                                           |
| `tests/test_ligis.py`                                    | **140/140** pass, offline (hermetic — a fixture registry answers the RPC, no network)                                                                                   |
| `fixtures/selftest.py`                                   | **5/5** fixtures reproduce live from raw JSON-RPC, on Monad + Pharos                                                                                                   |
| Catalog CI simulation on a clean clone at the pinned sha | **all four gates pass** (validate, payload scan, self-updater grep, confinement)                                                                                        |
| `validate_plugin_catalog.py` on the entry file           | **valid**                                                                                                                                                               |
| **Live Hermes session**                                  | 402 challenge annotated with the payee's verdict (both directions); payment to an uncredentialed payee **blocked**; payment to a credentialed payee **allowed through** |

---

## 6. If a reviewer asks

**"Why is this not just a spend cap?"** — A spend cap asks _is this within
the operator's budget_. It says nothing about the counterparty. Ligis asks
_is this counterparty entitled to this_, from a credential the operator did
not issue and cannot forge.

**"Why is this not like `vet402` or `toll`?"** — `vet402` looks up whether
anyone has bought a URL before (endpoint reputation). `toll` checks whether
a _coin_ is safe, on one chain, through a hosted server. Neither asks
whether the counterparty holds a credential, and neither can see a
revocation.

**"Isn't this just ERC-8478?"** — ERC-8478 (opened 2026-10-30, PR #2132,
still a draft) defines the _payee binding_ — that `payTo` is the agent's
registered wallet or a delegated one. That is the seller's side. ligis
answers a different and complementary question: _entitlement_ — does this
counterparty hold a third-party-issued, revocable permission for this
capability. The README says so explicitly rather than overclaiming.

**"Does it need a key?"** — No. The credential registry is public chain
state. Verifying is a read: one `eth_call`. It holds no keys, signs
nothing, sends no transactions, and never uses `agent.secret_scope`.

**"What about wallets that settle internally?"** — The README's scope
table says so plainly: `mpp_fetch`, `pay` and `switch402` take the 402
themselves, so the payee never reaches the agent and no hook can gate it.
`ligis_verify_payment` is the path for that case. Stating the limit is
stronger than pretending.

**"Which chains?"** — EVM only in this release: Monad Testnet and Pharos
Atlantic. The capability hash is chain-agnostic by construction (it is the
keccak-256 of the capability's _name_), so the same capability resolves on
any EVM registry — but the issuer issues per chain, and the README states
that distinction rather than claiming portable credentials.

---

## 7. Checklist

- [x] Post `~/Downloads/ligis-hermes-demo.mp4` to X with the caption in §2, tagging @NousResearch — https://x.com/papajimjams/status/2120539259660595389
- [x] Copy the post URL
- [x] Submit the Typeform (§3) with the PR link and the post URL — submitted, confirmation "Submission Received" (receipt: `~/Downloads/ligis-typeform-receipt.png`)
- [x] Open the catalog PR — #153409
- [x] Address the maintainer's five security blockers and re-pin the sha — see §8
- [ ] Maintainer re-review of the delta → merge → the marketplace listing
- [x] Sibling entry `elcaro` (#149503) — **merged** 2026-11-11 21:42 UTC

---

## 8. The maintainer review, and what it changed

`teknium1` reviewed the `hermes-plugin` subdir at `69533570` and returned
**CHANGES_REQUESTED**. The review was right on every point, and the fix
commit `b7f80a3` is now the pinned sha. What changed:

**1. Self-issued credentials were possible — the important one.** `isCapable`
accepts a credential from *any* issuer and the registry lets anyone issue
for any subject, so a payee could self-issue for its own `payTo` and the
gate would stay silent while the note claimed it held a live credential.
Now `read_capability` takes `trusted_issuers` and confirms with the
contract's `isCapableFromIssuer(subject, cap, issuer)`. With none
configured or none matching, a present credential reports
`unverified_issuer` — *present, but the issuer is not verified* — and
escalates like an uncredentialed payee.

**2. The unverified-TLS retry is gone.** The old code retried any TLS error
with certificate checks off, so anyone on the network path could answer
`isCapable = true`. The reviewer's correction: the bool is decoded
straight from the response, so the old comment claiming a tampered response
could not grant a capability was simply wrong. A TLS failure now raises
`RpcError` → `unknown`.

**3. The result hook is bounded.** It bails before parsing unless `payTo`
appears in the result, dedupes, full-matches `0x[a-fA-F0-9]{40}`, checks
at most 3 payees per result, and reports how many were skipped.

**4. 402 fields are treated as untrusted data.** `pay_to`, `amount`,
`asset`, `network` and RPC error text used to go into a `[LIGIS]` note
unvalidated, so a hostile 402 body could forge plugin-voiced lines. Now
control characters and newlines are stripped, whitespace collapsed, lengths
capped, and values quoted as data.

**5. The approval claim was wrong.** The docs said unattended runs refuse;
in Hermes `--yolo` and `approvals.mode: off` *auto-approve* plugin
escalations, and cron follows `approvals.cron_mode`. Corrected in the
README, `plugin.yaml`, the skill and the docstring. It now also says that an
unreadable registry does **not** gate.

Going further, the fix commit also added the next layer of the same trust
chain: the operator's `trusted_issuers` setting is the **sole** root of trust
(tool arguments can narrow it, never widen it, so a payee — or text steering
the model — cannot whitelist an issuer of its choosing); an endpoint probe
checks `eth_chainId` and `eth_getCode` before the first read, so a
wrong-chain endpoint or a codeless registry reads as `unknown`; the gate
checks *every* destination a call names, not just the first; a
`hook_time_budget_seconds` bounds total RPC wall-clock; and the unit suite
is hermetic (140 offline tests, no network).

**State at the pin `b7f80a3`:** `hermes plugins validate --install-deps`
passes with no warnings (security scan: safe, no Python dependencies),
`hermes plugins doctor --ci` passes (5 tools, 2 hooks), 140/140 offline
tests pass, 5/5 live fixtures reproduce on Monad + Pharos, and the catalog
CI simulation on a clean clone at that exact sha passes all four gates
(validate, payload scan, self-updater grep, confinement).
