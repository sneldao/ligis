"""Tool handlers and the pre_tool_call gate for the ligis plugin.

Design notes
------------
**Four signals, never one boolean.** ``ligis_verify_payee`` returns a stack
of independently evaluated signals. A signal that could not be evaluated is
``SKIPPED``, never folded into a pass. This mirrors how a payment decision
should actually work: "I checked the payee's credential and it is valid"
and "I did not check" are different facts, and collapsing them is how agents
end up paying strangers.

**A failed read is never a pass.** In ``ligis_verify_payee`` an
unreachable registry yields a SKIPPED signal and an UNKNOWN verdict — a
registry outage must never read as a clean bill of health. The gate takes
the same posture differently: an unreadable registry is not evidence of
anything, so the hook stays quiet rather than escalating on every payment
during an outage.

**A credential is only as good as its issuer.** The registry lets anyone
issue a credential for any subject — a payee can issue its own — so a
live credential only counts when a trusted issuer signed it. The
``trusted_issuers`` setting is the root of trust, chosen by the operator;
tool arguments can narrow it for one call but never widen it, so a payee
cannot steer the model into trusting an issuer of the payee's choosing.
With no trusted issuer, a present credential is reported
``unverified_issuer`` and gated like a missing one.

**No secrets, no hosted service.** Every chain read is a read-only
``eth_call`` against a public JSON-RPC endpoint. The plugin holds no key,
signs nothing, and sends no transaction.

**The hook escalates by default.** See ``config`` for the mode. In
``escalate`` mode an uncredentialed payee raises Hermes's own approval
prompt — what that prompt does is Hermes's approvals policy (``--yolo``
and ``approvals.mode: off`` auto-approve plugin escalations; cron follows
``approvals.cron_mode``). In ``enforce`` mode the call is blocked
outright, regardless of approvals configuration.
"""

from __future__ import annotations

import json
import logging
import re
import time
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

# An EVM address matched in full — for validating values a 402 body
# supplies, where a prefix match would accept trailing junk.
_EVM_ADDRESS_FULL = re.compile(r"0x[a-fA-F0-9]{40}")

# Untrusted text hygiene. A 402 challenge is adversary-controlled: fields
# can carry newlines and control characters that would let the response
# forge plugin-voiced lines in a [LIGIS] note.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]+")
_WS_RUN = re.compile(r"\s+")

# Each distinct payee costs sequential RPC calls. A hostile 402 could name
# hundreds, so the result hook checks at most this many per result.
_MAX_PAYEES_PER_RESULT = 3

# A tool call can name several destinations (from/to, a decoy before the
# real payee). The gate checks at most this many per call.
_MAX_GATE_PAYEES = 8


class _Deadline:
    """A shared time budget for one hook invocation's RPC work.

    Count bounds how many reads run; this bounds how long they may take.
    Each read gets ``min(remaining, cap)`` as its timeout, so a slow or
    stalling endpoint cannot stretch a hook past its budget.
    """

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + max(0.0, float(seconds))

    @property
    def expired(self) -> bool:
        return time.monotonic() >= self._end

    def remaining(self, cap: float = 15.0) -> float:
        return max(0.05, min(cap, self._end - time.monotonic()))


def _hook_budget() -> _Deadline:
    return _Deadline(config.get_float("hook_time_budget_seconds", 10.0))


def _clean_field(value: object, limit: int = 64) -> str:
    """Make an untrusted field safe to interpolate into a [LIGIS] note.

    Strips control characters (including newlines), collapses whitespace,
    and caps the length. Anything the payment challenge supplied goes
    through this before it can reach a note.
    """
    text = _CONTROL_CHARS.sub("", str(value or ""))
    text = _WS_RUN.sub(" ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


def _quote(value: object, limit: int = 64) -> str:
    """Present an untrusted field as quoted data in a note."""
    return f'"{_clean_field(value, limit)}"'


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


def _iter_strings(node: Any, depth: int = 0):
    """Every string inside a tool-args value, bounded depth.

    Payees hide inside JSON-encoded argument strings and nested objects,
    not just top-level string fields — and a payee buried in a blob pays
    exactly like one in a named field.
    """
    if depth > 4:
        return
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _iter_strings(value, depth + 1)
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from _iter_strings(item, depth + 1)


def _extract_payees(args: dict) -> list[str]:
    """Every candidate destination address in a tool call's arguments.

    Three sources, in order of confidence:

    1. the payee-shaped argument names (``to``, ``payee``, …) — explicit;
    2. signed payment payloads — a base64 ``X-PAYMENT`` blob or JSON with
       ``accepted.payTo`` / ``payload.authorization.to`` / ``accepts[]``.
       This is the address the money actually goes to, which is not
       necessarily the address the challenge displayed;
    3. any other address-shaped string anywhere in the arguments,
       including nested values.

    All distinct candidates are returned (case-insensitive dedupe, capped
    at ``_MAX_GATE_PAYEES``) because checking only the first lets a crafted
    call front-run a credentialed decoy before the real payee.
    """
    found: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        key = value.lower()
        if key and key not in seen:
            seen.add(key)
            found.append(value)

    for key in _PAYEE_ARG_NAMES:
        for text in _iter_strings(args.get(key)):
            for match in _HEX_ADDRESS.finditer(text):
                add(match.group(0))
            if text.startswith("0x") and len(text) == 42:
                add(text)

    # An x402 signed payment carries the payee base64-encoded, so no plain
    # hex address appears in the command — decode the payload instead.
    for text in _iter_strings(args):
        for payee in x402.extract_payee_from_payment_header(text):
            add(payee)
        for blob in x402.find_payment_headers(text):
            for payee in x402.extract_payee_from_payment_header(blob):
                add(payee)
        for req in x402.find_requirements(text):
            add(req.pay_to)

    # Fall back to any address-shaped string anywhere in the arguments.
    for text in _iter_strings(args):
        for match in _HEX_ADDRESS.finditer(text):
            add(match.group(0))

    return found[:_MAX_GATE_PAYEES]


def _extract_payee(args: dict) -> str:
    """The first candidate destination, for payment-shape detection."""
    payees = _extract_payees(args)
    return payees[0] if payees else ""


def _extract_capability(args: dict) -> str:
    for key in ("capability", "capabilities", "scope", "required_capability"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _parse_issuers(values: list[str]) -> list[str]:
    """Validate and dedupe issuer addresses, preserving order."""
    seen: set[str] = set()
    out: list[str] = []
    for item in values:
        item = str(item).strip()
        if not item or item.lower() in seen:
            continue
        if _EVM_ADDRESS_FULL.fullmatch(item):
            seen.add(item.lower())
            out.append(item)
        else:
            logger.debug("ligis: dropping non-address trusted issuer %r", item)
    return out


def _trusted_issuers(args: dict | None = None) -> list[str]:
    """Issuer addresses whose credentials count as verified.

    The plugin's ``trusted_issuers`` setting is the root of trust — the
    operator chose it. The ``issuer`` / ``trusted_issuers`` tool arguments
    can only *narrow* that set for a single call: they may pick among
    issuers the operator already trusts, never add a new one. If arguments
    could widen the set, a payee (or text in a tool result steering the
    model) could name an issuer of its own choosing — including itself —
    and self-issued credentials would verify again.

    An empty result means no issuer is trusted: a present credential
    reports ``unverified_issuer``, not ``capable``.
    """
    configured = _parse_issuers(
        config.get_str("trusted_issuers", "").split(",")
    )
    if not args:
        return configured

    raw: list[str] = []
    single = args.get("issuer")
    if isinstance(single, str) and single.strip():
        raw.append(single.strip())
    many = args.get("trusted_issuers")
    if isinstance(many, str):
        raw.extend(many.split(","))
    elif isinstance(many, list):
        raw.extend(str(p) for p in many)

    requested = _parse_issuers(raw)
    if not requested:
        return configured

    # Narrow, never widen: keep only requested issuers the operator's
    # trusted_issuers setting already names — in the operator's spelling.
    trusted = {a.lower(): a for a in configured}
    narrowed = [trusted[a.lower()] for a in requested if a.lower() in trusted]
    dropped = [a for a in requested if a.lower() not in trusted]
    if dropped:
        logger.debug(
            "ligis: ignoring %d issuer argument(s) not in the configured "
            "trusted_issuers",
            len(dropped),
        )
    return narrowed


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
        status = read_capability(
            subject, capability, chain, trusted_issuers=_trusted_issuers(args)
        )
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
    elif status.status == "unverified_issuer":
        data["note"] = (
            "A live credential exists, but its issuer is not verified — "
            "anyone can issue a credential for any subject, including the "
            "payee itself. The operator's trusted_issuers setting names "
            "the issuers that count; the 'issuer' argument can only pick "
            "among those."
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

    issuers = _trusted_issuers(args)

    signals: list[dict] = []
    for payee in unique:
        if not _EVM_ADDRESS_FULL.fullmatch(payee):
            signals.append(
                _signal(
                    "verified-payee",
                    "SKIPPED",
                    0.0,
                    f"the payee value {_quote(payee)} is not an EVM "
                    "address, so it could not be checked",
                )
            )
            continue
        status = read_capability(payee, capability, chain, trusted_issuers=issuers)
        if status.status == "capable":
            signals.append(
                _signal(
                    "verified-payee",
                    "GO",
                    1.0,
                    f"the payee holds a live '{capability}' credential issued "
                    f"by trusted issuer {status.issuer} on {status.chain}",
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
                "be credentialed by a trusted issuer. UNKNOWN means the "
                "registry could not be read — which is not a pass."
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
    elif not _EVM_ADDRESS_FULL.fullmatch(payee):
        signals.append(
            _signal(
                "verified-payee",
                "SKIPPED",
                0.0,
                f"the payee value {_quote(payee)} is not an EVM address, "
                "so no credential could be checked",
            )
        )
    else:
        status = read_capability(
            payee, capability, chain, trusted_issuers=_trusted_issuers(args)
        )
        if status.status == "unknown":
            signals.append(
                _signal(
                    "verified-payee",
                    "SKIPPED",
                    0.0,
                    f"the credential registry on {status.chain} could not be "
                    f"read, so entitlement is unknown — this is not a pass",
                    error=_clean_field(status.error, 160),
                )
            )
        elif status.status == "capable":
            signals.append(
                _signal(
                    "verified-payee",
                    "GO",
                    1.0,
                    f"the payee holds a live '{capability}' credential issued "
                    f"by trusted issuer {status.issuer} on {status.chain}",
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
        payees = _extract_payees(args)
        if not payees:
            return None
    except Exception:  # noqa: BLE001 - a gate must never wedge the agent
        logger.debug("ligis: payment detection failed", exc_info=True)
        return None

    capability = config.get_str("capability", "") or _extract_capability(args)
    if not capability:
        # Nothing to check against. Escalating here would be noise.
        return None

    chain = config.get_str("chain", DEFAULT_CHAIN) or DEFAULT_CHAIN
    issuers = _trusted_issuers()
    budget = _hook_budget()

    # Check every destination the call names, not just the first — a
    # crafted call can put a credentialed decoy before the real payee. One
    # failed payee is enough to gate; a read failure (``unknown``) is not
    # evidence either way, so it neither gates nor stops the checks.
    bad = None
    checked = 0
    for payee in payees:
        if budget.expired:
            break
        try:
            status = read_capability(
                payee,
                capability,
                chain,
                trusted_issuers=issuers,
                timeout=budget.remaining(),
            )
        except Exception:  # noqa: BLE001
            logger.debug("ligis: credential read failed in hook", exc_info=True)
            continue
        checked += 1
        if status.status == "unknown":
            # A registry outage is not evidence of anything. Do not
            # escalate on it — that would train the user to click through.
            continue
        if status.status == "capable":
            continue
        bad = status
        break
    unchecked = len(payees) - checked

    if bad is None:
        if unchecked:
            logger.debug(
                "ligis: %d destination(s) unchecked (time budget); not gating",
                unchecked,
            )
        return None

    if bad.status == "unverified_issuer":
        reason = (
            f"holds a '{_clean_field(capability)}' credential, but its "
            "issuer is not verified"
        )
    else:
        reason = f"does not hold a live '{_clean_field(capability)}' credential"

    extra = ""
    if len(payees) > 1:
        extra = (
            f" The call names {len(payees)} destination(s); this is the "
            "first that failed the check"
        )
        if unchecked:
            extra += f" ({unchecked} unchecked)"
        extra += "."

    detail = _clean_field(bad.describe(), 240)
    if mode == "enforce":
        return {
            "action": "block",
            "message": (
                f"[LIGIS] Blocked {tool_name}: the payee {bad.subject} "
                f"{reason}. {detail}.{extra} "
                "Verification: read-only eth_call against the credential "
                f"registry on {bad.chain} "
                f"({bad.credential_registry})."
            ),
        }

    return {
        "action": "approve",
        "message": (
            f"[LIGIS] {tool_name} is paying {bad.subject}, which {reason}. "
            f"{detail}.{extra} "
            "Approve only if you have an independent reason to trust this "
            f"payee. Verification: read-only eth_call against the "
            f"credential registry on {bad.chain} "
            f"({bad.credential_registry})."
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

    # Cheap bail before any parsing: a result that names no payee field
    # cannot contain an x402 challenge, so most tool results return here
    # without a JSON scan.
    if "payTo" not in result and "pay_to" not in result:
        return None

    requirements = x402.find_requirements(result)
    if not requirements:
        return None

    capability = config.get_str("capability", "")
    chain = config.get_str("chain", DEFAULT_CHAIN) or DEFAULT_CHAIN
    issuers = _trusted_issuers()
    budget = _hook_budget()

    # The 402 body is untrusted: a payee that is not an EVM address cannot
    # be checked, and each distinct payee costs two sequential RPC calls —
    # so dedupe, validate, and bound how many are checked per result.
    seen: set[str] = set()
    payees: list[x402.PaymentRequirement] = []
    invalid = 0
    for req in requirements:
        if not _EVM_ADDRESS_FULL.fullmatch(req.pay_to.strip()):
            invalid += 1
            continue
        key = req.pay_to.lower()
        if key in seen:
            continue
        seen.add(key)
        payees.append(req)

    skipped_payees = max(0, len(payees) - _MAX_PAYEES_PER_RESULT)
    payees = payees[:_MAX_PAYEES_PER_RESULT]

    lines: list[str] = []
    checked = 0
    capable = 0
    unknown = 0
    timed_out = 0

    for index, req in enumerate(payees):
        payee = _quote(req.pay_to)
        if not capability:
            lines.append(
                f"{_NOTE_PREFIX} this payment would send amount "
                f"{_quote(req.amount, 32)} asset {_quote(req.asset, 48)} "
                f"to payee {payee} on network {_quote(req.network, 48)}. "
                "No capability is configured for this plugin, so the payee's "
                "entitlement was not checked."
            )
            continue

        if budget.expired:
            timed_out = len(payees) - index
            break

        try:
            status = read_capability(
                req.pay_to,
                capability,
                chain,
                trusted_issuers=issuers,
                timeout=budget.remaining(),
            )
        except Exception:  # noqa: BLE001 - a note must never break a result
            logger.debug("ligis: 402 annotation read failed", exc_info=True)
            continue

        checked += 1
        if status.status == "capable":
            capable += 1
            lines.append(
                f"{_NOTE_PREFIX} the payee {payee} HOLDS a live "
                f"'{_clean_field(capability)}' credential, issued by "
                f"trusted issuer {_quote(status.issuer)} on {status.chain}. "
                f"Verified by read-only eth_call against the "
                f"credential registry ({status.credential_registry})."
            )
        elif status.status == "unverified_issuer":
            if issuers:
                why = (
                    f"its issuer {_quote(status.issuer)} is not in the "
                    "trusted issuer list"
                    if status.issuer
                    else "no trusted issuer signed it"
                )
            else:
                why = "no trusted issuers are configured, so it cannot be verified"
            lines.append(
                f"{_NOTE_PREFIX} the payee {payee} holds a live "
                f"'{_clean_field(capability)}' credential, but {why} — a "
                "credential a payee could have issued for itself is not "
                "entitlement. Check this before paying."
            )
        elif status.status == "unknown":
            unknown += 1
            lines.append(
                f"{_NOTE_PREFIX} the payee {payee} could not be checked "
                f"— the credential registry on {status.chain} did not answer "
                f"({_clean_field(status.error, 160)}). That is NOT evidence "
                "that the payee is entitled; it is an unanswered question."
            )
        else:
            lines.append(
                f"{_NOTE_PREFIX} the payee {payee} does NOT hold a live "
                f"'{_clean_field(capability)}' credential — "
                f"{_clean_field(status.describe(), 240)}. "
                f"Verified by read-only eth_call against the credential "
                f"registry on {status.chain} ({status.credential_registry}). "
                "Check this before paying, unless you have an independent "
                "reason to trust this payee."
            )

    if invalid:
        lines.append(
            f"{_NOTE_PREFIX} {invalid} payTo value(s) in this challenge "
            "were not EVM addresses and were not checked."
        )
    if skipped_payees:
        lines.append(
            f"{_NOTE_PREFIX} {skipped_payees} further payee(s) in this "
            f"challenge were not checked (bounded at "
            f"{_MAX_PAYEES_PER_RESULT} per result)."
        )
    if timed_out:
        lines.append(
            f"{_NOTE_PREFIX} {timed_out} payee(s) in this challenge were "
            "not checked (the hook's time budget was reached)."
        )

    if not lines:
        return None

    summary = "\n".join(lines)
    if checked and capable == checked and not unknown:
        summary += (
            "\nEvery payee named in this payment challenge holds a "
            "verified credential for the configured capability."
        )
    elif checked and capable == 0 and not unknown:
        summary += (
            "\nNo payee named in this payment challenge holds a verified "
            "credential for the configured capability. You are about to "
            "pay an uncredentialed counterparty."
        )

    return _append_note(result, summary)


def _append_note(result: str, note: str) -> str:
    """Append a note to a tool result without corrupting its shape.

    Some tools return a JSON envelope whose fields are themselves JSON
    strings — the terminal tool returns
    ``{"output": "<the command's stdout>", "exit_code": 0}``. Appending to
    the envelope's text would produce a string that is no longer valid
    JSON, so the note goes inside the ``output`` field instead: the agent
    reads the same envelope, with the verdict appended to the text it was
    going to read anyway.
    """
    try:
        parsed = json.loads(result)
    except (ValueError, TypeError):
        return f"{result}\n\n{note}"

    if not isinstance(parsed, dict):
        return f"{result}\n\n{note}"

    for key in ("output", "text", "content", "result", "body", "data"):
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            parsed[key] = f"{value}\n\n{note}"
            try:
                return json.dumps(parsed, ensure_ascii=False)
            except (TypeError, ValueError):
                break
            break

    # No text field to append to: keep the envelope valid and put the note
    # in a field of its own.
    parsed["ligis_note"] = note
    try:
        return json.dumps(parsed, ensure_ascii=False)
    except (TypeError, ValueError):
        return f"{result}\n\n{note}"
