# ligis — Hermes entry package

> **Status:** everything ready to post. Video rendered, PR open, form text drafted.
> **Deadline:** 5:00 PM EST, Tue Nov 11 2026. (Now ~08:35 EST.)
> **Catalog PR:** https://github.com/NousResearch/hermes-agent/pull/153409

---

## 1. The video

**File:** `~/Downloads/ligis-hermes-demo.mp4`
**Length:** 46.0 s (limit is 90 s) · 4.2 MB · 1080×1920 vertical · 30 fps

Source film: `/tmp/ligis_film/` (HyperFrames 0.9.30, `index.html` + assets).
The terminal pane carries **real captured bytes** — a real 402 from the
Ligis x402 server and the real `[LIGIS]` annotation the plugin appended.
Nothing in the film is mocked.

### Beat sheet (in case you want to re-cut)

| Time | What is on screen |
|---|---|
| 0.0–7.6 | "Your agent pays strangers for you" — the two columns: what the agent knows (`payTo`, a URL, a price it was told) vs what it should know (a capability, issued by a third party, revocable, readable from the chain) |
| 7.6–13.6 | The real 402: `HTTP/1.1 402 Payment Required`, the `accepts[]` body, `"payTo": "0x0000…dEaD"` |
| 10.1–13.6 | **The payload:** the `[LIGIS] VERIFIED-PAYEE` note — *does NOT hold a live 'agent.commerce.escrow' credential*, the registry address, `no key · no hosted service`, and a red **STOP** chip |
| 15.4–22.2 | Revocation: `demo.metropolis.revocation → revoked` *(still present in the registry)* |
| 24.6–30.6 | Portability: `keccak256("agent.commerce.escrow") = 0x17775e48…a3ebf8` — same bytes, every chain; Monad ✓ · Pharos ✓ · same issuer |
| 33.4–40.4 | **The climax:** `[LIGIS] Blocked terminal:` … `BLOCKED` — *no transaction was ever signed* |
| 41.0–46.0 | Endcard: `ligis` — *Is this payee entitled to be paid? Read the credential registry. No key, no hosted service.* + `hermes plugins install ligis` |

**Audio:** music bed (looped + faded) plus a xylophone motif on the intro
and impact hits on the three reveals.

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

| Field | Value |
|---|---|
| **Plugin name** | `ligis` |
| **Repository / PR link** | `https://github.com/NousResearch/hermes-agent/pull/153409` |
| **Demo video link** | *(the URL of your X post — paste it after posting)* |
| **Description** | see below |

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

| Thing | Where |
|---|---|
| Plugin source | `sneldao/ligis` → `hermes-plugin/` |
| Pinned commit | `695335709f9930aa008cc7e7f1747752ec261e73` |
| Catalog PR | https://github.com/NousResearch/hermes-agent/pull/153409 |
| Catalog entry file | `plugin-catalog/ligis.yaml` in the PR |
| Demo video | `~/Downloads/ligis-hermes-demo.mp4` |
| Film source | `/tmp/ligis_film/` (not committed — the mp4 is the receipt) |
| Build plan | `docs/hermes-plugin-plan.md` in `sneldao/ligis` |

**To rebuild the video:** `cd /tmp/ligis_film && npx --yes hyperframes@0.9.30 render --output ligis-demo.mp4`

---

## 5. Verification state (all green as of 08:35 EST)

| Check | Result |
|---|---|
| `hermes plugins validate --install-deps hermes-plugin` | **passed**, no warnings, "security scan — safe", no Python dependencies |
| `hermes plugins doctor hermes-plugin --ci` | **passed** — 5 tools, 2 hooks |
| `tests/test_ligis.py` | **89/89** pass, offline |
| `fixtures/selftest.py` | **4/4** fixtures reproduce live from raw JSON-RPC |
| Catalog CI simulation on a clean clone at the pinned sha | **all four gates pass** (validate, payload scan, self-updater grep, confinement) |
| `validate_plugin_catalog.py` on the entry file | **valid** |
| **Live Hermes session** | 402 challenge annotated with the payee's verdict (both directions); payment to an uncredentialed payee **blocked**; payment to a credentialed payee **allowed through** |

---

## 6. If a reviewer asks

**"Why is this not just a spend cap?"** — A spend cap asks *is this within
the operator's budget*. It says nothing about the counterparty. Ligis asks
*is this counterparty entitled to this*, from a credential the operator did
not issue and cannot forge.

**"Why is this not like `vet402` or `toll`?"** — `vet402` looks up whether
anyone has bought a URL before (endpoint reputation). `toll` checks whether
a *coin* is safe, on one chain, through a hosted server. Neither asks
whether the counterparty holds a credential, and neither can see a
revocation.

**"Isn't this just ERC-8478?"** — ERC-8478 (opened 2026-10-30, PR #2132,
still a draft) defines the *payee binding* — that `payTo` is the agent's
registered wallet or a delegated one. That is the seller's side. ligis
answers a different and complementary question: *entitlement* — does this
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
keccak-256 of the capability's *name*), so the same capability resolves on
any EVM registry — but the issuer issues per chain, and the README states
that distinction rather than claiming portable credentials.

---

## 7. Remaining checklist for you

- [ ] Post `~/Downloads/ligis-hermes-demo.mp4` to X with the caption in §2, tagging @NousResearch
- [ ] Copy the post URL
- [ ] Submit the Typeform (§3) with the PR link and the post URL
- [ ] **Elcaro:** confirm the ≤90 s video is actually posted (the 88 s montage exists locally; your visible posts look like announcements)
- [ ] **Elcaro:** the re-review nudge is posted on #149503
- [ ] **Lemma:** merged ✓ — nothing to do
