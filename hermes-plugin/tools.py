"""Tool handlers and the pre_tool_call gate for the ligis plugin.

Design notes
------------
**Four signals, never one boolean.** ``ligis_verify_payee`` returns a stack
of independently evaluated signals. A signal that could not be evaluated is
``SKIPPED``, never folded into a pass. This mirrors how a payment decision
should actually work: "I checked the payee's credential and it is valid"
and "I did not check" are different facts, and collapsing them is how agents
end up paying strangers.

**Fail closed on a failed read.** If the credential registry cannot be
reached, the verified-payee signal is SKIPPED and the overall verdict is
UNKNOWN — not GO. A registry outage must never read as a clean bill of
health.

**No secrets, no hosted service.** Every chain read is a read-only
``eth_call`` against a public JSON-RPC endpoint. The plugin holds no key,
signs nothing, and sends no transaction.

**The hook escalates by default.** See ``config`` for the mode. In
``escalate`` mode an uncredentialed payee raises Hermes's own approval
prompt; in ``enforce`` mode the call is blocked outright. Neither mode ever
auto-approves.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from . import chains
from . import x402
from .chains import CHAINS, DEFAULT_CHAIN, read_capability

logger = logging.getLogger(__name__)

__all__ = [
    "ligis_check_capability",
    "ligis_capability_hash",
    "ligis_verify_payee",
    "ligis_chains",
    "pre_tool_call",
]


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

class _Config:
    """Plugin settings, bound to the Hermes context at registration."""

    def __init__(self) -> None:
        self._ctx = None

    def bind(self, ctx) -> None:
        self._ctx = ctx

    def get_str(self, key: str, default: str = "") -> str:
        if self._ctx is None:
            return default
        try:
            value = self._ctx.get_config(key, default=default)
        except TypeError:
            try:
                value = self._ctx.get_config(key)
            except Exception:
                return default
        except Exception:
            return default
        if value is None:
            return default
        return str(value)

    def get_float(self, key: str, default: float) -> float:
        raw = self.get_str(key, "")
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default


config = _Config()


# --------------------------------------------------------------------------
# Payment-call detection
# --------------------------------------------------------------------------

# Terminal shapes that move money. Mirrors the shapes `spendwarden`
# recognises, so the detection surface is one the marketplace already
# accepts as "payment-shaped".
_PAYMENT_TERMINAL_PATTERNS = (
    re.compile(r"\bcast\s+send\b", re.I),
    re.compile(r"\bsolana\s+transfer\b", re.I),
    re.compile(r"\bbitcoin-cli\s+sendtoaddress\b", re.I),
    re.compile(r"\bnear\s+call\b.*\bdeposit\b", re.I),
    re.compile(r"\bcast\s+send\b|\bx402\b|X-PAYMENT", re.I),
)

# MCP / tool names that read as money movement.
_PAYMENT_TOOL_PATTERN = re.compile(
    r"(pay|transfer|send|withdraw|settle|swap|bridge)", re.I
)

# Tools that communicate rather than move money. They contain words like
# "send" but never settle a payment, so gating them would be noise.
_COMMUNICATION_TOOL_PATTERN = re.compile(
    r"(message|mail|email|notify|sms|im$|chat|comment|post|reply)", re.I
)

# Argument names that commonly hold the destination.
_PAYEE_ARG_NAMES = ("payee", "to", "recipient", "destination", "address", "target")

_HEX_ADDRESS = re.compile(r"\b0x[a-fA-F0-9]{40}\b")


def _looks_like_payment(tool_name: str, args: dict) -> bool:
    """Is this tool call plausibly moving money?"""
    name = str(tool_name or "")

    # A terminal command is the highest-signal case: inspect the command.
    if name in ("terminal", "execute_code", "process_manage", "shell"):
        command = ""
        for key in ("command", "cmd", "script", "input"):
            value = args.get(key)
            if isinstance(value, str):
                command += " " + value
        if command.strip():
            if any(p.search(command) for p in _PAYMENT_TERMINAL_PATTERNS):
                return True
            # A signed x402 retry: the payee is base64-encoded in the
            # header, so the command carries no plain address — but it
            # does carry the payment blob.
            for blob in x402.find_payment_headers(command):
                if x402.extract_payee_from_payment_header(blob):
                    return True
        return False

    # An MCP or native tool whose *name* reads as money movement. Tools
    # that merely *communicate* (send_message, email, notify) are excluded:
    # they move no money, and gating them would be noise.
    if _PAYMENT_TOOL_PATTERN.search(name) and not _COMMUNICATION_TOOL_PATTERN.search(
        name
    ):
        # Require a payee-shaped argument so we do not fire on every tool
        # with "pay" in the name.
        if _extract_payee(args):
            return True

    # A tool that explicitly carries an x402 payment payload.
    for key in ("payment", "payment_requirement", "requirement", "payment_header"):
        if args.get(key):
            return True

    return False


def _extract_payee(args: dict) -> str:
    """Pull a destination address out of a tool call's arguments.

    Looks, in order, at the payee-shaped argument names, at an x402
    payment header (base64 or raw JSON — where the payee is *not* a plain
    hex address in the command string), and finally at any
    address-shaped value in the arguments.
    """
    for key in _PAYEE_ARG_NAMES:
        value = args.get(key)
        if isinstance(value, str):
            match = _HEX_ADDRESS.search(value)
            if match:
                return match.group(0)
            if value.startswith("0x") and len(value) == 42:
                return value

    # An x402 signed payment carries the payee base64-encoded, so no plain
    # hex address appears in the command — decode the header instead.
    for value in args.values():
        if not isinstance(value, str):
            continue
        payees = x402.extract_payee_from_payment_header(value)
        if payees:
            return payees[0]

    # The header may be embedded in a larger string (a shell command with
    # -H 'X-PAYMENT: <base64>'), so scan for payment blobs in it.
    for value in args.values():
        if not isinstance(value, str):
            continue
        for blob in x402.find_payment_headers(value):
            payees = x402.extract_payee_from_payment_header(blob)
            if payees:
                return payees[0]

    # Fall back to any address-shaped value in the arguments.
    for value in args.values():
        if isinstance(value, str):
            match = _HEX_ADDRESS.search(value)
            if match:
                return match.group(0)
    return ""


def _extract_capability(args: dict) -> str:
    for key in ("capability", "capabilities", "scope", "required_capability"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


# --------------------------------------------------------------------------
# Tools
# --------------------------------------------------------------------------

def _payload(data: dict) -> str:
    """Hermes tools return a JSON string; the model reads that string."""
    return json.dumps(data, default=str)


def ligis_check_capability(args: dict, **kwargs) -> str:
    """Check one subject's credential for one capability on one chain.

    Hermes calls a tool handler with a single ``args`` dict and injects
    context keywords, so the signature is ``(args, **kwargs)``.
    """
    args = args or {}
    subject = str(args.get("subject") or "").strip()
    capability = str(args.get("capability") or "").strip()
    chain = str(args.get("chain") or DEFAULT_CHAIN).strip() or DEFAULT_CHAIN

    if not subject or not capability:
        return _payload(
            {
                "error": "both 'subject' and 'capability' are required",
                "subject": subject,
                "capability": capability,
            }
        )

    try:
        status = read_capability(subject, capability, chain)
    except ValueError as exc:
        return _payload({"error": str(exc), "known_chains": sorted(CHAINS)})
    except Exception as exc:  # noqa: BLE001 - never raise into the model
        logger.debug("ligis: capability read failed", exc_info=True)
        return _payload(
            {
                "status": "unknown",
                "error": str(exc),
                "subject": subject,
                "capability": capability,
                "chain": chain,
            }
        )

    data = status.to_dict()
    data["summary"] = status.describe()
    if status.error:
        data["note"] = (
            "The credential registry could not be read, so entitlement is "
            "UNKNOWN. This is not the same as the payee being "
            "uncredentialed."
        )
    return _payload(data)


def ligis_capability_hash(args: dict, **kwargs) -> str:
    """Compute the chain-agnostic keccak-256 hash of a capability name."""
    args = args or {}
    name = str(args.get("capability") or "").strip()
    if not name:
        return _payload({"error": "'capability' is required"})
    digest = chains.capability_hash(name)
    return _payload(
        {
            "capability": name,
            "capability_hash": digest,
            "note": (
                "This hash is the same on every chain, which is what makes "
                "a capability credential portable across chains."
            ),
        }
    )


def ligis_chains(args: dict, **kwargs) -> str:
    """List the chains this plugin can read."""
    return _payload(
        {
            "chains": [chain.to_dict() for chain in CHAINS.values()],
            "default_chain": DEFAULT_CHAIN,
        }
    )


def ligis_verify_payment(args: dict, **kwargs) -> str:
    """Check the payee named by an x402 payment requirement or header.

    Use this when the plugin cannot see the payment itself — an agent
    paying through a wallet MCP server (``mpp_fetch``, ``pay``,
    ``switch402``) hands the 402 to the wallet, and neither the tool
    arguments nor the tool result carry the payee. In that case read the
    payment requirement out of the challenge and ask here.
    """
    args = args or {}
    requirement = args.get("requirement") or args.get("payment_requirement")
    header = args.get("payment_header") or args.get("header")
    capability = str(args.get("capability") or "").strip()
    chain = str(args.get("chain") or DEFAULT_CHAIN).strip() or DEFAULT_CHAIN

    if not capability:
        capability = config.get_str("capability", "")
    if not capability:
        return _payload(
            {
                "error": (
                    "a 'capability' is required (name the capability the "
                    "payee must hold, e.g. 'agent.commerce.escrow')"
                ),
            }
        )

    payees: list[str] = []
    requirements: list[dict] = []

    if isinstance(requirement, str) and requirement.strip():
        for req in x402.find_requirements(requirement):
            payees.append(req.pay_to)
            requirements.append(req.to_dict())
    elif isinstance(requirement, dict):
        for req in x402.find_requirements(json.dumps(requirement)):
            payees.append(req.pay_to)
            requirements.append(req.to_dict())

    if isinstance(header, str) and header.strip():
        payees.extend(x402.extract_payee_from_payment_header(header))

    # Deduplicate, preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for payee in payees:
        lowered = payee.lower()
        if lowered and lowered not in seen:
            seen.add(lowered)
            unique.append(payee)

    if not unique:
        return _payload(
            {
                "error": (
                    "no payee could be read from the payment requirement or "
                    "header"
                ),
                "hint": (
                    "pass the x402 challenge body (with accepts[].payTo) as "
                    "'requirement', or the signed X-PAYMENT / "
                    "PAYMENT-SIGNATURE header as 'payment_header'"
                ),
            }
        )

    signals: list[dict] = []
    for payee in unique:
        status = read_capability(payee, capability, chain)
        if status.status == "capable":
            signals.append(
                _signal(
                    "verified-payee",
                    "GO",
                    1.0,
                    f"the payee holds a live '{capability}' credential issued "
                    f"by {status.issuer} on {status.chain}",
                    issuer=status.issuer,
                    chain=status.chain,
                    capability_hash=status.capability_hash,
                    expires_at=status.expires_at,
                )
            )
        elif status.status == "unknown":
            signals.append(
                _signal(
                    "verified-payee",
                    "SKIPPED",
                    0.0,
                    f"the credential registry on {status.chain} could not be "
                    "read, so entitlement is unknown — this is not a pass",
                    error=status.error,
                )
            )
        else:
            signals.append(
                _signal(
                    "verified-payee",
                    "STOP",
                    1.0,
                    status.describe(),
                    issuer=status.issuer,
                    chain=status.chain,
                    capability_hash=status.capability_hash,
                    revoked=status.revoked,
                )
            )

    if any(s["status"] == "STOP" for s in signals):
        verdict = "STOP"
    elif any(s["status"] == "GO" for s in signals):
        verdict = "GO"
    else:
        verdict = "UNKNOWN"

    return _payload(
        {
            "verdict": verdict,
            "payees": unique,
            "signals": signals,
            "capability": capability,
            "chain": chain,
            "requirements": requirements or None,
            "note": (
                "STOP means at least one payee named by this payment cannot "
                "be credentialed. UNKNOWN means the registry could not be "
                "read — which is not a pass."
            ),
        }
    )


def _signal(signal_id: str, status: str, confidence: float, reason: str, **extra) -> dict:
    out = {
        "id": signal_id,
        "status": status,
        "confidence": confidence,
        "reason": reason,
    }
    out.update(extra)
    return out


def ligis_verify_payee(args: dict, **kwargs) -> str:
    """Evaluate the four payment signals and return a verdict + stack."""
    args = args or {}
    payee = str(args.get("payee") or "").strip()
    purpose = str(args.get("purpose") or "").strip()
    capability = str(args.get("capability") or "").strip()
    chain = str(args.get("chain") or DEFAULT_CHAIN).strip() or DEFAULT_CHAIN

    try:
        amount_usd = float(args.get("amount_usd"))
    except (TypeError, ValueError):
        return _payload({"error": "'amount_usd' must be a number"})

    if not payee or not purpose:
        return _payload(
            {"error": "both 'payee' and 'purpose' are required"}
        )

    raw_payees = args.get("expected_payees") or []
    if isinstance(raw_payees, str):
        raw_payees = [p.strip() for p in raw_payees.split(",") if p.strip()]
    expected_payees = [str(a) for a in raw_payees]

    expected_usd = args.get("expected_usd")
    if expected_usd is not None:
        try:
            expected_usd = float(expected_usd)
        except (TypeError, ValueError):
            expected_usd = None

    tolerance = config.get_float("amount_tolerance_pct", 10.0)

    signals: list[dict] = []

    # --- right-payee ----------------------------------------------------
    contracted = [str(a).lower() for a in (expected_payees or [])]
    if not contracted:
        signals.append(
            _signal(
                "right-payee",
                "SKIPPED",
                0.0,
                "no contracted payee list was supplied, so the destination "
                "could not be checked against a contract",
            )
        )
    elif str(payee).lower() in contracted:
        signals.append(
            _signal(
                "right-payee",
                "GO",
                1.0,
                "the payee is one of the contracted destinations",
            )
        )
    else:
        signals.append(
            _signal(
                "right-payee",
                "STOP",
                1.0,
                "the payee is not among the contracted destinations",
            )
        )

    # --- right-amount ---------------------------------------------------
    if expected_usd is None:
        signals.append(
            _signal(
                "right-amount",
                "SKIPPED",
                0.0,
                "no expected amount was supplied, so the price could not be "
                "checked against an agreed figure",
            )
        )
    else:
        expected = float(expected_usd)
        actual = float(amount_usd)
        if expected <= 0:
            signals.append(
                _signal(
                    "right-amount",
                    "SKIPPED",
                    0.0,
                    "the expected amount is not positive, so no tolerance "
                    "could be applied",
                )
            )
        else:
            drift = abs(actual - expected) / expected * 100.0
            if drift <= tolerance:
                signals.append(
                    _signal(
                        "right-amount",
                        "GO",
                        1.0,
                        f"the amount is within {tolerance:.0f}% of the "
                        f"agreed figure ({drift:.1f}% off)",
                        drift_pct=round(drift, 2),
                    )
                )
            else:
                signals.append(
                    _signal(
                        "right-amount",
                        "STOP",
                        1.0,
                        f"the amount is {drift:.1f}% away from the agreed "
                        f"figure, outside the {tolerance:.0f}% tolerance",
                        drift_pct=round(drift, 2),
                    )
                )

    # --- in-scope --------------------------------------------------------
    signals.append(
        _signal(
            "in-scope",
            "SKIPPED",
            0.0,
            "scope is operator-side: this plugin does not judge whether a "
            "purchase is in scope without an operator policy to judge it "
            "against. The hosted Ligis gate adds a model-based in-scope "
            "signal; the local plugin does not pretend to.",
        )
    )

    # --- verified-payee --------------------------------------------------
    if not capability:
        signals.append(
            _signal(
                "verified-payee",
                "SKIPPED",
                0.0,
                "no capability was named, so no credential could be checked",
            )
        )
    else:
        status = read_capability(payee, capability, chain)
        if status.status == "unknown":
            signals.append(
                _signal(
                    "verified-payee",
                    "SKIPPED",
                    0.0,
                    f"the credential registry on {status.chain} could not be "
                    f"read, so entitlement is unknown — this is not a pass",
                    error=status.error,
                )
            )
        elif status.status == "capable":
            signals.append(
                _signal(
                    "verified-payee",
                    "GO",
                    1.0,
                    f"the payee holds a live '{capability}' credential issued "
                    f"by {status.issuer} on {status.chain}",
                    issuer=status.issuer,
                    chain=status.chain,
                    capability_hash=status.capability_hash,
                    expires_at=status.expires_at,
                )
            )
        else:
            signals.append(
                _signal(
                    "verified-payee",
                    "STOP",
                    1.0,
                    status.describe(),
                    issuer=status.issuer,
                    chain=status.chain,
                    capability_hash=status.capability_hash,
                    revoked=status.revoked,
                )
            )

    # --- verdict ---------------------------------------------------------
    # STOP wins, then GO, then UNKNOWN. A SKIPPED signal is never a pass.
    if any(s["status"] == "STOP" for s in signals):
        verdict = "STOP"
    elif any(s["status"] == "GO" for s in signals) and not any(
        s["status"] == "SKIPPED" for s in signals
    ):
        verdict = "GO"
    elif any(s["status"] == "GO" for s in signals):
        verdict = "GO_WITH_SKIPS"
    else:
        verdict = "UNKNOWN"

    skipped = [s["id"] for s in signals if s["status"] == "SKIPPED"]
    stopped = [s["id"] for s in signals if s["status"] == "STOP"]

    return _payload(
        {
            "verdict": verdict,
            "signals": signals,
            "payee": payee,
            "amount_usd": amount_usd,
            "purpose": purpose,
            "capability": capability or None,
            "chain": chain,
            "skipped_signals": skipped,
            "stopped_signals": stopped,
            "note": (
                "SKIPPED means the signal could not be evaluated; it is "
                "never reported as a pass. A GO_WITH_SKIPS verdict means "
                "the checks that ran passed, and the ones that could not "
                "run are listed."
            ),
        }
    )


# --------------------------------------------------------------------------
# pre_tool_call hook
# --------------------------------------------------------------------------

def pre_tool_call(tool_name: str, args: dict, task_id: str, **kwargs) -> dict | None:
    """Gate payment-shaped tool calls on the payee's credential.

    Returns ``None`` to allow the call, ``{"action": "approve", ...}`` to
    escalate it to Hermes's own approval prompt, or ``{"action":
    "block", ...}`` to veto it.
    """
    mode = config.get_str("mode", "escalate").strip().lower()
    if mode == "off":
        return None

    if not isinstance(args, dict):
        return None

    try:
        if not _looks_like_payment(tool_name, args):
            return None
        payee = _extract_payee(args)
        if not payee:
            return None
    except Exception:  # noqa: BLE001 - a gate must never wedge the agent
        logger.debug("ligis: payment detection failed", exc_info=True)
        return None

    capability = config.get_str("capability", "") or _extract_capability(args)
    if not capability:
        # Nothing to check against. Escalating here would be noise.
        return None

    chain = config.get_str("chain", DEFAULT_CHAIN) or DEFAULT_CHAIN

    try:
        status = read_capability(payee, capability, chain)
    except Exception:  # noqa: BLE001
        logger.debug("ligis: credential read failed in hook", exc_info=True)
        return None

    if status.status == "capable":
        return None

    if status.status == "unknown":
        # A registry outage is not evidence of anything. Do not escalate on
        # it — that would train the user to click through the gate.
        logger.debug("ligis: credential read unknown; not gating")
        return None

    detail = status.describe()
    if mode == "enforce":
        return {
            "action": "block",
            "message": (
                f"[LIGIS] Blocked {tool_name}: the payee {payee} does not "
                f"hold a live '{capability}' credential. {detail}. "
                "Verification: read-only eth_call against the credential "
                f"registry on {status.chain} "
                f"({status.credential_registry})."
            ),
        }

    return {
        "action": "approve",
        "message": (
            f"[LIGIS] {tool_name} is paying {payee}, which does not hold a "
            f"live '{capability}' credential. {detail}. "
            "Approve only if you have an independent reason to trust this "
            f"payee. Verification: read-only eth_call against the "
            f"credential registry on {status.chain} "
            f"({status.credential_registry})."
        ),
    }


# --------------------------------------------------------------------------
# transform_tool_result hook — the x402 402 challenge
# --------------------------------------------------------------------------

_NOTE_PREFIX = "[LIGIS]"


def transform_tool_result(
    tool_name: str, result: str, args: dict, task_id: str, **kwargs
) -> str | None:
    """Annotate an x402 402 challenge with the payee's credential verdict.

    In an x402 payment the agent learns the payee from the **402 response**,
    not from its own request: the challenge carries ``accepts[].payTo`` in
    plaintext and arrives as a tool result. That is the window in which the
    agent decides whether to sign — the same window ERC-8478 describes when
    it says the HTTP answer is the only source of ``payTo``.

    So the useful thing is not to block (the agent has not paid anything
    yet) but to put the verdict in front of it, naming the payee, the
    capability and the registry the answer came from. An agent that sees
    "this payee holds no live credential" before it signs can decide; an
    agent that does not see it cannot.

    Returns the rewritten result, or ``None`` to leave it unchanged.
    """
    mode = config.get_str("mode", "escalate").strip().lower()
    if mode == "off":
        return None

    if not isinstance(result, str) or not result.strip():
        return None

    requirements = x402.find_requirements(result)
    if not requirements:
        return None

    capability = config.get_str("capability", "")
    chain = config.get_str("chain", DEFAULT_CHAIN) or DEFAULT_CHAIN

    lines: list[str] = []
    checked = 0
    capable = 0
    unknown = 0

    for req in requirements:
        if not capability:
            lines.append(
                f"{_NOTE_PREFIX} this payment would send {req.amount} "
                f"{req.asset or ''} to {req.pay_to} on {req.network}. "
                "No capability is configured for this plugin, so the payee's "
                "entitlement was not checked."
            )
            continue

        try:
            status = read_capability(req.pay_to, capability, chain)
        except Exception:  # noqa: BLE001 - a note must never break a result
            logger.debug("ligis: 402 annotation read failed", exc_info=True)
            continue

        checked += 1
        if status.status == "capable":
            capable += 1
            lines.append(
                f"{_NOTE_PREFIX} the payee {req.pay_to} HOLDS a live "
                f"'{capability}' credential, issued by {status.issuer} on "
                f"{status.chain}. Verified by read-only eth_call against the "
                f"credential registry ({status.credential_registry})."
            )
        elif status.status == "unknown":
            unknown += 1
            lines.append(
                f"{_NOTE_PREFIX} the payee {req.pay_to} could not be checked "
                f"— the credential registry on {status.chain} did not answer "
                f"({status.error}). That is NOT evidence that the payee is "
                "entitled; it is an unanswered question."
            )
        else:
            lines.append(
                f"{_NOTE_PREFIX} the payee {req.pay_to} does NOT hold a live "
                f"'{capability}' credential — {status.describe()}. "
                f"Verified by read-only eth_call against the credential "
                f"registry on {status.chain} ({status.credential_registry}). "
                "Check this before paying, unless you have an independent "
                "reason to trust this payee."
            )

    if not lines:
        return None

    summary = "\n".join(lines)
    if checked and capable == checked and not unknown:
        summary += (
            "\nEvery payee named in this payment challenge holds the "
            "configured capability."
        )
    elif checked and capable == 0 and not unknown:
        summary += (
            "\nNo payee named in this payment challenge holds the configured "
            "capability. You are about to pay an uncredentialed counterparty."
        )

    return f"{result}\n\n{summary}"
