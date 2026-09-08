# Ligis — Monad Metropolis: Trust, Identity & AI Infrastructure

> **Hackathon**: Metropolis (Monad)
> **Track**: Trust, Identity & AI Infrastructure
> **Prize**: $30,000 USD split evenly among 3 winners ($10,000 each)
> **Deadline**: 14 Oct 2026, 04:59 GMT+1
> **Status**: product-fit notes — UX work is in-repo; Monad deploy is not started
> **Live product today**: [ligis.vercel.app](https://ligis.vercel.app) (Casper Testnet + Pharos Atlantic)

This track is for protocol-level primitives: trust, provenance, and user-owned
data that other applications build on — not a standalone consumer product.

Ligis already _is_ that primitive (`isCapable(subject, capability)` before
money or context moves). The work for this track is to land it on Monad with
Monad-native building blocks, not to invent a new product.

---

## Fit

| Criterion                   | Weight | Ligis today                                           | What to ship for judges                                                                                                             |
| --------------------------- | ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Technical execution         | 20%    | Sound capability hashes, issuer keys, on-chain verify | Deploy on Monad testnet/mainnet. Use **P256/WebAuthn** and **ERC-8004** as first-class, not Ligis-only identity. No leaked secrets. |
| Design & craft              | 20%    | Strong visual field                                   | They mean **developer experience**: one-read API, docs, copy-paste snippet. The field is optional proof, not the score.             |
| Originality & track insight | 15%    | Same `capabilityHash` on Casper and Pharos            | “Not capturable by one platform.” Monad as a third chain makes that claim real. Credentials-on-a-chain alone will look generic.     |
| Founder & market readiness  | 25%    | Gate-before-payment is a specific buyer               | Name the integrator (x402, CROO, one other hackathon team). “Agents in general” loses this bucket.                                  |
| Traction & path forward     | 20%    | Live Casper/Pharos, CROO listing                      | **Another team integrating during the event**, plus a post-event integration plan.                                                  |

**Belongs here if** the primary output is infrastructure. Pitch
`isCapable(subject, capability)` as the trust read any Monad agent calls
before money or context moves. Do not pitch Ligis as a consumer identity
explorer.

Closest suggested starting points from the brief:

- **06** — onchain credential attestations any application can verify without
  a middleman (this is Ligis today)
- **01** — mobile-native proof of personhood via WebAuthn/P256 (Monad’s
  actual differentiator; the originality delta versus “we also deployed”)

**04** (user-owned AI memory) is a future app _on_ Ligis, not Ligis itself.
Do not recenter the pitch there.

Monad building blocks to actually use:

- Native P256 precompile for WebAuthn verification
- ERC-8004 as the trustless agent registry — wrap, don’t fork
- BTX encrypted mempools if private credential submission is in scope

There is **no Monad code in this repo yet**. The live-product deliverable
must be on Monad mainnet or testnet. That is the actual gate.

---

## Product surface (web) — do not confuse the demo with the primitive

User feedback that shaped the current IA:

1. Navigation was packed (Gate, How it works, Steward, Capabilities, Issuers,
   Embed, CROO) and advertised the moat as competing products.
2. The identity field was incredible close-in, then **vanished on zoom-out**
   (camera-Z fade + fog treated zoom as culling). It also shared `/` with the
   landing page, so wheel-zoom fought page-scroll and there was no enter/exit.

Current rules (see `web/DESIGN.md`):

- **Landing (`/`)** — editorial. Paper. Framed invite into the field.
- **Field (`/field`)** — dedicated registry map. Semantic zoom: specimens
  close in, persistent markers far out. Esc / Ligis mark leaves.
- **App (`/gate`, …)** — the verb and the moat. Dock names only Gate and Field.

The field is a _demonstration of the live registry_. For Metropolis, the
3-minute demo should lead with a live gate on Monad, the same capability hash
as Casper/Pharos, then a short flight through `/field` as proof the registry
is real. Not a code walkthrough. Not slides.

An infinite-canvas library (chunk streaming, inertia, pinch) is a camera
reference, not a product architecture. Ligis already chunk-streams; the bug
was LOD, not the absence of a canvas kit.

---

## Deliverables checklist

- [ ] Project logo/graphic (JPG/PNG/WEBP, ≤3MB)
- [ ] Public GitHub repo accessible by `metropolis@hackathon.monad.xyz`
- [ ] Technical demo video ≤3 min (live product, not slides)
- [ ] Pitch video ≤2 min (team, problem, why)
- [ ] Live product on Monad mainnet or testnet + access instructions
- [ ] Optional ≤30s advertisement (not judged)

## Suggested build order

1. Deploy AgentId + CredentialRegistry (+ gate) on Monad testnet.
2. Map agent identity onto **ERC-8004** if that is Monad’s agent registry.
3. One Monad-native extra: WebAuthn/P256 issuer or agent auth, or BTX-aware
   private credential submission.
4. A second team calling `isCapable` during the hackathon.
5. DX docs a stranger can integrate in ten minutes (this _is_ the Design score).
6. Two videos as specified.

UX for `/` and `/field` is in progress independently — it helps the demo, it
does not win the track on its own.
