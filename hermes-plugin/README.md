# ligis — check that a payee holds a live credential before you pay it

> Hermes agents pay other agents. When they do, the destination address comes
> from the HTTP answer that is asking for the money — and nothing in the x402
> flow ties that address to anything the payee has proven about itself.
>
> `ligis` closes that gap the way the rest of the agent stack already works:
> **with a credential.** Not a list of known-good endpoints, not a spend cap —
> a *capability credential* issued by a third party, revocable by that issuer,
> readable from the chain.

---

## What it does

Four tools and one gate, all read-only:

| Surface | What it does |
|---|---|
| `ligis_check_capability` | Is this address credentialed for this capability? Returns `capable` / `unverified_issuer` / `revoked` / `expired` / `none` / `unknown`, with the issuer, expiry and capability hash. |
| `ligis_capability_hash` | The chain-agnostic keccak-256 hash of a capability name. |
| `ligis_verify_payee` | The four-signal payment verdict: `right-payee`, `right-amount`, `in-scope`, `verified-payee` → `GO` / `STOP` / `UNKNOWN` with the full stack. |
| `ligis_verify_payment` | The payee check for an x402 payment requirement or a signed payment header — for agents paying through a wallet server, where no hook can see the payee. |
| `ligis_chains` | The chains this plugin can read, with registry addresses. |
| `pre_tool_call` hook | Intercepts payment-shaped tool calls and escalates to Hermes's approval prompt when the payee cannot be credentialed. |
| `transform_tool_result` hook | Annotates an x402 402 challenge with the payee's credential verdict, before the agent signs anything. |

## Why it needs no key

The credential registry is **public chain state**. Verifying a credential is a
read: one `eth_call` against a public JSON-RPC endpoint. No key, no account,
no hosted service, nothing to trust but the chain itself.

That is not a simplification — it is the point. A plugin that needed a signing
key to *check* whether a payee was entitled would be a much worse plugin. The
whole trust surface is the chain.

## Why the capability hash matters

A capability is indexed by the **keccak-256 hash of its name**, not by any
chain-specific identifier:

```
keccak256("agent.commerce.escrow")
  = 0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8
```

The same name therefore resolves to the same bytes on **every** chain, so the
same capability is *addressable* everywhere — and an issuer's credential for
it resolves identically on each chain it issued on.

What this is **not**: it does not make a credential portable by itself. The
issuer still issues per chain. Measured on the demo subject:

| Capability | Monad Testnet | Pharos Atlantic |
|---|---|---|
| `agent.commerce.escrow` | issuer `0x0DBCF…`, valid | issuer `0x0DBCF…`, valid |
| `kyc.basic` | issuer `0xd21a…`, **revoked** | issuer `0x0DBCF…`, valid |

Same capability hash on both chains; the *issuance* differs. The hash makes
the capability name portable, not the attestation.

A second detail worth knowing: `isCapable()` falls back to the newest
still-valid nonce, so revoking the newest credential does not clear the
subject. "Revoked" and "never issued" are genuinely different reads, and
the plugin reports them differently.

## Verified in a live Hermes session

Not just in tests. Driven through a running Hermes agent, with the plugin
installed from this repository at the pinned commit, against a live x402
server:

| What | Result |
|---|---|
| `ligis_capability_hash("agent.commerce.escrow")` | `0x17775e48…a3ebf8` — the registry's hash |
| `ligis_check_capability(0xd21a…27Ec, agent.commerce.escrow, issuer=0x0DBC…3aAf)` | `capable`, verified issuer `0x0DBCF8D1…93aAf` |
| a 402 challenge naming an **uncredentialed** payee | annotated: *"does NOT hold a live 'agent.commerce.escrow' credential … You are about to pay an uncredentialed counterparty."* |
| a 402 challenge naming a **credentialed** payee | annotated: *"HOLDS a live 'agent.commerce.escrow' credential, issued by 0x0DBCF… on Monad Testnet."* |
| Payment to `0x…dEaD` (no credential), `mode: enforce` | **blocked** by the gate, with the credential evidence |
| Payment to `0xd21a…27Ec` (credentialed by a trusted issuer), `mode: enforce` | **allowed through** to the tool |

The blocked case is the one that matters: the agent asked to send value to
an address that cannot be credentialed, and the gate stopped it and said
why — naming the payee, the capability, the chain, the registry address,
and the fact that no credential exists.

## Live proof

Every row below is re-read from the chain on demand, not a recorded
expectation. Run `python3 fixtures/selftest.py` to reproduce them.

| Subject | Capability | Chain | Result |
|---|---|---|---|
| `0xd21a…27Ec` | `agent.commerce.escrow` | Monad Testnet | **capable** |
| `0xd21a…27Ec` | `kyc.basic` | **Pharos Atlantic** | **capable** |
| `0xd21a…27Ec` | `demo.metropolis.revocation` | Monad Testnet | **revoked** |
| `0x0000…dEaD` | `kyc.basic` | Monad Testnet | **none** |

Note rows 1 and 2: the same subject, two different capabilities, two
different chains, two different registries — and the **same issuer**
(`0x0DBCF8D105A0a14BE81Ee733c303849474293aAf`) signed on both. That is the
chain-agnostic credential identity in action.

Row 3 is the one no spend-cap plugin can see: the credential *exists* in the
registry, and it reads as present — but its issuer revoked it, so
`isCapable` returns false. Row 4 is a subject that never held one.

## Scope, stated plainly

Where the payee is visible, the plugin gates it. Where it is not, it says so
rather than pretending.

| Payment shape | Covered how |
|---|---|
| `cast send <addr>`, `solana transfer`, `near call --deposit` | `pre_tool_call` gate — blocked or escalated |
| `curl -H 'X-PAYMENT: <base64>'` | `pre_tool_call` gate — the payee is recovered from the decoded header |
| A 402 challenge in any tool result | `transform_tool_result` — the verdict is annotated into the result before the agent signs |
| An MCP tool with a payee-shaped argument | `pre_tool_call` gate |
| A wallet server that takes the 402 and settles it itself (`mpp_fetch`, `pay`, `switch402`) | **not** gated by a hook — the payee never reaches the agent. Call `ligis_verify_payment` with the challenge instead. |

That last row is the same gap ERC-8478 describes, seen from the payer's
side: when the payment is settled inside a wallet, nobody outside the
wallet can see who was paid before the money moves.

## The four signals

`ligis_verify_payee` returns a stack, never a bare boolean:

| Signal | Statuses | Meaning |
|---|---|---|
| `right-payee` | GO / STOP / SKIPPED | Is the payee one you contracted with? |
| `right-amount` | GO / STOP / SKIPPED | Is the amount within tolerance of the agreed figure? |
| `in-scope` | GO / STOP / SKIPPED | Does this purchase match what the agent was asked to buy? |
| `verified-payee` | GO / STOP / SKIPPED | Does the payee hold a live capability credential? |

**`SKIPPED` is never reported as a pass.** A signal that could not be
evaluated says so. `STOP` wins the verdict; otherwise the verdict is `GO` when
every signal evaluated and passed, `GO_WITH_SKIPS` when the checks that ran
passed and the ones that could not run are listed, and `UNKNOWN` when nothing
could be evaluated.

This matters more than it sounds. Folding "I did not check" into "I checked
and it was fine" is exactly how an agent ends up paying a stranger. A failed
registry read yields `unknown`, never a clean bill of health.

## The gate

`pre_tool_call` intercepts payment-shaped calls — `cast send`, `solana
transfer`, `bitcoin-cli sendtoaddress`, `near call --deposit`, `curl` with
an `X-PAYMENT` header, and MCP tools whose names read as money movement — and
checks the payee's credential before the money moves.

| `mode` | Behaviour |
|---|---|
| `escalate` *(default)* | Ask through Hermes's own approval prompt, showing the credential evidence. |
| `enforce` | Block the call outright. |
| `off` | Never gate. |

What an escalation does is **Hermes's approvals policy**, not the plugin's:
`--yolo` and `approvals.mode: off` auto-approve plugin escalations, and
cron follows `approvals.cron_mode`. If the payment must never proceed
unattended, use `mode: enforce` — it blocks outright regardless of the
approvals configuration.

A registry outage is *not* a finding: if the credential cannot be read, the
gate stays quiet rather than escalating on every payment.

The gate checks **every** destination a call names — in `to`/`payee`
fields, nested inside JSON-encoded arguments, and inside a base64 signed
`X-PAYMENT` payload (`accepted.payTo`, `payload.authorization.to`) — not
just the first. A crafted call that front-runs a credentialed decoy before
the real payee still gates, and it gates on what the signed payload
actually pays, not only on what the challenge displayed.

**A credential is only as good as its issuer.** The registry lets anyone
issue a credential for any subject — a payee can issue one for itself and
`isCapable` would still say yes. So `capable` requires a trusted issuer:
the `trusted_issuers` setting is the root of trust, chosen by the operator,
and the `issuer`/`trusted_issuers` tool arguments can only *narrow* it for
a single call — they can never add an issuer the operator did not
configure, so a payee (or text steering the model) cannot whitelist an
issuer of its own choosing. With none configured, a present credential is
reported `unverified_issuer` and gated like a missing one.

**The endpoint is probed, not believed.** TLS authenticates the transport,
not the answer. Before the first read against an (endpoint, registry) pair
the plugin checks `eth_chainId` matches the configured chain and
`eth_getCode` finds contract code at the registry address — an endpoint
serving the wrong chain, or a registry address holding no contract, reads
as `unknown` rather than an answer. Both probes are cached per process.

Each hook invocation shares one time budget
(`hook_time_budget_seconds`, default 10s) across all its reads, so a slow
endpoint cannot stretch a check. Payees that did not fit the budget are
reported as unchecked — never assumed capable.

## Configuration

All optional; the defaults work out of the box.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `escalate` | `escalate` · `enforce` · `off` |
| `capability` | *(empty)* | The capability a payee must hold. Empty means the gate uses the capability named in the call's own arguments, and stays silent when there is none. |
| `trusted_issuers` | *(empty)* | Comma-separated issuer addresses whose credentials count. Empty means no issuer is trusted — a present credential reports `unverified_issuer`, not `capable`. |
| `chain` | `monad-testnet` | `monad-testnet` · `pharos-atlantic` |
| `hook_time_budget_seconds` | `10.0` | Wall-clock budget for all registry reads in one hook call. |
| `amount_tolerance_pct` | `10.0` | Drift allowed between the amount asked for and the expected amount. |
## Disclosure

- Makes **read-only HTTPS JSON-RPC `eth_call` requests** to the configured
  RPC endpoint — by default `https://testnet-rpc.monad.xyz` (Monad Testnet)
  and `https://atlantic.dplabs-internal.com` (Pharos Atlantic). The RPC
  operator sees the caller's IP address and the registry and subject
  addresses queried.
- The `pre_tool_call` hook escalates to **Hermes's approval prompt**. What
  that prompt does is Hermes's approvals policy: `--yolo` and
  `approvals.mode: off` auto-approve plugin escalations, and cron follows
  `approvals.cron_mode`. Use `mode: enforce` to block the call outright
  regardless.
- If the credential registry **cannot be read, the gate does not fire**.
  An unreachable registry is not a finding — reads report `unknown`,
  never `capable`, and the hook stays quiet during an outage.
- **Issuers are opt-in trust.** The registry lets anyone issue a
  credential for any subject, including the payee itself. A live
  credential only counts when its issuer is in `trusted_issuers`; with an
  empty list every present credential reports `unverified_issuer` —
  present, but not proof. `trusted_issuers` is the only root of trust:
  tool arguments may narrow it, never widen it.
- **The RPC endpoint is a trusted party — minimally.** Reads verify TLS,
  then probe `eth_chainId` and `eth_getCode` before trusting answers, but
  an endpoint could still serve a fork with a replaced registry. Every
  verdict names the registry address and chain it came from. Reads are at
  the `latest` block, not a finalized one, and a credential checked now
  can be revoked before the payment settles (check-then-act window).
- **A credential is attestation, not endorsement.** `capable` means a
  trusted issuer vouches that the payee holds the capability — it is not
  a guarantee that the payee is honest, solvent, or that the payment will
  settle as advertised.
- The gate sees only destinations present in the tool call — plaintext,
  nested JSON, or a decodable signed payload. A payment whose destination
  materialises inside a remote signer it cannot decode is checked at the
  402-annotation step instead, which is advisory.
- **Holds no keys and reads no credential stores.** It signs nothing, sends
  no transactions, and never moves funds. It holds no wallet, no API key, and
  no steward key, and does not use `agent.secret_scope`.
- Reads no files outside its own plugin data directory. Runs no background
  processes. No telemetry, no self-update.
- Reads are **read-only**: `eth_call` cannot change chain state.
- The plugin is **EVM-only** in this release. The capability hash is
  chain-agnostic by construction, so the same capability resolves on any
  EVM registry, but non-EVM chains are not supported yet.
- `in-scope` is operator-side. This plugin does not model a policy for what
  a purchase is in scope for, so that signal is `SKIPPED` rather than
  guessed at.

## Install

```
hermes plugins install ligis --enable
```

Then restart Hermes.

## Development

```
python3 tests/test_ligis.py      # unit tests, hermetic — the chain read is stubbed
python3 fixtures/selftest.py     # live chain reads against public testnets
hermes plugins validate .        # the catalog CI gate
hermes plugins doctor . --ci     # discovery, import and registration
```

The unit suite runs with no network: a fixture registry answers the same
JSON-RPC methods the real one does (`eth_chainId`, `eth_getCode`,
`eth_call`), so the tests exercise encoding, decoding, detection, the
hooks and the verdict rules deterministically. `fixtures/selftest.py` is
the live side — it re-checks the demo subjects against the public
testnets and is the only script that touches a network.

## License

MIT
