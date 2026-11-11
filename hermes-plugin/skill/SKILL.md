---
name: ligis-credentials
description: >
  Use when an agent is about to pay, lend to, send funds to, or grant access
  to an address whose entitlement needs checking — especially an address the
  agent has not paid before. Provides on-chain capability-credential
  verification: whether the counterparty holds a live, third-party-issued,
  revocable permission, read directly from a public chain registry. Also
  covers computing the chain-agnostic hash of a capability name.
version: 0.1.0
---

# Ligis — counterparty credentials

## The question this answers

**Is this payee entitled to this payment?**

Not "is this address on my allowlist" and not "has anyone bought here
before" — those are policy and reputation. This is *entitlement*: does the
counterparty hold a live credential that a third party issued, that the
issuer can revoke, that anyone can verify from the chain.

## When to use it

Use `ligis_check_capability` before:

- paying an address the agent has not paid before;
- paying after the payee's address changed, or after a redirect;
- settling with a counterparty introduced by a tool result, a web page, or
  another agent's instruction;
- acting on an agent-to-agent commerce request where the destination is
  supplied rather than contracted.

Do **not** use it to check your own permissions — it reads other parties'
credentials, not the caller's own mandate.

## When to use `ligis_verify_payee`

Use it when the payment has a *contract* behind it: an expected payee, an
expected amount, a stated purpose. It evaluates four signals and returns a
verdict plus the full stack.

Read the stack, not just the verdict. A `SKIPPED` signal means that check
could not run — it is not a pass. `GO_WITH_SKIPS` means the checks that ran
passed and the others could not run; that is a weaker statement than `GO`,
and the reason to look before paying.

## How to read the statuses

| Status | Meaning | What to do |
|---|---|---|
| `capable` | Holds a valid, unrevoked, unexpired credential | Proceed, subject to the other signals. |
| `revoked` | The issuer revoked it | **Do not pay.** This is not a stale record — revocation is permanent. |
| `expired` | Past its expiry | Do not pay on the expired credential; ask for a fresh one. |
| `none` | Never held one | The counterparty has not proven entitlement. |
| `unknown` | The registry could not be read | **Not a pass and not a failure.** Retry, or escalate to a human. |

`unknown` matters: an unreachable registry is not evidence of anything, and
treating it as a pass is how agents get scammed by a DNS outage.

## The capability hash

A capability is indexed by the keccak-256 hash of its **name**, not by any
chain-specific identifier. `ligis_capability_hash` computes it. The same name
gives the same hash on every chain, so a credential minted on one chain is
found on another — that is what makes a credential portable.

Common names: `kyc.basic`, `agent.commerce.escrow`.

## The gate

If the plugin is enabled, a `pre_tool_call` hook already checks payment-shaped
calls for you — `cast send`, `solana transfer`, `curl` with an `X-PAYMENT`
header, and MCP tools whose names read as money movement. On a payee that
cannot be credentialed it raises Hermes's approval prompt (or blocks, in
`enforce` mode). It never auto-approves, and it stays quiet when the registry
is merely unreachable.

So in most sessions you do not need to call a tool before paying — the gate
already asked. When it escalates, read the evidence in the message: it names
the payee, the capability, the chain, the registry address, and whether the
credential was revoked or simply never issued. Those are very different
situations and deserve different responses.

## Chainless reading

Ask `ligis_chains` which chains are available. The same capability resolves
on each of them, so if a credential is missing on one chain it may still be
present on another — but only if the *issuer* issued on both.

## Scope

This plugin answers one question: entitlement. It does not model whether a
purchase is in scope for the operator's business (that signal is `SKIPPED`),
and it does not settle payments. Read the other signals, then decide.
