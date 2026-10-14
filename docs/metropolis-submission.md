# Metropolis submission — Ligis

> Copy-paste material for the Monad Metropolis submission (track: Trust,
> Identity & AI Infrastructure). Everything below is verified against live Monad
> testnet state on 2026-10-14. Anything not yet produced is marked TODO rather
> than claimed.

---

## Project name

**Ligis — a spend firewall for AI agents**

## One-liner

Every payment an agent makes is checked against the job before money moves: a
single API call returns `GO`, `STOP`, or `UNKNOWN` before the wallet signs.

## Tagline

> Right payee. Right amount. In scope. Verified payee. One call, before the money moves.

---

## Description (submission body)

Agent-to-agent commerce has a trust gap. When one agent hires another
autonomously, no human is doing due diligence, and the buyer has no
machine-readable way to answer "is this counterparty safe to transact with?"
Today the options are to pay blindly, or to refuse because nothing can be
checked at all.

Ligis is a pre-payment decision layer. An agent calls `POST /api/gate` with the
payee, the amount, and the job's purpose, and gets back a `GO`, `STOP`, or
`UNKNOWN` — with the individual signals that produced it. Only `GO` leads to a
signature.

The decision composes four signals evaluated concurrently:

1. **Right payee** — does this payment go where the agent intended?
2. **Right amount** — is the amount plausible, and within the mandate cap?
3. **In scope** — is the request consistent with what the payee does?
4. **Verified payee** — what does on-chain evidence actually say about this
   counterparty?

The first three are deterministic checks the agent owner controls. The fourth is
where the work is. Ligis reads a portable on-chain capability credential and
answers honestly: this counterparty holds `kyc.basic`, issued by whom, expiring
when, revoked or not. **Absence of evidence is `UNKNOWN`, never `GO`.** An
upstream that fails to answer is surfaced with a reason, never treated as
approval — the single most important property of the whole system.

Because the credential is on-chain and chain-agnostic, the same credential is
readable by any agent, on any of the supported networks, without installing a
client SDK. That is what makes trust portable rather than another closed club:
an agent that has never heard of Ligis can still verify.

### What is live today

- **Credential lifecycle on Monad testnet** — issue → `GO` → revoke → `STOP`,
  every step read from chain state. Verified 2026-10-14.
- **x402 payments gated by credentials** — an agent without the credential gets
  `401`/`402` and never attempts a payment; one holding it settles a real
  EIP-3009 `TransferWithAuthorization` through the molandak facilitator.
- **ERC-8004 identity** — our steward is registered on Monad's IdentityRegistry
  (agentId 1974) and gate verdicts are written to the ReputationRegistry as
  `ligis.gate` feedback.
- **WebAuthn/P256 issuance** — credentials can be authorized by a passkey
  assertion verified against Monad's native P256 precompile at `0x0100`, rather
  than by a key sitting in an environment file.
- **A signing guard** — `@ligis/wallet-plugin` refuses to sign an EIP-3009
  authorization without a fresh, schema-valid `GO` for that exact operation.

### Why it is not just another oracle

The gate is a **stop-default reflex, not an authority**. Deterministic payee and
amount constraints live in code; a language model is advisory evidence and can
never overrule operator policy. Every refusal carries the signal that caused
it, so a decision is auditable rather than a bare boolean.

---

## Live product + access instructions

**Live:** https://ligis.vercel.app

| Route                                                                                               | What to show                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                                                                 | Landing — the moment→gate loop                                                                                                 |
| `/gate`                                                                                             | **The gate.** Paste a subject and capability, get a verdict with its signals. Append `?chain=monad-testnet` to scope to Monad. |
| `/gate?subject=0x00000000000000000000000000000000000decaf&capability=kyc.basic&chain=monad-testnet` | The demo subject from the lifecycle run, revoked → reads `STOP`                                                                |
| `/agent/0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec?chain=monad-testnet`                             | ERC-8004 identity and reputation score, live                                                                                   |
| `/passkey`                                                                                          | WebAuthn/P256 ceremony against the P256 precompile                                                                             |
| `/proofs`                                                                                           | What each verdict actually proves, and what it does not                                                                        |

**No signup, no API key, no wallet connection required to read a verdict.**

### Reproduce it yourself from the public repo

```bash
git clone https://github.com/sneldao/ligis && cd ligis && pnpm install

# Credential lifecycle on Monad testnet: issue → GO → revoke → STOP
set -a && source .env.d/deployer.env && set +a
export LIGIS_NETWORK=monad-testnet PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
npx tsx scripts/monad-lifecycle-demo.ts
```

Needs a funded Monad **testnet** key. The script refuses to run against any
chain that is not chainId 10143, and exits non-zero if the gate does not move
to `STOP`.

**Deployed contracts (Monad testnet, Sourcify `exact_match`):**

| Contract                                        | Address                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `CredentialRegistry` (v2, ERC-1271 issuer path) | `0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a` |
| `PasskeyIssuer`                                 | `0x6C500B3968C54789b518D01066Aed2990d44c068` |
| ERC-8004 IdentityRegistry                       | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry                     | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

**Repo:** https://github.com/sneldao/ligis (public)

---

## The one-minute technical story

1. An agent wants to pay a counterparty it has never met.
2. It asks the gate. `UNKNOWN` — nobody can vouch for this payee. **It does not
   pay.**
3. The counterparty obtains a `kyc.basic` credential, signed, on-chain.
4. The gate is asked again. `GO`, with the issuer and expiry attached.
5. The issuer revokes it. The gate is asked again. `STOP`.
6. The wallet never signed.

Step 5→6 is the one worth watching: revocation has to actually close the gate,
and the demo now proves it against live chain state rather than a fixture.

---

## Deliverables checklist

- [x] Public GitHub repo accessible by `metropolis@hackathon.monad.xyz`
- [x] Live product on Monad testnet + access instructions (above)
- [x] Public repo with a one-command reproduction of the headline claim
- [ ] Project logo/graphic (JPG/PNG/WEBP, ≤3MB) — **TODO**
- [ ] Technical demo video ≤3 min (live product, not slides) — **TODO**
- [ ] Pitch video ≤2 min (team, problem, why) — **TODO**
- [ ] Portal submission submitted — **TODO**

## What we are not claiming

- No prize, sponsor qualification, or deadline extension is asserted. The
  hackathon rules were behind an authenticated portal we could not read; verify
  eligibility and the exact cutoff there.
- Testnet, not mainnet.
- The wallet integration is a **guarded payment adapter**, not wallet-wide
  enforcement — the host's plugin lifecycle does not permit intercepting
  signing, and we say so rather than implying otherwise.
- The Jev intent layer is advisory and fails open. With it unavailable the gate
  is still a credential check, and we say which signals actually answered in
  every verdict.
- Registration is identity, not reputation. Payment volume is not proof of
  honest service. Our own gate feedback is not allowed to manufacture our own
  trust.
