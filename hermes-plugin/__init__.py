"""ligis — check that a payee holds a live, third-party-issued, revocable
on-chain capability credential before the agent pays them.

What this plugin does
---------------------
Hermes agents pay other agents. When they do, the destination address comes
from the HTTP answer that is asking for the money — and nothing in the x402
flow ties that address to anything the payee has proven about itself. A
compromised server, a hijacked domain, or an injected instruction in a tool
result can change it; the payment still settles.

This plugin closes that gap the way the rest of the agent stack already
works: with a credential. Not a list of known-good endpoints, not a spend
cap — a *capability credential* issued by a third party, revocable by that
issuer, readable from the chain.

Three surfaces:

    ligis_check_capability  is this address credentialed for this capability?
    ligis_capability_hash   the chain-agnostic hash of a capability name
    ligis_verify_payee      the four-signal payment verdict
    pre_tool_call           gate payment-shaped calls on the payee's credential

Why it needs no key
-------------------
The credential registry is public chain state. Verifying a credential is a
read: one ``eth_call`` against a public JSON-RPC endpoint, no key, no
account, no hosted service, nothing to trust but the chain itself. The
plugin holds no signing material and sends no transactions.

Why the capability hash matters
-------------------------------
A capability is indexed by the keccak-256 hash of its *name*, not by any
chain-specific identifier. The same name therefore resolves to the same
bytes on every chain, so a credential minted on one chain is referentially
identical to the same credential on another. That is what makes a credential
portable, and it is the property the plugin demonstrates.

Import hygiene
--------------
``register()`` must be import-clean: no network at registration, because
Hermes's plugin doctor blocks sockets while it probes ``register()``. Every
chain read happens lazily inside a tool handler.
"""

from __future__ import annotations

import logging
from pathlib import Path

from . import schemas, tools

logger = logging.getLogger(__name__)


def register(ctx) -> None:
    """Entry point Hermes calls once at plugin load."""
    tools.config.bind(ctx)

    ctx.register_tool(
        name="ligis_check_capability",
        toolset="ligis",
        schema=schemas.LIGIS_CHECK_CAPABILITY,
        handler=tools.ligis_check_capability,
    )
    ctx.register_tool(
        name="ligis_capability_hash",
        toolset="ligis",
        schema=schemas.LIGIS_CAPABILITY_HASH,
        handler=tools.ligis_capability_hash,
    )
    ctx.register_tool(
        name="ligis_verify_payee",
        toolset="ligis",
        schema=schemas.LIGIS_VERIFY_PAYEE,
        handler=tools.ligis_verify_payee,
    )
    ctx.register_tool(
        name="ligis_chains",
        toolset="ligis",
        schema=schemas.LIGIS_CHAINS,
        handler=tools.ligis_chains,
    )

    # The gate: intercept payment-shaped tool calls and check the payee's
    # credential before the money moves.
    ctx.register_hook("pre_tool_call", tools.pre_tool_call)

    skill_md = Path(__file__).parent / "skill" / "SKILL.md"
    if skill_md.exists():
        try:
            ctx.register_skill("ligis-credentials", skill_md)
        except Exception:
            logger.debug("ligis: skill registration unavailable", exc_info=True)
