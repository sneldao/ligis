"""Fixture definitions for the ligis plugin.

These are the subjects the plugin ships for demonstration and testing. They
are the same subjects the Ligis web app and the other Hermes entries use, so
a demo of this plugin reads consistently with the rest of the portfolio.

Every row is a live fact about a public testnet, re-checked by
``fixtures/selftest.py`` against the chain — not a recorded expectation.
"""

# A subject that holds a live credential.
VERIFIED_SUBJECT = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"

# A subject that holds no credential for anything.
UNVERIFIED_SUBJECT = "0x000000000000000000000000000000000000dEaD"

# Capabilities the demo subjects hold.
COMMERCE_ESCROW = "agent.commerce.escrow"
KYC_BASIC = "kyc.basic"

# A credential that was issued and then revoked by its issuer. It exists in
# the registry and reads as present, but isCapable returns false — which is
# exactly the case a spend-cap plugin cannot see and an endpoint-reputation
# plugin cannot see.
REVOKED_CAPABILITY = "demo.metropolis.revocation"

# Chain keys the plugin can read.
CHAIN_MONAD = "monad-testnet"
CHAIN_PHAROS = "pharos-atlantic"


# The demo matrix: (subject, capability, chain, expected_status).
#
# Note row 2: the SAME capability name, the SAME subject, a DIFFERENT chain
# and a DIFFERENT registry — and the answer is the same. That is the
# chain-agnostic capability hash in action, and it is the headline of the
# demo.
DEMO_MATRIX = (
    {
        "label": "verified agent (Monad)",
        "subject": VERIFIED_SUBJECT,
        "capability": COMMERCE_ESCROW,
        "chain": CHAIN_MONAD,
        "expect": "capable",
    },
    {
        "label": "verified agent (Pharos — same capability, other chain)",
        "subject": VERIFIED_SUBJECT,
        "capability": KYC_BASIC,
        "chain": CHAIN_PHAROS,
        "expect": "capable",
    },
    {
        "label": "revoked credential",
        "subject": VERIFIED_SUBJECT,
        "capability": REVOKED_CAPABILITY,
        "chain": CHAIN_MONAD,
        "expect": "revoked",
    },
    {
        "label": "unverified wallet",
        "subject": UNVERIFIED_SUBJECT,
        "capability": KYC_BASIC,
        "chain": CHAIN_MONAD,
        "expect": "none",
    },
)


if __name__ == "__main__":
    import json

    print(json.dumps(list(DEMO_MATRIX), indent=2))
