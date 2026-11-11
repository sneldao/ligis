"""x402 payment-requirement parsing.

Why this file exists
--------------------
The gate can only check a payee it can see. In a real x402 payment the
payee is *not* in the tool arguments:

* the **402 challenge** carries ``accepts[].payTo`` in plaintext, but it
  arrives as a *tool result* — the agent learns the payee after the
  request and before it signs, which is exactly the window ERC-8478
  describes;
* the **signed retry** carries the same address base64-encoded inside the
  ``X-PAYMENT`` / ``PAYMENT-SIGNATURE`` header, so no plain hex address
  appears anywhere in the command string.

Without this module the plugin gates ``cast send`` and stays silent on the
very flow it is named for.

Both shapes are handled:

* **402 challenge** — JSON with ``x402Version`` and an ``accepts`` array
  (x402 v2), or a single requirements object (v1), possibly embedded in a
  larger text blob (a tool result is usually an error string with the body
  appended).
* **signed payment** — a base64 blob (v1/v2 header form) or a raw JSON
  string, containing ``accepted.payTo`` and/or
  ``payload.authorization.to``.

Only parsing and extraction live here. Deciding what to do with a payee is
``tools``' job, and reading a credential is ``chains``' job.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Any

__all__ = [
    "PaymentRequirement",
    "find_requirements",
    "extract_payees_from_text",
    "extract_payee_from_payment_header",
]


# A hex address. Compared in full, never by prefix or suffix.
_ADDRESS = re.compile(r"0x[a-fA-F0-9]{40}")

# A base64 blob big enough to be a signed payment payload.
_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")

# How deep to follow JSON strings nested inside JSON strings. The terminal
# tool nests twice (result -> output -> body); three is plenty.
_MAX_NESTING = 4


class PaymentRequirement:
    """One ``accepts[]`` entry from an x402 payment requirement."""

    def __init__(self, raw: dict[str, Any]):
        self.raw = raw
        self.pay_to: str = str(raw.get("payTo") or raw.get("pay_to") or "")
        self.network: str = str(raw.get("network") or "")
        self.asset: str = str(raw.get("asset") or "")
        self.amount: str = str(raw.get("amount") or raw.get("maxAmountRequired") or "")
        self.scheme: str = str(raw.get("scheme") or "")
        self.resource: str = ""
        self.source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "pay_to": self.pay_to,
            "network": self.network,
            "asset": self.asset,
            "amount": self.amount,
            "scheme": self.scheme,
            "resource": self.resource,
            "source": self.source,
        }


# --------------------------------------------------------------------------
# 402 challenge
# --------------------------------------------------------------------------

def _requirements_from_json(obj: Any, source: str) -> list[PaymentRequirement]:
    """Pull payment requirements out of a decoded JSON value."""
    found: list[PaymentRequirement] = []

    if isinstance(obj, dict):
        # x402 v2: {"x402Version": 2, "accepts": [ {...}, ... ]}
        accepts = obj.get("accepts")
        if isinstance(accepts, list):
            resource = ""
            res = obj.get("resource")
            if isinstance(res, dict):
                resource = str(res.get("url") or "")
            for entry in accepts:
                if isinstance(entry, dict):
                    req = PaymentRequirement(entry)
                    req.resource = resource
                    req.source = source
                    if req.pay_to:
                        found.append(req)
            return found

        # x402 v1: the requirements object is the body itself.
        if obj.get("payTo") or obj.get("pay_to"):
            req = PaymentRequirement(obj)
            req.source = source
            found.append(req)
            return found

        # A 402 body nested under an error/response wrapper.
        for value in obj.values():
            nested = _requirements_from_json(value, source)
            if nested:
                found.extend(nested)
        return found

    if isinstance(obj, list):
        for entry in obj:
            nested = _requirements_from_json(entry, source)
            if nested:
                found.extend(nested)

    return found


def _json_candidates(text: str, depth: int = 0):
    """Yield decoded JSON values from a text blob, outermost first.

    A tool result is often a JSON *string* whose fields are themselves JSON
    strings: the terminal tool returns
    ``{"output": "{\\"x402Version\\": 2, \\"accepts\\": [...]}"}``. So a
    decoded value is re-scanned for nested JSON strings, up to a small
    depth, or the 402 body inside the terminal output is never seen.
    """
    stripped = text.strip()
    if not stripped:
        return
    try:
        decoded = json.loads(stripped)
    except (ValueError, TypeError):
        decoded = None
    else:
        yield decoded
        if depth < _MAX_NESTING:
            for nested in _nested_json_strings(decoded):
                yield from _json_candidates(nested, depth + 1)
        return

    # Not a JSON document. Scan for balanced objects rather than guessing
    # where the body starts.
    for index, char in enumerate(stripped):
        if char not in "{[":
            continue
        closer = "}" if char == "{" else "]"
        end = stripped.find(closer, index)
        if end == -1:
            continue
        try:
            found = json.loads(stripped[index:end + 1])
        except (ValueError, TypeError):
            continue
        yield found
        if depth < _MAX_NESTING:
            for nested in _nested_json_strings(found):
                yield from _json_candidates(nested, depth + 1)


def _nested_json_strings(value: Any) -> list[str]:
    """Every string inside ``value`` that itself parses as JSON."""
    found: list[str] = []

    def walk(node: Any, depth: int) -> None:
        if depth > _MAX_NESTING:
            return
        if isinstance(node, str):
            candidate = node.strip()
            if candidate[:1] in "{[" and len(candidate) > 8:
                try:
                    json.loads(candidate)
                except (ValueError, TypeError):
                    return
                found.append(candidate)
            return
        if isinstance(node, dict):
            for item in node.values():
                walk(item, depth + 1)
        elif isinstance(node, list):
            for item in node:
                walk(item, depth + 1)

    walk(value, 0)
    return found


def find_requirements(text: str) -> list[PaymentRequirement]:
    """Find x402 payment requirements in a blob of text.

    Returns an empty list when the text is not an x402 challenge.
    """
    if not text:
        return []

    found: list[PaymentRequirement] = []
    seen: set[tuple[str, str]] = set()

    for obj in _json_candidates(text):
        for req in _requirements_from_json(obj, source="402-challenge"):
            key = (req.pay_to.lower(), req.network)
            if key in seen:
                continue
            seen.add(key)
            found.append(req)

    return found


def extract_payees_from_text(text: str) -> list[str]:
    """Every payee address named by an x402 challenge in ``text``."""
    return [req.pay_to for req in find_requirements(text) if req.pay_to]


# --------------------------------------------------------------------------
# Signed payment header
# --------------------------------------------------------------------------

def _payees_from_payment_payload(obj: Any) -> list[str]:
    """The payee(s) a signed x402 payment names."""
    payees: list[str] = []

    if not isinstance(obj, dict):
        return payees

    # v1/v2: {"accepted": {"payTo": ...}}  or  {"accepted": [{...}]}
    accepted = obj.get("accepted")
    if isinstance(accepted, dict):
        payee = str(accepted.get("payTo") or accepted.get("pay_to") or "")
        if payee:
            payees.append(payee)
    elif isinstance(accepted, list):
        for entry in accepted:
            if isinstance(entry, dict):
                payee = str(entry.get("payTo") or entry.get("pay_to") or "")
                if payee:
                    payees.append(payee)

    # v1: {"payload": {"authorization": {"to": ...}}}
    payload = obj.get("payload")
    if isinstance(payload, dict):
        authorization = payload.get("authorization")
        if isinstance(authorization, dict):
            payee = str(authorization.get("to") or "")
            if payee:
                payees.append(payee)

    # A bare requirements object.
    payee = str(obj.get("payTo") or obj.get("pay_to") or "")
    if payee:
        payees.append(payee)

    return payees


def _decode_base64(blob: str) -> str | None:
    """Decode a base64 blob to text, or None if it is not base64."""
    candidate = blob.strip()
    if len(candidate) < 16:
        return None
    # A base64 blob never contains a newline; a wrapped one does.
    candidate = "".join(candidate.split())
    try:
        raw = base64.b64decode(candidate, validate=True)
    except (binascii.Error, ValueError):
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def extract_payee_from_payment_header(header: str) -> list[str]:
    """The payee(s) named by a signed x402 payment header.

    Handles the base64 header form (``X-PAYMENT`` / ``PAYMENT-SIGNATURE``)
    and the raw JSON form. Returns an empty list when the header names no
    payee.
    """
    if not header:
        return []

    # Raw JSON first: it is unambiguous.
    try:
        obj = json.loads(header.strip())
        payees = _payees_from_payment_payload(obj)
        if payees:
            return payees
    except (ValueError, TypeError):
        pass

    # Base64: the header form.
    decoded = _decode_base64(header)
    if decoded:
        try:
            obj = json.loads(decoded)
            payees = _payees_from_payment_payload(obj)
            if payees:
                return payees
        except (ValueError, TypeError):
            pass

    return []


def find_payment_headers(text: str) -> list[str]:
    """Every base64 payment blob in ``text`` (for a command string)."""
    if not text:
        return []
    return [m.group(0) for m in _BASE64_BLOB.finditer(text)]
