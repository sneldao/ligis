# Ligis: four parallel cloud workstreams

Prepared **2026-10-13** against local baseline **`f4b1786`**. These are
implementation handoffs, not evidence that cloud workers have started.

## Launch

In Factory, start four new sessions, select the same **Ready Environment**
or suitably configured Droid Computers, and give each session its task
brief plus this file. Each worker needs an isolated checkout and branch.
Do not run four writing workers in one working tree.

Factory setup references:
[run Droids on an Environment](https://docs.factory.com/environments/run-droids.md)
and [Droid Computers](https://docs.factory.com/droid-computers/overview.md).

| Worker | Brief                                                         | Suggested branch          | Primary result                                             |
| ------ | ------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| A      | [Standard-backed payee evidence](./a-payee-evidence.md)       | `feat/payee-evidence`     | Open-world risk read without inventing trust               |
| B      | [MetaMask wallet integration](./b-wallet-enforcement.md)      | `feat/wallet-enforcement` | Payment guard at a verified signing boundary               |
| C      | [Safe passkey onboarding](./c-passkey-onboarding.md)          | `feat/passkey-onboarding` | Authorized issuer keys plus sponsored onboarding           |
| D      | [External evidence and outcome kit](./d-evidence-outcomes.md) | `feat/evidence-outcomes`  | Nansen adapter, opt-in outcome records, integrator example |

Before starting, confirm that the cloud checkout contains `f4b1786`.
If it does not, report the mismatch rather than silently using a different
baseline. Preserve any user changes. Create the suggested feature branch
only after inspecting repository status.

These files are not yet published to the remote repository. Attach or paste
them into cloud sessions, or separately authorize a commit and push. Do not
assume another cloud instance can see local files or another worker's edits.

## Objective

Make Ligis useful as a neutral pre-payment risk layer that composes with
existing agent standards, wallets, and payment rails. Monad is the
hackathon integration; private testnet registries remain optional
capability provenance, not a claim to universal merchant coverage.

Do not optimize prize coverage by adding four disconnected sponsor demos.
The shared demonstration is: an unfamiliar registered payee is assessed
with named evidence, the wallet honors the decision before signing, an
operator can onboard without a seed phrase or gas prompt, and an actual
settlement can later be correlated with the decision.

The public hackathon URL returned a login page during preparation.
`docs/metropolis-hackathon.md` contains prior research, not fresh verification
of sponsor eligibility or the exact cutoff. The owner must check the
authenticated rules. Do not claim a prize, deadline extension, or sponsor
qualification from these briefs.

## Read first

- Repository `AGENTS.md` and any more specific instructions.
- For web changes, `web/AGENTS.md` and the relevant installed Next.js guides
  under `web/node_modules/next/dist/docs/`, resolving the package if needed.
- `docs/positioning.md`, `docs/metropolis-hackathon.md`, and your assigned
  brief. Some older docs contradict current code. Report those discrepancies.
- `package.json` and `web/package.json` for actual validation commands.

Use absolute paths in tool calls. Resolve the checkout's absolute root;
do not reuse the preparer's `/Users/...` path in a cloud environment.

## Shared invariants

1. **STOP wins. UNKNOWN is not GO.** An unavailable upstream is surfaced with
   a reason, not treated as positive evidence.
2. Registration is identity, not reputation. Reputation is not KYC or proof
   of a specific capability. Payment volume is not proof of honest service.
3. Independent client addresses alone do not prove Sybil resistance.
   Ligis's own gate feedback must not recursively manufacture trust.
4. Deterministic payee and amount constraints stay in code. Jev is advisory
   evidence, never permission to violate the operator's policy.
5. `/api/gate` currently returns HTTP 200 for GO, STOP, and UNKNOWN. Clients
   must validate the JSON verdict. An HTTP success is not payment approval.
6. The current JSON mandate is caller-supplied, not cryptographically
   authenticated. A wallet must load operator policy from a protected
   configuration, not accept an agent's more permissive replacement.
7. Passkeys prove control of a key, not a merchant's honesty or KYC status.
   Signup, payment, and sponsorship must not automatically mint trust.
8. Read/preview requests do not automatically submit ERC-8004 feedback.
   Decisions are not payment outcomes. No fabricated traffic or callers.
9. No secret values in source, logs, screenshots, commits, or task reports.
10. Preserve existing Casper/Pharos/Monad demos and explicit strict
    credential checks. Do not globally relax `isCapable` or the x402
    server's access-control semantics.

## File ownership

Workers may inspect any relevant code but only edit their assigned scope.
If a required change crosses ownership, describe the exact integration
patch in your report instead of editing another worker's files.

- **A** owns gate composition and evidence wiring: `web/lib/decide.ts`,
  `web/lib/gate-run.ts`, `web/lib/erc8004.ts`, `web/lib/resolve.ts` if needed,
  gate-related tests, `docs/decide-api.md`, the Envio indexer, and new
  `web/lib/payee-evidence/{types,index,erc8004,settlements}.ts`.
  A may update `web/components/GateDecision.tsx` and
  `web/lib/decision-receipt.ts` with their associated tests for UNKNOWN
  handling. Preserve credential-read interfaces.
- **B** owns new `packages/wallet-plugin/`, new
  `scripts/wallet-enforcement-demo.ts`, and `docs/wallet-enforcement.md`.
  B does not edit the gate or passkey code.
- **C** owns `web/app/passkey/`, `web/app/api/passkey/route.ts`,
  `web/lib/passkey.ts`, `web/lib/webauthn.ts`, new
  `web/lib/passkey-sponsor.ts`, passkey-specific tests,
  `packages/contracts-evm/src/PasskeyIssuer.sol`,
  `test/PasskeyIssuer.t.sol`, `web/package.json`, and
  `docs/passkey-onboarding.md`.
- **D** owns new `web/lib/payee-evidence/nansen.ts`, new
  `web/lib/gate-outcomes/`, new `web/app/api/gate/outcomes/`,
  new `web/test/nansen.test.ts`, new `web/test/gate-outcomes.test.ts`,
  new `examples/gate-integrator/`, and `docs/evidence-outcomes.md`.
  D proposes gate hooks to A; D does not edit `gate-run.ts`.
- **The coordinator** owns `pnpm-lock.yaml`, root configuration,
  `assets/networks.json`, `docs/positioning.md`, `docs/integrate-monad.md`,
  `docs/metropolis-hackathon.md`, global navigation, shared display
  components other than A's assigned component, and final claims.

For new workspace dependencies, B may edit its package manifest and C may
edit `web/package.json`. Workers may regenerate a lockfile locally to test,
but do not submit competing root lockfile changes. Report dependencies;
the coordinator regenerates and validates one combined lockfile.

## A/D interface contract

This is a **proposed implementation contract**, not an existing export.
A creates `web/lib/payee-evidence/types.ts`. D can define structurally
matching local types while working against the baseline and switch to a
type-only import after integration. Neither branch may need the other to
pass its standalone tests.

```ts
type PayeeEvidence = {
  source: "ligis-credential" | "erc8004" | "x402-settlement" | "nansen";
  status: "positive" | "negative" | "unknown" | "unavailable";
  reason: string;
  observedAt: string;
  chainId?: number;
  reference?: string; // validated registry, transaction, or provider reference
  limitations: string[];
};
```

D exposes `readNansenEvidence(payee, options)` with an injectable transport,
timeout, and chain context. A exposes an injectable evidence-reader seam
and retains source results separately from the aggregate verdict.
Evidence status is not a gate verdict; A applies operator-owned policy.

D exposes an opt-in recorder accepting a decision and validated payment
context, returning a correlation identifier or an explicit disabled/error
result. D documents its exact export and proposed call site. A wires that
hook only after D's privacy and storage conditions are met.

Do not expand the public payment wire shape independently in B or D.
If settlement correlation needs payer, asset, chain, or integer token
amount fields, propose a validated schema extension to A and the coordinator.
USD alone cannot prove a token settlement matches a payment.

## Integration order

1. A publishes its types and policy tests early. B, C, and D remain
   independently testable against the baseline.
2. Review and integrate A's evidence mode behind a default-off flag.
3. Integrate D's adapter and recorder; A or the coordinator applies the
   proposed gate wiring. Update privacy documentation before enabling it.
4. Integrate B against the resulting API; prove actual signing refusal.
5. Integrate C only after its issuer authorization tests pass. A
   contract redeploy, new RP-ID, or funded live sponsor test is a separately
   authorized operation, not an automatic merge side effect.
6. Regenerate the combined lockfile, build, run regressions, then prepare
   the submission demonstration. Do not advertise unmerged or unverified work.

Other reasonable merge orders are allowed for independent work, but no
worker should wait idle for another branch: use injected doubles.

## Setup and validation

Use Node compatible with the installed Next.js release and
`pnpm@10.33.2`. After inspecting package scripts, install with
`pnpm install --frozen-lockfile` and build the dependencies needed by the web:

```sh
pnpm --filter @ligis/core --filter @ligis/agent-logic --filter @ligis/zerog --filter @ligis/adapter-casper --filter @ligis/adapter-evm run build
pnpm --filter @ligis/web test
pnpm --filter @ligis/web typecheck
pnpm lint:design
```

Run narrow new tests while implementing. The coordinator then runs
`pnpm run test:ts` and `pnpm --filter @ligis/web build` on the combined
branch, plus `pnpm test` for Solidity changes. Missing Foundry, Docker,
API access, or credentials are blockers to report, not tests to fake.
Avoid Casper WASM and GenLayer work unless a demonstrated regression
requires it.

Live Jev verification is separate: `pnpm smoke:jev` needs an approved
credential and may incur charges. A stub can test behavior but cannot prove
the production route or current price works.

## Authorization and worker delivery

Implementation and local tests are in scope. Deployment, on-chain writes
including testnet feedback, sponsor spending, production env changes,
public posting, repository access changes, and contacting a team are not.
Ask for exact authorization and a spending cap before those actions.
Keep all new live features disabled by default.

Do not start fresh sessions with broad production credentials. Provision
only the minimum scoped credentials through Factory runtime secrets.
No secrets are required for mocked acceptance tests.

Do not push, open PRs, publish a Snap, or merge without authorization.
Workers return local branches or reviewable patches. If commits are
requested, obey repository Git rules and preserve the configured identity.

Each report must contain:

- Summary, changed files, branch/base, and commit IDs if authorized.
- Acceptance criteria passed, tests run, failures, and skipped live checks.
- Required dependencies, **secret names only**, and default-off flags.
- Source URLs/date for any verified sponsor or SDK requirement.
- Integration patch suggestions and outstanding security limitations.
- A reproducible demo script; distinguish fixtures from live evidence.

## Deliberately outside this batch

AP2 mandate verification, automatic reputation publication, a Base or
Solana production rollout, training a risk model, pricing changes, and
customer outreach. These are valuable follow-ups, not features to imply
have shipped. The connector kit enables a real caller; it does not create
one.
