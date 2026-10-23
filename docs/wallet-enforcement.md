# Wallet enforcement — a guarded signing boundary

`@ligis/wallet-plugin` refuses to sign an EIP-3009 payment authorization
unless the Ligis gate returns a fresh, schema-valid `GO` for that exact
operation under protected operator policy.

> **Scope, stated plainly.** This is a **guarded payment adapter**, not
> wallet-wide enforcement. It governs the signing path it is placed in front
> of. See [Boundary and bypasses](#boundary-and-bypasses) before describing it
> as anything stronger.

## Research gate (checked 2026-10-14)

The brief required verifying the host API before choosing an integration.

| Question                   | Answer                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin manifest            | `mm` block, `schemaVersion: 1`, `minCliVersion: ^6.2.0`, one entry per command; `oclif-plugin` keyword and an `@metamask/agent-wallet` **peer** dependency                                                                                              |
| Signing surface            | Capability `wallet-submit` grants `ctx.walletExecutor(io, "<command-id>")`, accepting `transaction`, `message`, and `typed-data` requests, "still policy-gated by MetaMask"                                                                             |
| Can a plugin veto signing? | **No.** The security lifecycle is sealed — overriding `run`, `runLifecycle`, `beforeExecute`, `init`, `prepareForRepl`, or `withPluginIsolation` throws `PLUGIN_SEALED_OVERRIDE`. Manifests declaring `oclif.hooks` or `oclif.plugins` are **rejected** |
| Other host protections     | Transaction Protection (Blockaid threat scanning), 2FA/MFA approval states, outflow policy in server-wallet mode — host-side, not plugin-controllable                                                                                                   |

Sources: [Build a plugin](https://docs.metamask.io/agent-wallet/plugins/build-a-plugin/),
[Plugins reference](https://docs.metamask.io/agent-wallet/reference/plugins/),
[Architecture](https://docs.metamask.io/agent-wallet/reference/architecture/).

**Consequence.** The plugin model has no interception hook, so no honest
implementation can claim to block signing for the whole wallet. What it _can_
do — and what this package does — is refuse inside the guarded command, and
document every path that bypasses it.

## Install and run

```sh
pnpm --filter @ligis/wallet-plugin build
pnpm --filter @ligis/wallet-plugin test
npx tsx scripts/wallet-enforcement-demo.ts
```

The demo drives the real entry point (`createPaymentGuard().enforce`) with an
injected fixture signer and a simulated gate — no network, no keys, no funds.
Point it at a running gate to assess for real:

```sh
LIGIS_GATE_URL=http://127.0.0.1:3000 npx tsx scripts/wallet-enforcement-demo.ts
```

A fixture signer call is not a settled payment. Nothing is broadcast.

## Operator policy

Policy is the protected half of the decision. It is parsed strictly and fails
closed — an unparseable policy disables signing rather than degrading to a
permissive default.

```ts
const policy = {
  gateEndpoint: "https://gate.example", // HTTPS only, no embedded credentials
  assets: [
    { address: USDC, chainId: 10143, decimals: 6, usdPeg: 1, symbol: "USDC" },
  ],
  chains: [10143],
  payees: ["0x1111…"], // empty = no allowlist
  maxUsd: 25,
  maxValiditySeconds: 300,
  requiredCapability: null, // null = risk decision only
  gateTimeoutMs: 3000,
  minGoConfidence: 0.6,
};
```

`usdPeg` must be `1`. A non-pegged asset needs a priced source, not a guess —
the guard will not invent a dollar figure from arbitrary token decimals. Base
units must be a whole number of the asset, and enforcement is integer-only.

### Agent input is untrusted

`AgentRequest.purpose` and `AgentRequest.mandate` are treated as untrusted.
A mandate may **tighten** policy (lower cap, shorter window) or **add** a
capability requirement. It cannot raise the cap, widen the window, contradict
an operator-required capability, or redirect the gate endpoint. A loosening
attempt is **refused**, not silently ignored, so the caller cannot believe it
relaxed policy.

## What is bound to the decision

Everything the signer will act on is derived from the immutable operation and
hashed into a fingerprint:

`from · payee · asset · chainId · valueBaseUnits · validAfter · validBefore ·
nonce · domainName · domainVersion · verifyingContract`

Refused before the gate is ever consulted:

- a chain outside `policy.chains`
- a verifying contract that is not an approved asset on that chain
- a payee outside a non-empty allowlist
- an amount above `maxUsd`, zero, or a fractional token
- an expired, not-yet-valid, or over-long validity window
- any `primaryType` other than `TransferWithAuthorization` — batched, multicall,
  and opaque calls cannot use the guarded path

After a `GO`, the operation is re-parsed and re-hashed immediately before
signing. Any mutation produces a different fingerprint and refuses with
`stale-approval`.

## Refusals

`STOP` and `UNKNOWN` both refuse. So does everything else:

| Condition                                                     | Code                     |
| ------------------------------------------------------------- | ------------------------ |
| Unusable operator policy                                      | `policy-missing`         |
| Agent tried to loosen policy                                  | `agent-policy-loosening` |
| Unsupported selector / window / amount / payee                | `unsupported-operation`  |
| Gate unreachable, non-200, redirect, or timeout               | `decision-unavailable`   |
| Body not schema-valid, unknown verdict string, bad confidence | `decision-malformed`     |
| `STOP`, `UNKNOWN`, or `GO` below the confidence floor         | `decision-not-go`        |
| Operation changed between assessment and signing              | `stale-approval`         |
| Signer threw                                                  | `signer-failed`          |

`POST /api/gate` returns **HTTP 200 for `GO`, `STOP`, and `UNKNOWN` alike**, so
`response.ok` proves nothing. The guard parses and strictly validates the body,
requires `verdict` to be one of the three known strings, bounds every confidence
to `0..1`, and refuses anything else — including verdict strings a future gate
version might introduce.

## Idempotency

An identical operation replayed against the same guard returns the recorded
signature without re-consulting the gate or re-signing. Any mutation of a bound
field changes the fingerprint and requires a fresh decision. The cache is
in-process and per-guard; a new guard instance re-assesses.

## Boundary and bypasses

The guard fronts `ctx.walletExecutor(...)` typed-data requests. It does **not**:

- block the host's own `mm transfer`, `mm swap`, `mm earn`, or any non-plugin
  command, which do not pass through this guard;
- prevent an operator from approving an MFA prompt in MetaMask Mobile;
- invalidate an authorization that was already signed, or a payment already
  broadcast — this is a pre-signature check, so there is an unavoidable window
  between assessment and settlement;
- guarantee conditions are unchanged at settlement, or prevent revocation races;
- verify a settlement happened. It authorises a signature; settlement is a
  separate question.

Not implemented, by design: any on-chain oracle that accepts arbitrary unsigned
HTTP verdicts. A capability-only caveat is a stricter policy example
(`requiredCapability`), not a substitute for the decision service.

## Dependencies and permissions

Zero runtime dependencies. The `signer` and `transport` are injected, so the
package adds no SDK, network client, or key material to the host. When wired to
MetaMask Agent Wallet, the only capability the guarded command needs is
`wallet-submit` (plus `wallet-read` if it displays signal reasons); it does not
request `mnemonic-read` or `config-write`, both of which the host reserves and
rejects at manifest validation.

## Wiring into the repo's test conventions

`pnpm run test:ts` globs `packages/*/test/**/*.test.ts`, so
`packages/wallet-plugin/test/guard.test.ts` is picked up automatically. The
package also provides its own `build`, `typecheck`, and `test` scripts.

## Not claimed

No npm release, no hosted resource created, no branch pushed for this work,
and no funds spent. Wallet-backed signing in the host has not been exercised —
`ligis:pay` requires `mm login` (MetaMask account auth), and the in-host
demonstration covered `ligis:assess` only: a live `GO` and a live `STOP`
against `https://ligis.vercel.app/api/gate`, captured 2026-10-14 with
`mm plugins link` on agent-wallet 7.2.0. The signature path is covered by unit
tests over an injected signer, not a real wallet.
