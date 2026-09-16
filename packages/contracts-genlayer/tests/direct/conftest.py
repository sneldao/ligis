"""Shared helpers for direct mode tests (matches boilerplate conftest).

genlayer is not on sys.path at collection time; import lazily inside helpers.
"""


def to_address(addr_bytes):
    """Wrap direct-mode address bytes into a genlayer Address."""
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes
    from genlayer.py.types import Address

    return Address(addr_bytes)


def to_hex(addr_bytes):
    """Convert address bytes to checksummed hex matching contract output."""
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    from genlayer.py.types import Address

    return Address(addr_bytes).as_hex
