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
| `ligis_check_capability` | Is this address credentialed for this capability? Returns `capable` / `revoked` / `expired` / `none` / `unknown`, with the issuer, expiry and capability hash. |
| `ligis_capability_hash` | The chain-agnostic keccak-256 hash of a capability name. |
| `ligis_verify_payee` | The four-signal payment verdict: `right-payee`, `right-amount`, `in-scope`, `verified-payee` → `GO` / `STOP` / `UNKNOWN` with the full stack. |
| `ligis_chains` | The chains this plugin can read, with registry addresses. |
| `pre_tool_call` hook | Intercepts payment-shaped tool calls and escalates to Hermes's approval prompt when the payee cannot be credentialed. |

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

The same name therefore resolves to the same bytes on **every** chain, so a
credential minted on one chain is referentially identical to the same
credential on another. That is what makes a credential portable — and it is
the property the demo shows.

## Verified in a live Hermes session

Not just in tests. Driven through a running Hermes agent, with the plugin
installed from this repository at the pinned commit:

| What | Result |
|---|---|
| `ligis_capability_hash("agent.commerce.escrow")` | `0x17775e48…a3ebf8` — the registry's hash |
| `ligis_check_capability(0xd21a…27Ec, agent.commerce.escrow)` | `capable`, issuer `0x0DBCF8D1…93aAf` |
| Payment to `0x…dEaD` (no credential), `mode: enforce` | **blocked** by the gate, with the credential evidence |
| Payment to `0xd21a…27Ec` (credentialed), `mode: enforce` | **allowed through** to the tool |

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

Escalation **never auto-approves**, and on unattended surfaces (cron,
`--yolo`, approvals off) it is refused rather than silently allowed — the
same posture `spendwarden` uses.

A registry outage is *not* a finding: if the credential cannot be read, the
gate stays quiet rather than escalating on every payment.

## Configuration

All optional; the defaults work out of the box.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `escalate` | `escalate` · `enforce` · `off` |
| `capability` | *(empty)* | The capability a payee must hold. Empty means the gate uses the capability named in the call's own arguments, and stays silent when there is none. |
| `chain` | `monad-testnet` | `monad-testnet` · `pharos-atlantic` |
| `amount_tolerance_pct` | `10.0` | Drift allowed between the amount asked for and the expected amount. |

## Disclosure

- Makes **read-only HTTPS JSON-RPC `eth_call` requests** to the configured
  RPC endpoint — by default `https://testnet-rpc.monad.xyz` (Monad Testnet)
  and `https://atlantic.dplabs-internal.com` (Pharos Atlantic). The RPC
  operator sees the caller's IP address and the registry and subject
  addresses queried.
- The `pre_tool_call` hook escalates to **Hermes's approval prompt**. On
  unattended surfaces (`--yolo`, approvals off, cron) that prompt is refused
  rather than auto-approved.
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
python3 tests/test_ligis.py      # 60 offline unit tests, no network
python3 fixtures/selftest.py     # live chain reads against public testnets
hermes plugins validate .        # the catalog CI gate
hermes plugins doctor . --ci     # discovery, import and registration
```

The offline tests cover the ABI encoding and decoding, the four-signal
verdict rules, the payment-call detection, the hook, and the handler
signature Hermes dispatches to (`(args, **kwargs)`) — the last one because
getting it wrong breaks every live call while the offline suite still
passes.

## License

MIT
