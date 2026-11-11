#!/usr/bin/env python3
"""Offline unit tests for the ligis plugin.

These run without a network: the chain read is stubbed. They cover the
logic that a live self-test cannot check — ABI encoding, decoding, the
four-signal verdict rules, and the payment-call detection.

    python3 tests/test_ligis.py

Exit code 0 means every test passed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _loader import chains, caphash, tools, x402  # noqa: E402

FAILURES: list[str] = []
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"[PASS] {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"[FAIL] {name}  {detail}")


# --------------------------------------------------------------------------
# keccak / capability hashing
# --------------------------------------------------------------------------

def test_keccak() -> None:
    check(
        "keccak256 of empty string",
        caphash.keccak256(b"").hex()
        == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    )
    check(
        "keccak256 of 'abc'",
        caphash.keccak256(b"abc").hex()
        == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    )
    check(
        "keccak256 differs from sha3-256",
        caphash.keccak256(b"abc").hex()
        != __import__("hashlib").sha3_256(b"abc").hexdigest(),
        "stdlib sha3 must not be used — it is a different digest",
    )
    check(
        "capabilityHash matches the registry",
        caphash.capability_hash("agent.commerce.escrow")
        == "0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8",
    )
    check(
        "pure-python keccak agrees with the installed backend",
        caphash._keccak256_pure(b"abc").hex() == caphash.keccak256(b"abc").hex(),
    )
    check(
        "isCapable selector",
        caphash.function_selector("isCapable(address,bytes32)") == "0x3f37c189",
    )


# --------------------------------------------------------------------------
# ABI encoding
# --------------------------------------------------------------------------

def test_abi() -> None:
    encoded = chains._encode_call(
        chains._SELECTOR_IS_CAPABLE,
        "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
        "0x" + "11" * 32,
    )
    check(
        "calldata is 4 + 32 + 32 bytes",
        len(encoded) == 2 + 8 + 64 + 64,
        f"got {len(encoded) - 2} hex chars",
    )
    check("calldata starts with the selector", encoded.startswith("0x3f37c189"))
    check(
        "address is left-padded into a word",
        encoded[10:74]
        == "0" * 24 + "d21a4c7ab1a52a2ab48a6f0271984d5c3d4027ec",
        "ABI encoding lowercases the hex",
    )
    check(
        "bytes32 is a full word",
        encoded[74:138] == "11" * 32,
    )

    try:
        chains._encode_address("0xdeadbeef")
        check("short address is rejected", False, "no error raised")
    except ValueError:
        check("short address is rejected", True)

    try:
        chains._encode_bytes32("0xabcd")
        check("short bytes32 is rejected", False, "no error raised")
    except ValueError:
        check("short bytes32 is rejected", True)

    # Decoding
    check(
        "decode_bool true",
        chains._decode_bool("f" * 64) is True,
    )
    check(
        "decode_bool false",
        chains._decode_bool("0" * 64) is False,
    )
    check(
        "decode_address",
        chains._decode_address("0" * 24 + "d21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec")
        == "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    )
    check(
        "decode_uint",
        chains._decode_uint("0" * 62 + "0a") == 10,
    )


# --------------------------------------------------------------------------
# Payment-call detection
# --------------------------------------------------------------------------

def test_payment_detection() -> None:
    check(
        "cast send is payment-shaped",
        tools._looks_like_payment("terminal", {"command": "cast send 0xabc --value 1"}),
    )
    check(
        "solana transfer is payment-shaped",
        tools._looks_like_payment(
            "terminal", {"command": "solana transfer ABC 1 --recipient X"}
        ),
    )
    check(
        "curl with X-PAYMENT is payment-shaped",
        tools._looks_like_payment(
            "terminal", {"command": "curl -H 'X-PAYMENT: 0x..' https://x/api"}
        ),
    )
    check(
        "a plain ls is not payment-shaped",
        not tools._looks_like_payment("terminal", {"command": "ls -la"}),
    )
    check(
        "a read-only command is not payment-shaped",
        not tools._looks_like_payment("terminal", {"command": "cat README.md"}),
    )
    check(
        "a payment MCP tool with a payee argument is payment-shaped",
        tools._looks_like_payment("mcp__x402__pay", {"payee": "0x" + "11" * 20}),
    )
    check(
        "a send_message tool is not payment-shaped",
        not tools._looks_like_payment("send_message", {"to": "0x" + "11" * 20}),
    )
    check(
        "an explicit payment argument is payment-shaped",
        tools._looks_like_payment("some_tool", {"payment": {"payTo": "0x" + "11" * 20}}),
    )


def test_payee_extraction() -> None:
    check(
        "payee from a named argument",
        tools._extract_payee({"payee": "0x" + "11" * 20}) == "0x" + "11" * 20,
    )
    check(
        "payee from a to-address",
        tools._extract_payee({"to": "0x" + "22" * 20}) == "0x" + "22" * 20,
    )
    check(
        "payee from a command string",
        tools._extract_payee({"command": "cast send 0x" + "33" * 20}) == "0x" + "33" * 20,
    )
    check(
        "no payee when there is no address",
        tools._extract_payee({"command": "ls"}) == "",
    )


# --------------------------------------------------------------------------
# The four-signal verdict
# --------------------------------------------------------------------------

def _signal_map(payload: str) -> dict:
    import json

    data = json.loads(payload)
    return {s["id"]: s for s in data["signals"]}, data


def test_verdict_rules() -> None:
    # All four signals can pass.
    signals, data = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "amount_usd": 100.0,
                "purpose": "renew licence",
                "expected_payees": ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
                "expected_usd": 100.0,
                "capability": "agent.commerce.escrow",
            }
        )
    )
    check(
        "right-payee passes for a contracted destination",
        signals["right-payee"]["status"] == "GO",
    )
    check(
        "right-amount passes within tolerance",
        signals["right-amount"]["status"] == "GO",
    )
    check(
        "verified-payee passes for a credentialed payee",
        signals["verified-payee"]["status"] == "GO",
    )
    check(
        "in-scope is SKIPPED without an operator policy",
        signals["in-scope"]["status"] == "SKIPPED",
    )
    check(
        "a verdict with skips is not a plain GO",
        data["verdict"] == "GO_WITH_SKIPS",
        f"got {data['verdict']}",
    )
    check(
        "skipped signals are listed",
        "in-scope" in data["skipped_signals"],
    )

    # A payee that is not contracted must STOP.
    signals, data = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0x" + "99" * 20,
                "amount_usd": 100.0,
                "purpose": "renew licence",
                "expected_payees": ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
                "expected_usd": 100.0,
                "capability": "agent.commerce.escrow",
            }
        )
    )
    check(
        "right-payee STOPS for an uncontracted destination",
        signals["right-payee"]["status"] == "STOP",
    )
    check("STOP wins the verdict", data["verdict"] == "STOP")

    # An amount far from the agreed figure must STOP.
    signals, data = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "amount_usd": 5000.0,
                "purpose": "renew licence",
                "expected_payees": ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
                "expected_usd": 100.0,
                "capability": "agent.commerce.escrow",
            }
        )
    )
    check(
        "right-amount STOPS far outside tolerance",
        signals["right-amount"]["status"] == "STOP",
    )

    # A missing expected amount must SKIP, never pass.
    signals, _ = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "amount_usd": 100.0,
                "purpose": "renew licence",
                "expected_payees": ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
                "capability": "agent.commerce.escrow",
            }
        )
    )
    check(
        "right-amount SKIPS without an expected amount",
        signals["right-amount"]["status"] == "SKIPPED",
    )

    # A missing capability must SKIP the credential check, not pass it.
    signals, _ = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "amount_usd": 100.0,
                "purpose": "renew licence",
                "expected_payees": ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
                "expected_usd": 100.0,
            }
        )
    )
    check(
        "verified-payee SKIPS without a capability",
        signals["verified-payee"]["status"] == "SKIPPED",
    )

    # A comma-separated expected_payees string is accepted.
    signals, _ = _signal_map(
        tools.ligis_verify_payee(
            {
                "payee": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "amount_usd": 100.0,
                "purpose": "renew licence",
                "expected_payees": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "expected_usd": 100.0,
            }
        )
    )
    check(
        "a comma-separated payee list is parsed",
        signals["right-payee"]["status"] == "GO",
    )


def test_x402_parsing() -> None:
    """The x402 shapes the plugin must read: a 402 challenge and a signed header."""
    import base64
    import json as _json

    body = {
        "x402Version": 2,
        "error": "PAYMENT-SIGNATURE header is required",
        "resource": {"url": "https://x/premium", "mimeType": "application/json"},
        "accepts": [
            {
                "scheme": "exact",
                "network": "eip155:10143",
                "asset": "0x16f6bD0c285a630fe72275909c0f5815d276E2f4",
                "amount": "5000000",
                "payTo": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "maxTimeoutSeconds": 300,
            }
        ],
        "extensions": {},
    }
    text = _json.dumps(body)

    check(
        "a 402 challenge names its payee",
        x402.extract_payees_from_text(text)
        == ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
    )
    check(
        "a 402 challenge inside an error string still names its payee",
        x402.extract_payees_from_text(f"Error: 402 Payment Required\n\n{text}")
        == ["0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"],
    )
    check(
        "a v1 requirements body names its payee",
        x402.extract_payees_from_text(
            _json.dumps(
                {
                    "x402Version": 1,
                    "scheme": "exact",
                    "network": "eip155:10143",
                    "amount": "5000000",
                    "payTo": "0x000000000000000000000000000000000000dEaD",
                }
            )
        )
        == ["0x000000000000000000000000000000000000dEaD"],
    )
    check(
        "ordinary text names no payee",
        x402.extract_payees_from_text("just some text") == [],
    )

    payload = {
        "x402Version": 1,
        "accepted": {
            "scheme": "exact",
            "network": "eip155:10143",
            "amount": "5000000",
            "payTo": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
        },
        "payload": {
            "authorization": {
                "from": "0xabc",
                "to": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                "value": "5000000",
            }
        },
    }
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()
    check(
        "a base64 payment header names its payee",
        "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"
        in x402.extract_payee_from_payment_header(b64),
    )
    check(
        "a raw JSON payment header names its payee",
        "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"
        in x402.extract_payee_from_payment_header(_json.dumps(payload)),
    )
    check(
        "a non-payment header names no payee",
        x402.extract_payee_from_payment_header("hello world") == [],
    )


def test_x402_payee_reaches_the_gate() -> None:
    """The defect the product work fixes: the payee is invisible in the args."""
    import base64
    import json as _json

    payload = {
        "x402Version": 1,
        "accepted": {
            "scheme": "exact",
            "network": "eip155:10143",
            "amount": "5000000",
            "payTo": "0x000000000000000000000000000000000000dEaD",
        },
    }
    b64 = base64.b64encode(_json.dumps(payload).encode()).decode()
    command = f"curl -X GET https://api.example.com/data -H 'X-PAYMENT: {b64}'"

    check(
        "the x402 retry is payment-shaped",
        tools._looks_like_payment("terminal", {"command": command}),
    )
    check(
        "the payee is recovered from the base64 header",
        tools._extract_payee({"command": command})
        == "0x000000000000000000000000000000000000dEaD",
    )


def test_402_annotation() -> None:
    """The 402 challenge hook annotates the result with the payee's verdict."""
    import json as _json

    tools.config.bind(
        _FakeCtx(
            {
                "mode": "escalate",
                "capability": "agent.commerce.escrow",
                "chain": "monad-testnet",
            }
        )
    )

    body = {
        "x402Version": 2,
        "accepts": [
            {
                "scheme": "exact",
                "network": "eip155:10143",
                "amount": "5000000",
                "payTo": "0x000000000000000000000000000000000000dEaD",
            }
        ],
    }
    result = tools.transform_tool_result(
        "http_request", _json.dumps(body), {}, "task-1", session_id="s1"
    )
    check(
        "a 402 challenge is annotated",
        result is not None and "[LIGIS]" in result,
        f"got {result!r}",
    )
    check(
        "the annotation names the payee",
        result is not None
        and "0x000000000000000000000000000000000000dEaD" in result,
    )
    check(
        "the annotation says the credential is missing",
        result is not None and "does NOT hold" in result,
    )
    check(
        "the annotation names the registry it read",
        result is not None
        and "0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a" in result,
    )
    check(
        "the original result is preserved",
        result is not None and result.startswith("{"),
    )

    # A result with no payment challenge is left untouched.
    check(
        "a non-payment result is unchanged",
        tools.transform_tool_result("read_file", "hello", {}, "task-2") is None,
    )

    # A credentialed payee is reported as such.
    body_ok = {
        "x402Version": 2,
        "accepts": [
            {
                "scheme": "exact",
                "network": "eip155:10143",
                "amount": "5000000",
                "payTo": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
            }
        ],
    }
    result = tools.transform_tool_result(
        "http_request", _json.dumps(body_ok), {}, "task-3", session_id="s1"
    )
    check(
        "a credentialed payee is reported as holding the credential",
        result is not None and "HOLDS a live" in result,
        f"got {result!r}",
    )


def test_terminal_envelope_shape() -> None:
    """The terminal tool returns a JSON envelope; the note must go inside it.

    The terminal tool's result is
    ``{"output": "<stdout>", "exit_code": 0}`` — a JSON string whose
    ``output`` field is itself the command's text. Two things follow, and
    both were bugs: the 402 body is nested inside that string (so the
    parser has to look through it), and the note has to go inside the
    envelope rather than after it (or the envelope stops being valid JSON).
    """
    import json as _json

    tools.config.bind(
        _FakeCtx(
            {
                "mode": "escalate",
                "capability": "agent.commerce.escrow",
                "chain": "monad-testnet",
            }
        )
    )

    body = {
        "x402Version": 2,
        "accepts": [
            {
                "scheme": "exact",
                "network": "eip155:10143",
                "amount": "1000000",
                "payTo": "0x000000000000000000000000000000000000dEaD",
            }
        ],
    }
    envelope = _json.dumps(
        {"output": _json.dumps(body), "exit_code": 0, "status": "success"}
    )

    result = tools.transform_tool_result(
        "terminal", envelope, {"command": "curl ..."}, "task-1", session_id="s1"
    )
    check(
        "a 402 inside the terminal envelope is found",
        result is not None and "[LIGIS]" in result,
        f"got {result!r}",
    )
    check(
        "the envelope stays valid JSON",
        result is not None and isinstance(_json.loads(result), dict),
    )
    check(
        "the note lands inside the output field",
        result is not None
        and "[LIGIS]" in _json.loads(result).get("output", ""),
    )
    check(
        "the original output text is preserved",
        result is not None and "x402Version" in _json.loads(result).get("output", ""),
    )
    check(
        "the envelope's other fields are untouched",
        result is not None and _json.loads(result).get("exit_code") == 0,
    )


def test_append_note_shapes() -> None:
    """_append_note keeps every result shape valid."""
    import json as _json

    check(
        "plain text gets the note appended",
        tools._append_note("hello", "NOTE") == "hello\n\nNOTE",
    )
    check(
        "a JSON envelope keeps its shape",
        isinstance(_json.loads(tools._append_note('{"output": "x"}', "NOTE")), dict),
    )
    check(
        "an envelope without a text field gets a note field",
        "ligis_note" in _json.loads(tools._append_note('{"a": 1}', "NOTE")),
    )
    check(
        "a JSON array result is left readable",
        "NOTE" in tools._append_note("[1, 2]", "NOTE"),
    )


def test_verify_payment_tool() -> None:
    """ligis_verify_payment — the path for wallet flows no hook can see."""
    import json as _json

    tools.config.bind(
        _FakeCtx({"mode": "escalate", "chain": "monad-testnet"})
    )

    body = {
        "x402Version": 2,
        "accepts": [
            {
                "scheme": "exact",
                "network": "eip155:10143",
                "amount": "5000000",
                "payTo": "0x000000000000000000000000000000000000dEaD",
            }
        ],
    }
    payload = _json.loads(
        tools.ligis_verify_payment(
            {"requirement": _json.dumps(body), "capability": "agent.commerce.escrow"}
        )
    )
    check("verify_payment names the payee", payload["payees"] == ["0x000000000000000000000000000000000000dEaD"])
    check("verify_payment STOPS an uncredentialed payee", payload["verdict"] == "STOP")

    payload_ok = _json.loads(
        tools.ligis_verify_payment(
            {
                "requirement": _json.dumps(
                    {
                        "x402Version": 2,
                        "accepts": [
                            {
                                "scheme": "exact",
                                "network": "eip155:10143",
                                "amount": "5000000",
                                "payTo": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
                            }
                        ],
                    }
                ),
                "capability": "agent.commerce.escrow",
            }
        )
    )
    check("verify_payment GOES for a credentialed payee", payload_ok["verdict"] == "GO")

    check(
        "verify_payment errors cleanly with no payee",
        "error"
        in _json.loads(
            tools.ligis_verify_payment(
                {"requirement": "not a payment", "capability": "agent.commerce.escrow"}
            )
        ),
    )


def test_tool_argument_handling() -> None:
    """The handler signature must match Hermes's contract: (args, **kwargs)."""
    import inspect
    import json

    for name in (
        "ligis_check_capability",
        "ligis_capability_hash",
        "ligis_verify_payee",
        "ligis_chains",
    ):
        params = list(inspect.signature(getattr(tools, name)).parameters.values())
        check(
            f"{name} takes a single args dict",
            params[0].name == "args",
            f"got {params[0].name}",
        )
        check(
            f"{name} accepts **kwargs",
            any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params),
        )

    # Missing required arguments return an error JSON, never raise.
    result = json.loads(tools.ligis_check_capability({}))
    check(
        "check_capability errors cleanly with no args",
        "error" in result,
    )
    result = json.loads(tools.ligis_capability_hash({}))
    check(
        "capability_hash errors cleanly with no args",
        "error" in result,
    )
    result = json.loads(tools.ligis_verify_payee({"payee": "0x1"}))
    check(
        "verify_payee errors cleanly with no amount",
        "error" in result,
    )


def test_tool_output_shapes() -> None:
    import json

    payload = json.loads(
        tools.ligis_capability_hash({"capability": "agent.commerce.escrow"})
    )
    check(
        "capability_hash tool returns the registry hash",
        payload["capability_hash"]
        == "0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8",
    )

    chains_payload = json.loads(tools.ligis_chains({}))
    check(
        "chains tool lists both chains",
        len(chains_payload["chains"]) == 2,
    )
    check(
        "chains tool names the default",
        chains_payload["default_chain"] == "monad-testnet",
    )


# --------------------------------------------------------------------------
# The hook
# --------------------------------------------------------------------------

class _FakeCtx:
    """A minimal ctx so the hook can be exercised without Hermes."""

    def __init__(self, settings: dict | None = None) -> None:
        self._settings = settings or {}

    def get_config(self, key: str, default=None):
        return self._settings.get(key, default)


def test_hook() -> None:
    import json

    tools.config.bind(
        _FakeCtx(
            {
                "mode": "escalate",
                "capability": "agent.commerce.escrow",
                "chain": "monad-testnet",
            }
        )
    )

    # A payment to an uncredentialed payee must escalate.
    decision = tools.pre_tool_call(
        "terminal",
        {"command": "cast send 0x000000000000000000000000000000000000dEaD --value 1"},
        "task-1",
        session_id="s1",
    )
    check(
        "hook escalates an uncredentialed payee",
        decision is not None and decision.get("action") == "approve",
        f"got {decision}",
    )
    check(
        "the escalation names the payee",
        decision is not None and "dEaD" in decision.get("message", ""),
    )

    # A payment to a credentialed payee must be allowed.
    decision = tools.pre_tool_call(
        "terminal",
        {
            "command": (
                "cast send 0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec --value 1"
            )
        },
        "task-2",
        session_id="s1",
    )
    check(
        "hook allows a credentialed payee",
        decision is None,
        f"got {decision}",
    )

    # A non-payment call must be untouched.
    decision = tools.pre_tool_call(
        "terminal", {"command": "ls -la"}, "task-3", session_id="s1"
    )
    check("hook ignores non-payment calls", decision is None)

    # Enforce mode must block instead of escalating.
    tools.config.bind(
        _FakeCtx(
            {
                "mode": "enforce",
                "capability": "agent.commerce.escrow",
                "chain": "monad-testnet",
            }
        )
    )
    decision = tools.pre_tool_call(
        "terminal",
        {"command": "cast send 0x000000000000000000000000000000000000dEaD --value 1"},
        "task-4",
        session_id="s1",
    )
    check(
        "enforce mode blocks",
        decision is not None and decision.get("action") == "block",
        f"got {decision}",
    )

    # Off mode must never gate.
    tools.config.bind(_FakeCtx({"mode": "off", "capability": "agent.commerce.escrow"}))
    decision = tools.pre_tool_call(
        "terminal",
        {"command": "cast send 0x000000000000000000000000000000000000dEaD --value 1"},
        "task-5",
        session_id="s1",
    )
    check("off mode never gates", decision is None)


def main() -> int:
    print("ligis offline unit tests\n")
    test_keccak()
    test_abi()
    test_payment_detection()
    test_payee_extraction()
    test_verdict_rules()
    test_x402_parsing()
    test_x402_payee_reaches_the_gate()
    test_402_annotation()
    test_terminal_envelope_shape()
    test_append_note_shapes()
    test_verify_payment_tool()
    test_tool_argument_handling()
    test_tool_output_shapes()
    test_hook()

    print()
    if FAILURES:
        print(f"FAILED — {len(FAILURES)} of {PASSED + len(FAILURES)} tests failed:")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print(f"OK — all {PASSED} tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
