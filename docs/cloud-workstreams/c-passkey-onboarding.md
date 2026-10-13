# Worker C: safe passkey onboarding and sponsored gas

Implement on branch `feat/passkey-onboarding`. Read the shared
[`README.md`](./README.md) first; its ownership and safety rules apply.

## Goal

Show seedless operator onboarding and sponsored Monad transactions
around the existing passkey issuer, without confusing possession of a
passkey with permission to issue trusted claims.

Prioritize issuer authorization before adding sponsor polish. Use Privy
for the proposed onboarding integration only after verifying its current
Monad support, passkey behavior, and applicable sponsor rules. Do not
silently pivot to another sponsor or claim Mera eligibility from using
WebAuthn alone.

## Baseline facts and security blocker

Read:

- `web/app/passkey/PasskeyCeremony.tsx`, `web/lib/webauthn.ts`.
- `web/lib/passkey.ts` and `web/app/api/passkey/route.ts`.
- `packages/contracts-evm/src/PasskeyIssuer.sol`.
- `test/PasskeyIssuer.t.sol` and `scripts/webauthn-e2e.ts`.
- `packages/contracts-evm/src/CredentialRegistry.sol` for issuer trust rules.

The existing browser WebAuthn ceremony already exists. The relay key pays
gas; the P256 assertion authorizes issuance. A relay is not a passkey wallet,
and a sponsored secp256k1 wallet does not automatically become a P256 issuer.

**Blocker:** `registerPasskey(keyId, qx, qy)` is currently unrestricted and
overwrites existing entries. Registered keys share the same contract
issuer identity. Permissionless enrollment must not give every signup
the ability to mint claims under one trusted issuer or authorize another
operator's revocations.

## Implement

### 1. Harden the issuer authorization boundary

For this batch, make enrollment owner-authorized and non-overwriting.
Retain owner removal and explicit re-enrollment as the rotation path.
Test unauthorized registration, duplicate IDs, invalid public-key inputs,
removal, and re-enrollment. Keep public signing verification distinct
from permission to enroll an issuer key.

All keys admitted to a single issuer contract are members of that issuer's
authority; they are not isolated tenant identities. Treat this as an
operator issuer desk. Do not enroll arbitrary public signup keys into the
same trusted contract. Multi-tenant permissionless issuers are out of scope.

Check assertion binding and replay behavior against the current
implementation: RP-ID, expected origin, challenge/digest, ceremony type,
user presence/verification requirements, nonce, registry, and chain.
Add regression tests for the discovered boundaries. Fix concrete failures
in the owned contract/module scope; report any larger verifier change
before expanding into a separate authentication project.

An API-only allowlist is insufficient while enrollment remains open at
the contract level. Existing deployed bytecode will remain vulnerable to
the old behavior until an authorized redeploy/cutover. Do not present
local source hardening as proof the live contract changed.

### 2. Add sponsored onboarding as an explicit mode

Add a default-off onboarding/sponsor mode. Verify official Privy/Monad
SDK support and installed types before implementing. Explain exactly
which credential authenticates the user, which key signs the embedded
wallet transaction, and which key authorizes the P256 issuer.

Use scoped server-side sponsorship with:

- Exact chain, target contract, function-selector, and value allowlists.
- Per-user and global request/spend caps, rate limits, and idempotency.
- No arbitrary calldata, arbitrary destinations, or user-selected chain.
- Correct pending nonce handling and safe concurrent submission behavior.
- An authenticated operator enrollment path, separate from public signup.

The current relay already pays gas. If the new flow is still just the
existing steward relay, label it as such; do not call it a paymaster,
ERC-4337 account, or sponsor integration without evidence.

Do not expose sponsor keys or privileged issuer actions in the browser.
Do not silently fall back to an unrestricted funded steward if the
sponsor service fails. Show a clear unavailable/read-only state.

### 3. Close the UX loop honestly

A public signup may create a controlled embedded wallet, but not KYC,
accreditation, or commerce trust. Demonstrate a low-criticality
`demo.passkey` issuance only after an authorized operator admits the key.

Maintain this sequence:

1. User signs in without a seed phrase.
2. Embedded agent wallet and issuer passkey roles are identified.
3. An authorized operator completes allowed enrollment/issuance.
4. A sponsored transaction submits the P256 assertion.
5. Show receipt state and the credential read.
6. Ask the full risk gate with a valid mandate; surface the actual
   GO/STOP/UNKNOWN result rather than deriving aggregate GO from
   `isCapable === true`.
7. Authorized revoke closes the capability again.

If sponsorship or contract cutover is unavailable, ship the guarded
source and a mocked demonstration with visible labels. Do not advertise
the new mode as production-ready.

Keep the existing `/passkey` URL and editorial UI conventions. Use
the existing structures for reduced-motion behavior. No display checkmark
or cross glyphs.

## Acceptance tests

- Unauthorized callers cannot register or replace issuer keys.
- Duplicate key IDs cannot overwrite the existing public key.
- Removed keys cannot authorize new issuance/revocation.
- Tampered digest, wrong RP-ID/origin/type, failed required authenticator
  flags, stale nonce, or wrong chain/registry cannot authorize the operation.
- A public signup cannot enroll into the trusted shared issuer or obtain
  trusted capabilities without authorized operator admission.
- Sponsor refuses wrong contract, selector, chain, nonzero unexpected
  value, exhausted caps, duplicate requests, and arbitrary calldata.
- Concurrent operations do not reuse an unsafe relay nonce.
- Unsupported browser, canceled ceremony, wrong serving origin,
  sponsor outage, pending/reverted transaction, and read failure render
  explicit states, never a fabricated success.
- A completed fixture flow demonstrates issuance and revoke with no
  private signing key in client code.

## Validation and delivery

Run narrow TS/route tests and the Solidity suite:

```sh
bash scripts/forge.sh test --match-contract PasskeyIssuerTest -vvv
pnpm --filter @ligis/web test
pnpm --filter @ligis/web typecheck
pnpm --filter @ligis/web build
pnpm lint:design
```

Verify the actual Solidity test contract name before using the filter;
zero selected tests is not a passing test run. If P256 tests require a
fork, report fixture-only versus live-precompile coverage.

Run browser proof using the existing Playwright approach where practical.
Use a relevant browser skill, an isolated profile, and approved fixture
state. Do not rotate the live RP-ID hash to make localhost tests work.

Deliver `docs/passkey-onboarding.md` with issuer authorization model,
SDK sources/versions, env variable names, sponsorship limits, fixture demo,
and exact proposed migration/cutover steps. Request authorization before
deploying, funding, registering keys, changing trusted issuer config,
rotating RP-ID, or touching Vercel/production.

Any new deployment addresses go to the coordinator as proposed config,
not directly into the shared network file.
