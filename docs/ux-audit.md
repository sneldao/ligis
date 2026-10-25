# UX / accessibility audit — Zecathon pass

Date: 2026-10-25. Branch `ux-polish` (off `week3-zk`).

**Method.** Production build (`next build --webpack` + `next start`), walked
as a first-time visitor with no docs. Headless Chrome via Playwright at
1280×900 and 390×844 (iPhone-class), with and without
`prefers-reduced-motion`. axe-core 4 (`wcag2a`, `wcag2aa`, `best-practice`)
on `/`, `/gate`, `/gate` in decision mode with a shielded ZEC payee,
`/operator`, and (after the fixes) `/zcash`. Keyboard-only walk of the new
flow. Code read for states that a static crawl can't reach (loading,
error, zk results).

Judges look for a working shielded-Zcash flow, the ZK prize, clarity,
polish, and ease of use. The findings below are ranked by how much each one
costs us on those criteria.

## Findings, ranked

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                        | Severity | Status                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------- |
| 1   | **The Zcash/ZK story was invisible.** Neither the landing hero nor `/gate` mentioned Zcash, shielded payments, or private credentials. The zk proof was only reachable through a collapsed "Attach zk credential proof →" disclosure, only in decision mode, below the signal grid. A judge could spend five minutes on the site and never find the entry.                                                                     | Critical | Fixed: `/zcash` + links     |
| 2   | **The ZK flow required pasting a 14.6 KB JSON from a CLI** into a textarea. There was no way to generate a proof, no upload, and no guidance.                                                                                                                                                                                                                                                                                  | Critical | Fixed                       |
| 3   | **A verified proof could not help the payee it exists for.** For a shielded address with no public credential, the public read says STOP ("no un-revoked credential"), and that STOP masked a ZK GO. The demo payee only got GO because a _public_ fixture credential existed, so the proof visibly added nothing. This undercut "public issuance, private presentation".                                                      | Critical | Fixed (logic + tests)       |
| 4   | **The verdict wasn't human-readable.** `GateDecision` hand-rolled the verdict (no ✓/✗ mark, "? UNKNOWN"). The reason was a join of raw signal reasons. There was no "what do I do now". The zk result read `verified · GO` next to raw `root` / `nullifier` hashes (truncated with `…`, against the design rule's `··`).                                                                                                       | High     | Fixed                       |
| 5   | **Unexplained jargon:** nullifier, registry root, context, `agent.commerce.escrow` / "Permission", UNKNOWN, Jev layer, SKIPPED, mandate.                                                                                                                                                                                                                                                                                       | High     | Fixed (`Term` + labels)     |
| 6   | **Content faded at rest (contrast).** The scroll-driven `animation-timeline: view()` reveal left anything near the bottom of the viewport partly transparent. axe measured 1.02:1 on the decision section and 2.42:1 on the mobile "Verdict" heading. The `/gate` moments list rested at opacity 0.90, which pushed `ink-quiet` and `terra` to 4.36–4.38:1 (below AA). On short pages, content could never reach full opacity. | High     | Fixed                       |
| 7   | **Screen readers heard nothing.** The decision loading state, the result, and errors had no live region. A blind user pressed Gate and got silence.                                                                                                                                                                                                                                                                            | High     | Fixed                       |
| 8   | **Layout bug:** 77-character shielded addresses overflowed the two-column signal grid and overlapped the neighbouring column ("right payee" reason).                                                                                                                                                                                                                                                                           | Medium   | Fixed                       |
| 9   | **`/gate` sample links were one run-on line** of 12 links across four registries. The Zcash samples sat at the end, hard to scan, worst on mobile.                                                                                                                                                                                                                                                                             | Medium   | Fixed (grouped by registry) |
| 10  | **Decision mode showed share UI twice** ("Share this check →" disclosure plus a "Share" section).                                                                                                                                                                                                                                                                                                                              | Low      | Fixed                       |
| 11  | **The error state was a bare red message** (e.g. `fetch failed`) with no next action. The verdict empty state didn't say what GO, STOP, or UNKNOWN mean.                                                                                                                                                                                                                                                                       | Medium   | Fixed                       |
| 12  | **axe structural issues:** unlabeled accordion `region`s (landmark-unique), keyboard-inaccessible scrollable `<code>`/`<pre>` (serious), dock outside any landmark, and `/operator` without an `h1` and with a terse "pass ?token=" error.                                                                                                                                                                                     | Medium   | Fixed                       |
| 13  | `ZkCredentialPanel` broke the DESIGN.md naming ban ("panel").                                                                                                                                                                                                                                                                                                                                                                  | Low      | Fixed (`ZkCredential`)      |
| 14  | Mobile: no horizontal overflow on any audited page, and the dock collapses correctly. Long addresses truncate in inputs without a way to see the whole value.                                                                                                                                                                                                                                                                  | Low      | Fixed (full readout)        |
| 15  | Keyboard: global `:focus-visible` terra outline is present, and there is a skip link. Digit keys work in the moments accordion.                                                                                                                                                                                                                                                                                                | OK       | —                           |

## What changed

- **Guided demo, `/zcash`** ("Ligis · Zcash"). A first-time user gets the
  whole Zecathon story in four one-click steps against the real API:
  1. No proof → **STOP**. A shielded payee has nothing public.
  2. The payee generates a **live UltraHonk proof**
     (`POST /api/zk/demo-proof`, about 0.7 s) → **GO**, followed by the
     Orchard/Sapling shielded ZEC release receipt (`0.25 ZEC`, encrypted
     512-byte `LIGIS:v1:` memo, consumed nullifier). The page shows what
     the gate learns versus what stays private.
  3. The same proof replayed → **STOP**.
  4. A revoked credential (a valid proof against the pre-revocation root)
     → **STOP**.

  Each step explains itself in plain words. Focus moves to the step's
  result, and progress is announced. Steps unlock in order, and "start
  over" is always available. When live proving is off (for example on
  Vercel, where there is no local `nargo`/`bb` binary), step 1 queries
  `/api/gate` live and steps 2–4 remain interactive by stepping through a
  verified UltraHonk recording (explicitly labeled as a recorded run).

  Entry points: a landing-hero secondary link, a `/gate` callout under the
  samples, ⌘K, and the sitemap. Local run: `pnpm demo:zcash-web`.

- **`DecisionVerdict`** (new primitive, styleguide specimen 07b): ✓ GO /
  ✗ STOP / ? UNKNOWN with a plain headline ("Safe to pay", "Don't pay",
  "Not enough to say yes"), why, **Next ·** action, and one ledger row per
  check phrased as the question it answers. Addresses inside reasons are
  compacted with `··`.
- **Zk results in words** (`explainZk`): accepted, replay blocked,
  revoked or unknown registry, belongs to someone else, wrong kind, expired,
  invalid, not checked, snapshot out of date, gate not configured. Hashes
  sit behind "Technical details".
- **Proof attach:** upload a `.json` file (paste is secondary), validation
  messages in `role="alert"`, and a link to the guided demo.
- **`Term`** glossary disclosures (button + `aria-expanded`, not hover
  tooltips) for shielded address, zero-knowledge proof, permission,
  registry fingerprint, nullifier, payee binding, contracted terms
  (`mandate`), Jev intent reader (`jev`), and `SKIPPED`.
- **Capability labels & long-address readout on `/gate` and `/`:**
  the permission `<select>` shows human-readable capability descriptions
  alongside IDs (`agent.commerce.escrow — Authorized to engage in
escrow-backed commerce`), and long addresses (>42 chars, such as 77-char
  Zcash unified addresses or Casper account-hashes) render a full wrapped
  readout below the input.
- **a11y:**
  - live regions on the decision and on each demo step
  - the scroll-driven fade is removed
  - labelled accordion regions
  - focusable scrollers
  - the dock is a `<header>` banner, and the landing hero + developer
    integration sections sit inside `<main>` (no orphan regions)
  - `/operator` has an `h1` and explains what to do
- **Logic:** a verified proof now answers a public "no credential" STOP.
  Revoked, self-issued, and unverified proofs still lose. Tested in
  `web/test/zk-gate.test.ts`.

After the fixes, axe reports **no WCAG A/AA or landmark/region violations**
on `/`, `/gate`, `/gate` decision mode, `/operator`, or `/zcash` (desktop
and mobile).

## Still open

- **In-browser proving on serverless (`/zcash`):** on Vercel (where `nargo`
  and `bb` binaries aren't present), `/zcash` steps 2–4 interactively walk
  through a verified UltraHonk recording (`pnpm demo:zcash-web` or a host
  with `nargo` + `bb` runs live proving).
- **Live Zcash testnet node broadcast:** the demo records the 512-byte
  encrypted `LIGIS:v1:` memo and shielded note fixture (`pnpm demo:zcash`);
  broadcasting a live Orchard/Sapling spend on Zcash testnet requires a
  funded `zcashd`/`zallet` testnet wallet.
