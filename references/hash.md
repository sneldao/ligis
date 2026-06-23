# `ligis-hash` — Compute a Capability Hash

Capability strings are hashed to `bytes32` with `keccak256` (the Solidity default). The
hash is the on-chain identifier. The hash is the same on every chain.

## Usage

```bash
cast keccak "agent.commerce.escrow"
# 0x...
```

## Casing and whitespace

The hash is **case-sensitive** and **whitespace-sensitive**. Always pass the exact string
the issuer used. The starter set in `assets/credentials.example.json` uses
`lowercase.dot.case` with no leading/trailing whitespace.

## Adding a new capability

1. Pick a name, e.g. `"agent.commerce.recurring"`.
2. Hash it: `cast keccak "agent.commerce.recurring"` → `0x...`.
3. Add it to your issuer's known-capabilities list.
4. The on-chain `CredentialRegistry` doesn't need to know — it just stores whatever
   `bytes32` the issuer signs.

## Storage pattern

Many Skills store a `bytes32 public constant CAP_X = keccak256("x.y.z")` in the
contract. This is the recommended pattern: compile-time, no off-chain lookup needed.

```solidity
bytes32 public constant AGENT_COMMERCE_ESCROW = keccak256("agent.commerce.escrow");
```

When comparing off-chain, use the same string:

```bash
CAP_HASH=$(cast keccak "agent.commerce.escrow")
cast call $CREG "isCapable(address,bytes32)(bool)" $SUBJECT $CAP_HASH --rpc-url $RPC
```

## Where the value 0x0000... is special

The hash `0x0000000000000000000000000000000000000000000000000000000000000000` is the
"empty" capability and is treated as invalid by the contract. Do not use it as a
capability name. (If you somehow did, `keccak256("")` is
`0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`, which is fine,
so this is mostly a defensive note.)
