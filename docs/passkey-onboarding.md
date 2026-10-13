# Ligis C — Passkey onboarding — 2026-10-13

## Outcome and isolation

Guarded local source and a cryptographic browser fixture, not production-ready
onboarding or live sponsorship. No deployment, funding, chain write, enrollment,
RP-ID rotation, production change, commit, push or PR was performed.

- Workspace: `/tmp/ligis-passkey-onboarding-gy9q4UnB/repo`
- Branch: `feat/passkey-onboarding`
- Exact base: `f4b1786326b1677b4fee97b8f30b2120d53c2f47`
- Source of local Git history: `/tmp/ligis-payee-evidence-KB83akXO/repo`.
  This was the existing Ligis checkout available in this cloud environment.
  Cloned with `git clone --no-hardlinks` into a unique `mktemp` workspace.
  Its working tree was never edited or copied. No connection to the separate
  computer `pal` was available, and no original-user-checkout claim is made.
- Canonical repository supplied by the user: https://github.com/sneldao/ligis
- Each clone has its own `node_modules`. No shared or symlinked dependency tree.
- `pnpm` 10.33.2; baseline `pnpm install --frozen-lockfile` passed.
  Adding SDKs regenerated a local validation lockfile. The shared tracked
  `pnpm-lock.yaml` is restored to baseline, not included in this workstream.
  The coordinator must regenerate the merged lockfile before a frozen install
  can accept the new manifest.

## Changed files

- `packages/contracts-evm/src/PasskeyIssuer.sol`
- `test/PasskeyIssuer.t.sol`
- `web/app/api/passkey/route.ts`
- `web/app/passkey/page.tsx`
- `web/app/passkey/PasskeyCeremony.tsx`
- `web/app/passkey/PrivyOnboarding.tsx` (new)
- `web/lib/passkey.ts`
- `web/lib/webauthn.ts`
- `web/lib/passkey-sponsor.ts` (new)
- `web/test/passkey-sponsor.test.ts` (new)
- `web/test/passkey-browser.ts` (new)
- `web/package.json` (SDK additions only)
- `docs/passkey-onboarding.md` (new)

No changes to gate/evidence, wallet-plugin, outcomes/Nansen, root config,
positioning, navigation, or network addresses.

## Issuer authorization model

The contract owner alone calls `registerPasskey`. Non-owner registration and
replacement revert. Duplicate IDs never overwrite. Zero IDs, infinity,
out-of-field coordinates and off-curve P-256 points are rejected.
Owner removal, followed by explicit re-enrollment, is the rotation path.
Removed keys cannot authorize issue or revoke.

Every admitted key is a member of **one shared operator issuer desk**. It can
authorize the desk's claims and revoke another desk operator's claims. This is
not tenant isolation. Arbitrary public signup keys must never be admitted.
Public `isValidSignature` verifies signatures; it does not grant enrollment
permission. Owner authentication is enforced by `msg.sender` on-chain, not by
an API-only allowlist. The public API's `enroll` action always refuses.
There is deliberately no HTTP owner-key signer or browser owner action.

Assertion checks now require:

- Exact RP-ID hash and separately configured exact serving-origin hash.
- User presence **and** user verification; valid backup-flag combination.
- `webauthn.get`, exact digest challenge, and no cross-origin assertion.
- Registry EIP-712 issuance binding to issuer, subject, capability, times,
  registry, chain and issuer nonce.
- Revocation binding to issuer contract, registry, subject, capability,
  credential nonce and chain. Already-revoked credentials cannot replay.

The origin starts unconfigured and fails closed until the owner calls
`setOriginHash`. The original single-argument constructor remains compatible
with existing scripts. No live RP-ID was changed.

The client-data verifier intentionally accepts only compact browser ordering
`type`, `challenge`, `origin`, with optional trailing `crossOrigin:false`
and Chromium's exact, known `other_keys_can_be_added_here` sentinel.
It rejects duplicate fields, nested substring tricks, escaped origins,
whitespace/reordering, unrecognized extensions and `crossOrigin:true`.
This is a conservative compatibility limitation, not a general JSON parser.
Browser validation caught the intermittently added Chromium sentinel, which now
has Solidity and cryptographic fixture regressions. Other browsers require explicit
compatibility validation; do not loosen checks through substring matching.
The narrower verifier change was reported before implementation.

**Existing deployed bytecode remains vulnerable.** Source hardening is not
evidence of a redeploy. No historical registry credential gains trust from
this change, and removing an old key does not invalidate its old credentials.

## SDK research and provider status

Execution date: **2026-10-13**. Official pages were discovered with web search
and inspected as public Markdown. Installed declarations were inspected before
the provider integration was written.

| SDK/source             | Version or finding                                                                                                                                                        | Official URL                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@privy-io/react-auth` | Pinned 3.48.1; `useSignupWithPasskey`, `useLoginWithPasskey`, `PrivyProvider`, `useWallets` exist in installed types                                                      | https://docs.privy.io/authentication/user-authentication/login-methods/passkey  |
| `@privy-io/node`       | Pinned 0.35.0; `verifyAccessToken` and typed Ethereum `sendTransaction` with sponsorship/idempotency exist                                                                | https://docs.privy.io/wallets/gas-and-asset-management/gas/setup                |
| EVM configuration      | Official guide supports configuring EVM networks, including Monad; integration pins `monadTestnet`                                                                        | https://docs.privy.io/basics/react/advanced/configuring-evm-networks            |
| Native gas sponsorship | Official app-pays list includes **Monad and Monad Testnet**. EVM native sponsorship uses EIP-7702 plus paymasters, distinct from a separate ERC-4337 smart-wallet account | https://docs.privy.io/wallets/gas-and-asset-management/gas/overview             |
| Prerequisites          | Native sponsorship requires TEE execution, dashboard enablement, selected chains, and billing configuration; mainnet prepaid sponsorship needs a saved payment method     | https://docs.privy.io/wallets/gas-and-asset-management/gas/setup                |
| Abuse controls         | Per-user/wallet limits, spend caps, server routing, simulation and circuit breakers                                                                                       | https://docs.privy.io/wallets/gas-and-asset-management/gas/security             |
| Receipts               | Server returns transaction ID/user-operation hash after broadcast; final transaction hash arrives later. Broadcast is not confirmation                                    | https://docs.privy.io/wallets/gas-and-asset-management/gas/transaction-handling |

Privy passkey signup creates a provider account; login authenticates an existing
account. Neither automatically enrolls its passkey in `PasskeyIssuer`.
The optional provider creates an embedded Ethereum wallet without presenting a
seed phrase. Roles are separate:

1. **Privy login passkey** authenticates the provider account.
2. **Embedded secp256k1 wallet key** would sign the transaction.
3. **Separately owner-admitted P-256 issuer passkey** authorizes the claim digest.

This branch includes actual, optional Privy signup/login and session verification,
but **no enabled live provider submission path**. The request builder is checked
against the installed Node SDK types and pins sponsorship to an approved
server-built payload. It is not evidence of a provider transaction.

No app credentials, TEE configuration, billing, provider policies or sponsor
authorization were verified. The public hackathon portal exposes only a login
page, so authenticated **hackathon sponsor rules and eligibility remain
unverified**. Do not claim the Privy bounty or Mera eligibility from WebAuthn.
There is no pivot to another sponsor.

The old funded steward was a gas-paying relay, not a passkey wallet, paymaster
or ERC-4337 integration. Its signer and generic fallback keys are removed from
this passkey path. Sponsorship failure never invokes it.

## Default-off sponsorship and limits

Live issue/revoke/prepare actions return explicit unavailable/read-only states,
even if the sponsor mode is requested. Signup cannot obtain trusted claims.
Privy onboarding is separately opt-in. The local fixture is opt-in and cannot
run under `NODE_ENV=production`.

The implemented server-side **fixture** policy permits only:

- Chain 10143, never a caller-selected chain.
- Registry `issue`, selector `0xad61ece0`, with the configured passkey issuer.
- Configured issuer `revokeCredential`, selector `0xd626b1c5`, with the configured registry.
- Only `demo.passkey`, zero native value, canonical ABI calldata without trailers.
- The exact internally prepared operation and a verified admitted P-256 assertion.
- No enrollment, arbitrary destination, raw calldata or trusted capability.

Targets resolve from the baseline shared network config; no new addresses were
invented or installed. The HTTP fixture submit endpoint rejects extra routing
fields and accepts an operation ID plus assertion, not a raw transaction.

| Reservation/limit                   | Value               |
| ----------------------------------- | ------------------- |
| Per-user requests                   | 4                   |
| Global requests                     | 40                  |
| Per-request maximum reserved spend  | 0.001 MON           |
| Per-user reserved spend             | 0.002 MON           |
| Global reserved spend               | 0.010 MON           |
| Per-user spacing                    | 1 second            |
| Fixture session lifetime            | 1 hour              |
| Prepared assertion lifetime         | 2 minutes           |
| Session count / prepared operations | 40 / 20 per session |
| HTTP request body                   | 16 KiB              |

These are lifetime limits for an in-memory local process, **not production
daily quotas**. They do not survive restarts or coordinate multiple instances.
Native provider convenience fees are not bounded by simulated chain-cost
reservations. A durable atomic quota/idempotency ledger and provider billing
caps must replace this fixture before live mode can exist.

Requests are deduplicated; reservations happen before submission. Ambiguous
submission failures retain the reservation, poison the fixture queue, and do
not retry/fall back. Pending nonce reads and sends are serialized, and the
next nonce is the maximum of pending and locally reserved nonce. Concurrency
tests prove unique nonces in the local coordinator. **No funded relay exists
here**, so this is not distributed live-nonce proof. A future provider path
must use per-wallet durable serialization and Privy idempotency, without mixing
a raw steward relay with provider-managed EIP-7702 nonces.

## Fixture demo and UX

Use the clone's installed dependencies. Enable the local fixture, set the RP-ID
to the local hostname, and configure the exact local origin including port.
Start Next on loopback, for example port 3103:

```sh
pnpm --dir web exec next dev --webpack --hostname 127.0.0.1 --port 3103
pnpm exec tsx web/test/passkey-browser.ts
```

The environment variable names needed are listed below; never supply sponsor
or owner credentials for this fixture. If Playwright's expected browser revision
is absent, point the browser executable override at an existing Chromium.
Do not rotate any live contract's RP-ID to make localhost work.

1. Open `/passkey`. The banner labels the fixture and every mocked role.
2. Simulate seedless sign-in. The displayed embedded wallet is a mock address,
   not funded, provider-created, or a new trusted identity.
3. Create a **real browser** P-256 passkey requiring user verification.
4. Explicitly simulate authorized operator admission. Issuance stays disabled
   before this step; this is not a live owner transaction.
5. Touch to issue `demo.passkey`. The browser signs the bound digest; the
   fixture server cryptographically verifies it. Receipt and credential read
   are visibly mocked, with no fabricated explorer hash.
6. Ask the **full risk gate**. The UI posts a valid mandate with payee, USD
   amount, purpose, capability, allowlisted payee, max and expected amount.
   It displays the endpoint's actual GO/STOP/UNKNOWN and signal stack,
   never a verdict inferred from `isCapable`.
7. Touch to revoke and read the revoked fixture credential. Ask the gate again.
   Real configured gate sources do not see the mocked credential and may return
   STOP or UNKNOWN. A fixture must not create live trust.
8. Select pending, reverted, read-failure or sponsor-outage scenarios. Each is
   explicit, clears any prior verdict/read, and cannot produce false success.

The browser proof intercepts `/api/gate` with **labelled browser fixtures** to
test GO, UNKNOWN and STOP rendering and verifies the valid mandate POST.
This is neither live gate proof nor a live issue/revoke transition.
Unsupported browsers, wrong origins and cancellation are separately exercised.
The fresh browser profile contains no saved login or private signing key.
The fixture uses CDP's isolated virtual authenticator, not a client-code key.

The `/passkey` route and editorial `route-shell`, `display`, and `border-terra`
structures are preserved. Browser proof uses reduced motion. No check/cross
glyphs are introduced in display copy.

## Validation

- Passed: baseline frozen install and the five-package web dependency build.
- Passed: web test suite, **75 tests**, zero failures.
- Passed: web typecheck, after fixing an initial test-only readonly
  `NODE_ENV` assignment by making the fixture guard directly testable.
- Passed: web production build, Next 16.4.0, using the locally regenerated
  validation lockfile. SDK warnings include an optional missing Farcaster
  mini-app module and an `ox` dynamic dependency; no root webpack aliases added.
- Passed: design lint; final scoped formatting and validation recorded in run report.
- Passed: isolated Solidity **compilation only** with `solc`
  0.8.24+commit.e11b9ed9, optimizer 200. This is not Solidity test execution.
- Blocked: `bash scripts/forge.sh test --match-contract PasskeyIssuerTest -vvv`.
  Foundry is absent; Docker is also absent. The correct contract is
  `PasskeyIssuerTest`, with **24 test functions in source**. Since the command
  cannot start, a positive executed/filter-selected test count is **not verified**.
- Solidity P256 assertions use `vm.mockCall` and are fixture-only. No Monad
  fork/live `0x0100` precompile coverage was executed. No test is reported as
  live merely because its Solidity wrapper compiles.
- Passed: isolated Playwright/CDP browser proof, including real create/get,
  fixture issue/revoke/read, valid full-gate POST with labelled GO/UNKNOWN/STOP
  responses, pending/reverted/read-failure/outage states, unsupported browser,
  wrong origin and cancellation. Reduced motion enabled.
  Screenshot: `/tmp/ligis-passkey-onboarding-gy9q4UnB/passkey-fixture-browser.png`.
  Initial attempts found a browser revision mismatch, cold compilation timeout
  and Chromium's intermittent sentinel field. The executable/timeout were
  adjusted, the verifier compatibility failure was fixed with regressions,
  and the final browser run passed. No shared browser installation was changed.
- Skipped: provider-account signup/login, app sponsorship, deployment/cutover,
  live owner admission, live issue/revoke, fork and production verification.
  No credentials were loaded and no chain or sponsor balance was spent.

## Environment variable names only

Used: `LIGIS_PASSKEY_FIXTURE`, `LIGIS_PASSKEY_RP_ID`,
`LIGIS_PASSKEY_ORIGIN`, `LIGIS_PASSKEY_PRIVY_ONBOARDING`,
`NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`,
`LIGIS_PASSKEY_SPONSOR_MODE`, `LIGIS_MONAD_RPC_URL`, `NODE_ENV`.

Browser proof: `BASE_URL`, `PASSKEY_BROWSER_EXECUTABLE`.

Removed from this passkey signer path: `LIGIS_STEWARD_KEY`, `PRIVATE_KEY`,
`PHAROS_DEPLOYER_KEY`. No new owner or sponsor private-key variable is consumed.
A future separately authorized provider backend would need server-side app
authorization, but is deliberately not configured by this branch.

## Exact proposed migration/cutover, NOT executed

1. Keep all live writes off. Remove legacy open-enrollment issuers from trusted
   policy through a separately authorized coordinator change. Audit their
   admitted keys and existing credentials; treat old issuer authority as
   compromised until reviewed. Do not merely switch the UI.
2. Obtain Foundry and forge-std, run the exact filtered suite, and verify it
   selects more than zero tests. Verify the new assertion format with a
   local-contract browser test and a read-only Monad fork/precompile vector.
3. Resolve the registry collision concern below and trusted-issuer enforcement
   with worker A before claiming safe trusted capability reads.
4. Separately authorize deployment of a new `PasskeyIssuer` to the approved
   Monad chain. Preserve the production RP-ID. Owner sets the exact origin hash
   and independently reviews every public key before explicit enrollment.
   Public Privy signup is not an admission source.
5. Verify deployed runtime bytecode/source, owner, RP-ID/origin hashes, failure
   of non-owner enrollment, duplicate rejection, and issuer registry/chain
   bindings. This branch does not supply a new deployment address.
6. Coordinator updates only the approved network manifest and trusted-issuer
   policy with verified new addresses. Reissue reviewed low-criticality
   credentials under the new issuer; old assertions and contract identities
   do not migrate. Revoke/remove old authority only with separate authorization.
7. Before enabling a future live sponsor path, verify the Privy app's TEE,
   allowed origin, chain, server-only routing, billing limits, wallet ownership
   and operator admission. Install deny-by-default provider policies plus
   durable atomic request/spend/nonce/idempotency controls. Test out-of-policy
   requests and failed/pending receipts without automatic fallback.
8. Obtain separate authorization for a bounded live issue/revoke proof and gas
   spend. Await actual confirmed receipts, then fresh credential reads and the
   full mandated gate verdict. Do not treat an API user-operation hash as a
   confirmed transaction.

## Cross-worker integration proposals

### Coordinator: deployment script and CLI digest, exact patches

The deployment script is outside C's ownership and is unchanged. After separate
deployment authorization, it needs this origin configuration before admission:

```diff
--- a/script/DeployMonadV2.s.sol
+++ b/script/DeployMonadV2.s.sol
@@
         PasskeyIssuer passkeyIssuer = new PasskeyIssuer(rpIdHash);
+        passkeyIssuer.setOriginHash(sha256("https://ligis.vercel.app"));
```

Remove the script/browser-test advice to rotate a live RP-ID for local testing.
Use isolated local fixtures instead. The existing `scripts/webauthn-e2e.ts`
remains untouched and **must not be run** against the vulnerable live issuer.

The old CLI revoke digest is incompatible with the hardened issuer's explicit
contract binding. Proposed exact change:

```diff
--- a/scripts/monad-passkey-issue.ts
+++ b/scripts/monad-passkey-issue.ts
@@
-        ["string", "address", "address", "bytes32", "uint256", "uint256"],
+        ["string", "address", "address", "address", "bytes32", "uint256", "uint256"],
         [
           "LigisPasskeyRevoke",
+          PASSKEY_ISSUER,
           REGISTRY,
```

CLI enrollment must be executed only by the actual new issuer owner. Its
`isCapable` logging must not label that boolean as a full GO/STOP risk verdict.
No CLI chain writes were run here.

### Worker A/coordinator: registry namespace concern

Inspection found `_credentials[subject][capabilityHash][nonce]` storage keyed
without issuer, while `issuerNonce` is per issuer. A separate issuer can issue
the same subject/capability/nonce and overwrite that slot. This pre-existing
cross-scope issue is not fixed by owner-only passkey enrollment. Trusted reads
must not rely on the old slot or an unrestricted any-issuer capability boolean.

An exact interim anti-overwrite proposal, **not a full multi-issuer fix**:

```diff
--- a/packages/contracts-evm/src/CredentialRegistry.sol
+++ b/packages/contracts-evm/src/CredentialRegistry.sol
@@
     error UnknownCredential();
+    error CredentialSlotOccupied();
@@
-        _credentials[subject][capabilityHash][nonce] = Credential({
+        if (_credentials[subject][capabilityHash][nonce].issuer != address(0)) {
+            revert CredentialSlotOccupied();
+        }
+        _credentials[subject][capabilityHash][nonce] = Credential({
```

This prevents replacement but leaves collision/front-running denial of service.
The coordinator must review an issuer-indexed credential schema and matching
read/revoke/event interfaces, with two-issuer same-nonce regression tests,
before a trusted multi-issuer deployment. C does not expand into registry/gate code.

### Worker B

An embedded wallet is not a P-256 issuer. Consume the actual full gate verdict
and signal stack before payment. Do not authorize spend from fixture receipt,
signup, operator passkey possession or `isCapable` alone. Do not import any
owner/sponsor key into the wallet plugin.

### Worker D

Record fixture provenance, provider-disabled state and confirmed/read-failed
receipt distinctions. Do not count mock transactions as chain outcomes or
claim hackathon sponsor eligibility. C supplies no live transaction hash.

### Coordinator: privacy and dependency merge

Privy introduces a client SDK, third-party authentication and session behavior,
contradicting the documented no-client-SDK/no-cookie posture. Do not enable
the optional provider UI before an approved route-specific policy disclosure.
The gate/embed posture and their copy remain untouched here.

Proposed **policy wording for review**, not an edit made by C:

```diff
--- a/docs/positioning.md
+++ b/docs/positioning.md
@@
- No client SDK ships to the visitor's browser.
+ No client SDK ships on the gate or embed surfaces. The separately opt-in
+ /passkey onboarding surface uses Privy authentication and an embedded-wallet
+ SDK, with provider session storage disclosed before sign-in. It grants no
+ issuer authority or payment trust.
@@
- No third-party analytics, no fingerprinting, no cookies set by Ligis.
+ No third-party analytics or fingerprinting on gate/embed. Optional /passkey
+ authentication has a separate provider session/storage disclosure; it is
+ not covered by the gate/embed no-cookie promise.
```

The coordinator owns final privacy wording and any `/embed` consistency change.
Merge only the SDK manifest additions (`@privy-io/react-auth` 3.48.1 and
`@privy-io/node` 0.35.0), then regenerate the shared lockfile once across all
workers. Do not copy the locally regenerated validation lock wholesale.
