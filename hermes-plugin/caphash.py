"""keccak-256 for capability hashing.

Why this file exists
--------------------
Python's stdlib ``hashlib`` ships SHA3-256, which is **not** keccak-256.
They differ in padding: SHA3 appends ``0x06``, keccak (the pre-standard
padding Ethereum uses) appends ``0x01``. Hashing a capability name with
``hashlib.sha3_256`` yields a different digest than the one every credential
registry on every chain uses, so the plugin would look up capabilities that
do not exist.

We need keccak-256 for three things:

1. ``capabilityHash`` — the chain-agnostic hash of a capability *name*.
2. ABI function selectors (the first 4 bytes of keccak-256 of a signature).
3. Nothing else — the plugin never signs, so it never needs a private key.

Dependency posture
------------------
The plugin prefers, in order:

1. ``pycryptodome`` (``Crypto.Hash.keccak``)
2. ``eth_hash`` (``eth_hash.auto.keccak``)

and falls back to a vendored pure-Python implementation. The fallback
matters for catalog admission: a hard dependency on a compiled package is
both an install risk and a scanner concern. The pure-Python path is slow but
perfectly adequate — we hash short strings (a capability name, an ABI
signature) a handful of times per request, never bulk data.

The pure-Python implementation below is the standard Keccak-f[1600]
permutation with the Ethereum padding rule, written out longhand so it can
be read and checked. ``_selftest()`` runs at import against known vectors
and raises if the digest ever disagrees.
"""

from __future__ import annotations

__all__ = ["keccak256", "capability_hash", "function_selector", "KECCAK_BACKEND"]


# --------------------------------------------------------------------------
# Backend selection
# --------------------------------------------------------------------------

def _try_backends():
    """Return (backend_name, keccak256_callable)."""
    try:
        from Crypto.Hash import keccak as _pycryptodome_keccak

        def _via_pycryptodome(data: bytes) -> bytes:
            h = _pycryptodome_keccak.new(digest_bits=256)
            h.update(data)
            return h.digest()

        return "pycryptodome", _via_pycryptodome
    except Exception:
        pass

    try:
        from eth_hash.auto import keccak as _eth_hash_keccak

        def _via_eth_hash(data: bytes) -> bytes:
            return _eth_hash_keccak(data)

        return "eth-hash", _via_eth_hash
    except Exception:
        pass

    return "pure-python", _keccak256_pure


# --------------------------------------------------------------------------
# Pure-Python keccak-f[1600]
# --------------------------------------------------------------------------

_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)

_ROTATION_OFFSETS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)

_MASK64 = (1 << 64) - 1
_RATE_BYTES = 136  # 1088 bits -> keccak-256 capacity 512, rate 1088


def _rol64(value: int, shift: int) -> int:
    shift %= 64
    if shift == 0:
        return value & _MASK64
    return ((value << shift) | (value >> (64 - shift))) & _MASK64


def _keccak_f1600(state: list) -> None:
    """In-place Keccak-f[1600] permutation on a 5x5 lane state."""
    for rc in _ROUND_CONSTANTS:
        # theta
        c = [
            state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4]
            for x in range(5)
        ]
        d = [c[(x - 1) % 5] ^ _rol64(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= d[x]

        # rho + pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                shift = _ROTATION_OFFSETS[x][y]
                b[y][(2 * x + 3 * y) % 5] = _rol64(state[x][y], shift)

        # chi
        for x in range(5):
            for y in range(5):
                state[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y] & _MASK64) & b[(x + 2) % 5][y])

        # iota
        state[0][0] ^= rc


def _keccak256_pure(data: bytes) -> bytes:
    """Keccak-256 with Ethereum's 0x01 padding (not SHA3's 0x06)."""
    # pad10*1 with the keccak domain byte
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % _RATE_BYTES != 0:
        padded.append(0x00)
    padded[-1] ^= 0x80

    state = [[0] * 5 for _ in range(5)]

    # absorb
    for offset in range(0, len(padded), _RATE_BYTES):
        block = padded[offset:offset + _RATE_BYTES]
        for i in range(_RATE_BYTES // 8):
            lane = int.from_bytes(block[i * 8:(i + 1) * 8], "little")
            state[i % 5][i // 5] ^= lane
        _keccak_f1600(state)

    # squeeze (256 bits = 4 lanes)
    out = bytearray()
    for i in range(4):
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

KECCAK_BACKEND, _keccak = _try_backends()


def keccak256(data: bytes) -> bytes:
    """Keccak-256 digest of ``data``."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return _keccak(bytes(data))


def capability_hash(name: str) -> str:
    """The chain-agnostic hash of a capability name.

    A capability is identified by the keccak-256 hash of its
    human-readable name. The same hash is used on every chain, so a
    capability minted on one chain is referentially identical to the same
    capability on another. That is what makes a credential portable: the
    plugin computes this hash locally and reads the same bytes from any
    registry, on any chain.

    Returns a 0x-prefixed 32-byte hex string.
    """
    digest = keccak256(name.encode("utf-8"))
    return "0x" + digest.hex()


def function_selector(signature: str) -> str:
    """The 4-byte ABI function selector for a Solidity signature.

    e.g. ``function_selector("isCapable(address,bytes32)")`` -> ``"0x3f37c189"``.
    """
    digest = keccak256(signature.encode("utf-8"))
    return "0x" + digest[:4].hex()


# --------------------------------------------------------------------------
# Self-test — runs on import so a broken backend can never ship silently
# --------------------------------------------------------------------------

def _selftest() -> None:
    # Known keccak-256 vectors (NOT sha3-256).
    assert (
        keccak256(b"").hex()
        == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    ), "keccak256 of empty string is wrong"
    assert (
        keccak256(b"abc").hex()
        == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    ), "keccak256 of 'abc' is wrong"
    # The function selector the plugin depends on.
    assert (
        function_selector("isCapable(address,bytes32)") == "0x3f37c189"
    ), "isCapable selector is wrong"
    assert (
        function_selector("latestCredential(address,bytes32)") == "0xfef4f1e6"
    ), "latestCredential selector is wrong"
    # The capability hash that must match the credential registries.
    assert (
        capability_hash("agent.commerce.escrow")
        == "0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8"
    ), "capabilityHash('agent.commerce.escrow') does not match the registry"


_selftest()
