"""Chain access: registry reads over plain JSON-RPC.

Scope and posture
-----------------
This module performs **read-only** ``eth_call`` requests against a public
EVM JSON-RPC endpoint. It does not sign, does not send transactions, does
not hold or request any key, and does not write to disk.

The whole point of the plugin is that verifying a counterparty's credential
needs no credential of your own: the credential registry is public state, so
anyone can read it. A plugin that needed a signing key to *check* whether a
payee was entitled would be a much worse plugin.

What we read
------------
``isCapable(subject, capabilityHash) -> bool``
    True when the subject currently holds a valid, unrevoked, unexpired
    credential for that capability — from *any* issuer. The registry lets
    anyone issue a credential for any subject, so on its own this boolean
    cannot prove entitlement: a payee can issue one for itself.

``isCapableFromIssuer(subject, capabilityHash, issuer) -> bool``
    The trust check. The same question, narrowed to a named issuer, so
    only attestations from issuers the operator chose to trust count.

``latestCredential(subject, capabilityHash) -> CredentialView``
    The detail: ``(issuer, issuedAt, expiresAt, revoked, valid)``. This is
    what lets the plugin say *why* a credential is not valid (revoked vs
    expired vs never issued) instead of only that it is not.

All are ``view`` functions on the CredentialRegistry; none mutates state.

Chains
------
EVM chains only for this build. The capability hash is chain-agnostic by
construction -- it is the keccak-256 of the capability *name*, not of any
chain-specific identifier -- so the same capability resolves to the same
bytes on every registry. That is what makes a credential portable across
chains, and it is the property the plugin demonstrates.
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from . import caphash

__all__ = [
    "Chain",
    "CHAINS",
    "DEFAULT_CHAIN",
    "CredentialStatus",
    "read_capability",
    "capability_hash",
    "rpc_call",
]


# --------------------------------------------------------------------------
# Chain registry
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Chain:
    """One EVM chain the plugin can read a credential registry from."""

    key: str
    name: str
    chain_id: int
    rpc_url: str
    credential_registry: str
    explorer_url: str = ""

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "chain_id": self.chain_id,
            "credential_registry": self.credential_registry,
            "explorer_url": self.explorer_url,
        }


# Registry addresses and RPC endpoints are public deployment facts. They
# match assets/networks.json in the Ligis monorepo; they are duplicated here
# so the plugin is self-contained when installed on its own.
CHAINS: dict[str, Chain] = {
    "pharos-atlantic": Chain(
        key="pharos-atlantic",
        name="Pharos Atlantic Testnet",
        chain_id=688689,
        rpc_url="https://atlantic.dplabs-internal.com",
        credential_registry="0x9E6eC93200E185c11423eb3A5150449D49d3473A",
        explorer_url="https://atlantic.pharosscan.xyz",
    ),
    "monad-testnet": Chain(
        key="monad-testnet",
        name="Monad Testnet",
        chain_id=10143,
        rpc_url="https://testnet-rpc.monad.xyz",
        credential_registry="0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a",
        explorer_url="https://testnet.monadscan.com",
    ),
}

DEFAULT_CHAIN = "monad-testnet"


# --------------------------------------------------------------------------
# ABI encoding
# --------------------------------------------------------------------------

_SELECTOR_IS_CAPABLE = caphash.function_selector("isCapable(address,bytes32)")
_SELECTOR_IS_CAPABLE_FROM_ISSUER = caphash.function_selector(
    "isCapableFromIssuer(address,bytes32,address)"
)
_SELECTOR_LATEST_CREDENTIAL = caphash.function_selector(
    "latestCredential(address,bytes32)"
)

# The registry's "no credential" marker for the issuer field.
_ZERO_ADDRESS = "0x" + "0" * 40

# CredentialView is a static struct -> five 32-byte words:
#   (address issuer, uint256 issuedAt, uint256 expiresAt, bool revoked, bool valid)
_VIEW_WORDS = 5


def _encode_address(address: str) -> str:
    """32-byte left-padded hex word for an address."""
    addr = address.strip().lower()
    if addr.startswith("0x"):
        addr = addr[2:]
    if len(addr) != 40:
        raise ValueError(f"not an address: {address!r}")
    return "0" * 24 + addr


def _encode_bytes32(value: str) -> str:
    """32-byte hex word for a bytes32 value."""
    val = value.strip().lower()
    if val.startswith("0x"):
        val = val[2:]
    if len(val) != 64:
        raise ValueError(f"not a bytes32 value: {value!r}")
    return val


def _encode_call(selector: str, address: str, cap_hash: str) -> str:
    return selector + _encode_address(address) + _encode_bytes32(cap_hash)


def _encode_call_issuer(
    selector: str, address: str, cap_hash: str, issuer: str
) -> str:
    """4-byte selector + three words: subject, capability hash, issuer."""
    return (
        selector
        + _encode_address(address)
        + _encode_bytes32(cap_hash)
        + _encode_address(issuer)
    )


def _decode_uint(word: str) -> int:
    return int(word, 16)


def _decode_bool(word: str) -> bool:
    return int(word, 16) != 0


def _decode_address(word: str) -> str:
    return "0x" + word[-40:]


# --------------------------------------------------------------------------
# JSON-RPC
# --------------------------------------------------------------------------

def _build_verified_context() -> ssl.SSLContext | None:
    """An SSL context that verifies, or None if we cannot build one.

    Some Python builds ship without a usable CA bundle (an empty default
    verify path). ``certifi`` is the usual fix and is present on most
    machines; when neither works we return None and urllib falls back to
    its default context, which still verifies. Verification is never
    disabled anywhere in this module: a TLS failure must surface as an
    unreadable registry, not silently produce an answer.
    """
    try:
        ctx = ssl.create_default_context()
        if ctx.get_ca_certs():
            return ctx
    except Exception:
        pass
    try:
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
        if ctx.get_ca_certs():
            return ctx
    except Exception:
        pass
    return None


_VERIFIED_CTX = _build_verified_context()


class RpcError(RuntimeError):
    """A JSON-RPC call failed or returned an error object."""


def _rpc_request(
    rpc_url: str,
    method: str,
    params: list,
    timeout: float = 15.0,
) -> Any:
    """Send one JSON-RPC request and return the raw ``result`` field.

    A failure raises ``RpcError`` rather than returning a zero value,
    because a failed read must never be reported as "not capable" -- that
    distinction is the difference between "this payee is uncredentialed"
    and "we could not find out".
    """
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode("utf-8")

    request = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ligis-hermes-plugin",
        },
    )

    body: bytes
    try:
        kwargs = {"timeout": timeout}
        if _VERIFIED_CTX is not None:
            kwargs["context"] = _VERIFIED_CTX
        with urllib.request.urlopen(request, **kwargs) as response:
            body = response.read()
    except Exception as exc:  # noqa: BLE001 - re-raised as RpcError below
        # A TLS failure is fatal to the read. Retrying without certificate
        # verification would let anyone on the network path answer
        # isCapable = true, so the failure is surfaced as "unknown" --
        # which the caller never reports as "not capable".
        raise RpcError(f"RPC call to {rpc_url} failed: {exc}") from exc

    try:
        parsed = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise RpcError(f"RPC returned non-JSON from {rpc_url}") from exc

    if isinstance(parsed, dict) and parsed.get("error"):
        error = parsed["error"]
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise RpcError(f"RPC error from {rpc_url}: {message}")

    if not isinstance(parsed, dict) or "result" not in parsed:
        raise RpcError(f"RPC returned no result from {rpc_url}")
    return parsed["result"]


def rpc_call(
    rpc_url: str,
    to: str,
    data: str,
    timeout: float = 15.0,
) -> str:
    """Perform one ``eth_call`` and return the raw hex result.

    Read-only: ``eth_call`` never changes state.
    """
    result = _rpc_request(
        rpc_url, "eth_call", [{"to": to, "data": data}, "latest"], timeout
    )
    if not isinstance(result, str):
        raise RpcError(f"eth_call returned a non-hex result from {rpc_url}")
    return result


# --------------------------------------------------------------------------
# Endpoint honesty
# --------------------------------------------------------------------------
#
# TLS authenticates the transport, not the answer. A hostile or merely
# wrong endpoint can still say ``isCapable = true`` for anyone. Before the
# first read against an (endpoint, registry) pair, probe two cheap facts
# that a lookalike endpoint cannot fake without also failing them:
#
# * ``eth_chainId`` — the endpoint must be serving the chain the registry
#   lives on. A Monad RPC that answers ``688689`` is not Monad.
# * ``eth_getCode(registry)`` — the registry address must hold contract
#   code. An address with no code answering ``true`` is a tell.
#
# Neither is proof of honesty — an endpoint could serve a fork where the
# registry is replaced — but they close the cheap impersonations, and a
# caller can see the registry address in every verdict. Results are cached
# per process; only deterministic verdicts are cached (a transport error
# is retried on the next read).

_endpoint_verdicts: dict[tuple, "str | None"] = {}


def _verify_endpoint(endpoint: str, chain: "Chain", timeout: float) -> "str | None":
    """Probe the endpoint once, or None if it looks like the claimed chain."""
    key = (endpoint, chain.chain_id, chain.credential_registry.lower())
    if key in _endpoint_verdicts:
        return _endpoint_verdicts[key]

    try:
        reported = int(str(_rpc_request(endpoint, "eth_chainId", [], timeout)), 16)
    except (RpcError, ValueError, TypeError) as exc:
        # Transient — do not cache; the next read can try again.
        return f"the endpoint did not answer eth_chainId ({exc})"
    if reported != chain.chain_id:
        verdict = (
            f"the endpoint reports chain id {reported}, expected "
            f"{chain.chain_id} ({chain.name}) — the registry answers "
            "cannot be trusted to come from the claimed chain"
        )
        _endpoint_verdicts[key] = verdict
        return verdict

    try:
        code = _rpc_request(
            endpoint, "eth_getCode", [chain.credential_registry, "latest"], timeout
        )
    except RpcError as exc:
        return f"the endpoint did not answer eth_getCode ({exc})"
    if not isinstance(code, str) or code in ("0x", ""):
        verdict = (
            f"no contract code at the credential registry "
            f"{chain.credential_registry} on {chain.name} — the endpoint "
            "is not serving the expected registry"
        )
        _endpoint_verdicts[key] = verdict
        return verdict

    _endpoint_verdicts[key] = None
    return None


# --------------------------------------------------------------------------
# Credential reads
# --------------------------------------------------------------------------

@dataclass
class CredentialStatus:
    """The outcome of a credential lookup.

    ``status`` is one of:

    ``capable``           the subject holds a valid credential for the
                          capability, verified against a trusted issuer
    ``unverified_issuer`` a live credential exists, but its issuer is not
                          verified -- either no trusted issuers were given
                          or none of them issued it. A credential the
                          subject could have issued for itself is not
                          entitlement; this escalates like ``none``.
    ``revoked``           a credential exists but its issuer revoked it
    ``expired``           a credential exists but it is past its expiry
    ``none``              the subject never held a credential for this
                          capability
    ``unknown``           the read failed -- the registry could not be
                          reached or the call was rejected. Never rendered
                          as "not capable".
    """

    status: str
    capability: str
    capability_hash: str
    subject: str
    chain: str = ""
    chain_id: int = 0
    credential_registry: str = ""
    issuer: str = ""
    issuer_verified: bool = False
    issued_at: int = 0
    expires_at: int = 0
    revoked: bool = False
    valid: bool = False
    explorer_url: str = ""
    error: str = ""
    detail: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "capable"

    def to_dict(self) -> dict:
        out: dict[str, Any] = {
            "status": self.status,
            "capability": self.capability,
            "capability_hash": self.capability_hash,
            "subject": self.subject,
            "chain": self.chain,
            "chain_id": self.chain_id,
            "credential_registry": self.credential_registry,
            "issuer": self.issuer,
            "issuer_verified": self.issuer_verified,
            "revoked": self.revoked,
            "valid": self.valid,
        }
        if self.issued_at:
            out["issued_at"] = self.issued_at
        if self.expires_at:
            out["expires_at"] = self.expires_at
        if self.explorer_url:
            out["explorer_url"] = self.explorer_url
        if self.error:
            out["error"] = self.error
        return out

    def describe(self) -> str:
        """One line a human (or a model) can read at a glance."""
        if self.status == "capable":
            return (
                f"capable — {self.subject} holds '{self.capability}' issued by "
                f"trusted issuer {self.issuer} on {self.chain}"
            )
        if self.status == "unverified_issuer":
            issued = f" issued by {self.issuer}" if self.issuer else ""
            return (
                f"unverified_issuer — {self.subject} holds a live "
                f"'{self.capability}' credential{issued} on {self.chain}, "
                "but the issuer is not verified"
            )
        if self.status == "revoked":
            return (
                f"revoked — the credential for '{self.capability}' held by "
                f"{self.subject} was revoked by its issuer"
            )
        if self.status == "expired":
            return (
                f"expired — the credential for '{self.capability}' held by "
                f"{self.subject} is past its expiry"
            )
        if self.status == "none":
            return (
                f"none — {self.subject} holds no credential for "
                f"'{self.capability}' on {self.chain}"
            )
        return (
            f"unknown — could not read the credential registry on "
            f"{self.chain}: {self.error}"
        )


def capability_hash(name: str) -> str:
    """The chain-agnostic hash of a capability name."""
    return caphash.capability_hash(name)


def read_capability(
    subject: str,
    capability: str,
    chain_key: str = DEFAULT_CHAIN,
    rpc_url: str | None = None,
    timeout: float = 15.0,
    trusted_issuers: list[str] | tuple[str, ...] | None = None,
) -> CredentialStatus:
    """Read whether ``subject`` holds a live credential for ``capability``.

    ``capability`` may be a human-readable name (``"kyc.basic"``) or a
    32-byte hex hash. The name is hashed with keccak-256 locally, which is
    the same hash the registries use on every chain.

    ``trusted_issuers`` are the issuer addresses whose attestations count.
    The registry lets anyone issue a credential for any subject — a payee
    can issue its own — so a live credential only reports ``capable`` when
    one of these issuers signed it (``isCapableFromIssuer``). With an
    empty list a present credential reports ``unverified_issuer``: present,
    but not proof.
    """
    chain = CHAINS.get(chain_key)
    if chain is None:
        raise ValueError(
            f"unknown chain {chain_key!r}; known: {', '.join(sorted(CHAINS))}"
        )

    cap = capability.strip()
    if cap.startswith("0x") and len(cap) == 66:
        cap_hash = cap.lower()
    else:
        cap_hash = capability_hash(cap)

    endpoint = rpc_url or chain.rpc_url

    status = CredentialStatus(
        status="unknown",
        capability=cap if not cap.startswith("0x") else cap_hash,
        capability_hash=cap_hash,
        subject=subject,
        chain=chain.name,
        chain_id=chain.chain_id,
        credential_registry=chain.credential_registry,
        explorer_url=chain.explorer_url,
    )

    # --- the endpoint honesty probe -------------------------------------
    # TLS authenticates the transport; this checks the endpoint is serving
    # the chain and registry it claims before any answer is trusted.
    problem = _verify_endpoint(endpoint, chain, timeout)
    if problem:
        status.error = problem
        return status

    # --- the headline boolean -------------------------------------------
    try:
        raw = rpc_call(
            endpoint,
            chain.credential_registry,
            _encode_call(_SELECTOR_IS_CAPABLE, subject, cap_hash),
            timeout=timeout,
        )
        capable = _decode_bool(raw[-64:]) if len(raw) >= 66 else False
    except RpcError as exc:
        status.error = str(exc)
        return status

    # --- the detail, so we can say *why* --------------------------------
    try:
        view = rpc_call(
            endpoint,
            chain.credential_registry,
            _encode_call(_SELECTOR_LATEST_CREDENTIAL, subject, cap_hash),
            timeout=timeout,
        )
        words = [view[i:i + 64] for i in range(2, len(view), 64)]
        if len(words) >= _VIEW_WORDS:
            status.issuer = _decode_address(words[0])
            status.issued_at = _decode_uint(words[1])
            status.expires_at = _decode_uint(words[2])
            status.revoked = _decode_bool(words[3])
            status.valid = _decode_bool(words[4])
    except RpcError:
        # The detail read is best-effort. A failed detail read must not
        # turn a good boolean into an unknown, and must not invent data.
        pass

    if capable:
        # A live credential exists — but from whom? The registry lets
        # anyone issue for any subject, so the credential only counts if a
        # trusted issuer signed it. The latest credential's own issuer is
        # checked first: when the live credential is the latest one, that
        # resolves the question in a single call instead of one per issuer.
        status.valid = True
        ordered = list(trusted_issuers or [])
        if status.issuer:
            ordered.sort(
                key=lambda i: 0 if i.lower() == status.issuer.lower() else 1
            )
        for issuer in ordered:
            try:
                raw = rpc_call(
                    endpoint,
                    chain.credential_registry,
                    _encode_call_issuer(
                        _SELECTOR_IS_CAPABLE_FROM_ISSUER,
                        subject,
                        cap_hash,
                        issuer,
                    ),
                    timeout=timeout,
                )
            except (RpcError, ValueError):
                continue
            if len(raw) >= 66 and _decode_bool(raw[-64:]):
                status.status = "capable"
                status.issuer = issuer
                status.issuer_verified = True
                return status
        # A credential is present but no trusted issuer vouches for it —
        # report it as such rather than folding it into "none".
        status.status = "unverified_issuer"
    elif not status.issuer or status.issuer == _ZERO_ADDRESS:
        # No credential has ever been issued for this (subject, capability).
        # The zero address is the registry's "empty" marker, and it is a
        # truthy string -- so it has to be compared explicitly.
        status.status = "none"
        status.issuer = ""
    elif status.revoked:
        status.status = "revoked"
    elif status.expires_at:
        status.status = "expired"
    else:
        status.status = "none"

    return status
