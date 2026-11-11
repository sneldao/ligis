"""Tool schemas for the ligis plugin.

The ``description`` field is how the model decides whether to call a tool,
so each one says what it does *and* what comes back. The parameter
descriptions say the units and the accepted formats, because a model that
guesses wrong here produces a wrong verdict.

Every schema is explicit about the one distinction that matters in this
domain: ``revoked`` is not ``none``, and ``unknown`` is not ``none``.
"""

LIGIS_CHECK_CAPABILITY = {
    "name": "ligis_check_capability",
    "description": (
        "Check whether an address holds a live on-chain capability "
        "credential (a third-party-issued, revocable permission) on a "
        "public chain. Reads the credential registry directly over "
        "read-only JSON-RPC — no key, no account, no hosted service. "
        "Returns one of: 'capable' (holds a valid credential), 'revoked' "
        "(the issuer revoked it), 'expired' (past its expiry), 'none' "
        "(never issued), or 'unknown' (the registry could not be read). "
        "Use this before paying, lending to, or granting access to an "
        "address whose entitlement you need to establish."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": (
                    "The address that may hold the credential, e.g. "
                    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec."
                ),
            },
            "capability": {
                "type": "string",
                "description": (
                    "The capability to check, as a name ('kyc.basic', "
                    "'agent.commerce.escrow') or a 0x-prefixed 32-byte "
                    "keccak256 hash. A name is hashed locally with "
                    "keccak-256, which is chain-agnostic — the same name "
                    "resolves to the same bytes on every chain."
                ),
            },
            "chain": {
                "type": "string",
                "description": (
                    "Which chain to read. 'monad-testnet' (default) or "
                    "'pharos-atlantic'. The credential hash is the same on "
                    "both, so a capability issued on one is found on the "
                    "other."
                ),
                "default": "monad-testnet",
            },
        },
        "required": ["subject", "capability"],
    },
}


LIGIS_CAPABILITY_HASH = {
    "name": "ligis_capability_hash",
    "description": (
        "Compute the chain-agnostic capability hash — the keccak-256 of a "
        "capability name — that every credential registry uses to index a "
        "capability. The same name always produces the same hash on every "
        "chain, which is what makes a credential portable: mint "
        "'kyc.basic' on one chain and it is the same capability "
        "everywhere. Returns the 0x-prefixed 32-byte hash."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "capability": {
                "type": "string",
                "description": (
                    "The capability name, e.g. 'kyc.basic' or "
                    "'agent.commerce.escrow'."
                ),
            },
        },
        "required": ["capability"],
    },
}


LIGIS_VERIFY_PAYEE = {
    "name": "ligis_verify_payee",
    "description": (
        "Verify that a payee is entitled to be paid, before the money "
        "moves. Evaluates four independent signals against the chain: "
        "right-payee (is this payee one you contracted with), right-amount "
        "(is the amount within tolerance), in-scope (does this purchase "
        "match what the agent was asked to buy), and verified-payee (does "
        "the payee hold a live third-party-issued capability credential). "
        "Returns GO, STOP or UNKNOWN with the full signal stack, where "
        "each signal is separately GO, STOP or SKIPPED — SKIPPED means "
        "that signal could not be evaluated and is never reported as a "
        "pass. Use this before any payment to an unfamiliar address."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "payee": {
                "type": "string",
                "description": "The address being paid, 0x-prefixed.",
            },
            "amount_usd": {
                "type": "number",
                "description": (
                    "The amount in USD. Used for the right-amount "
                    "tolerance check."
                ),
            },
            "purpose": {
                "type": "string",
                "description": (
                    "What the payment is for, in plain language, e.g. "
                    "'renew annual infrastructure licence'. Used for the "
                    "in-scope check — keep it specific and factual."
                ),
            },
            "capability": {
                "type": "string",
                "description": (
                    "The capability the payee must hold, e.g. "
                    "'agent.commerce.escrow'. Optional: without it the "
                    "verified-payee signal is SKIPPED rather than assumed."
                ),
            },
            "expected_payees": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Addresses you contracted with. The right-payee signal "
                    "passes when the payee is in this list. Omit it and "
                    "that signal is SKIPPED."
                ),
            },
            "expected_usd": {
                "type": "number",
                "description": (
                    "The amount you expected to pay. The right-amount "
                    "signal passes when amount_usd is within tolerance of "
                    "it. Omit it and that signal is SKIPPED."
                ),
            },
            "chain": {
                "type": "string",
                "description": (
                    "Which chain to read for the credential check. "
                    "'monad-testnet' (default) or 'pharos-atlantic'."
                ),
                "default": "monad-testnet",
            },
        },
        "required": ["payee", "amount_usd", "purpose"],
    },
}


LIGIS_CHAINS = {
    "name": "ligis_chains",
    "description": (
        "List the chains this plugin can read credential registries from, "
        "with the registry address and chain id for each. Useful when you "
        "need to know which chain a capability hash was checked on."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}
