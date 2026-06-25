# `ligis-composability` — Integrating with Other Pharos Skills

This reference shows how a downstream Skill composes with `PharosAgentID` and
`CredentialRegistry` to gate access by agent identity and capability. Any
contract that imports the `CredentialRegistry` interface can answer the
question "does this agent hold a valid credential for X?" in **one line of
Solidity**.

## Interface

The full surface your Skill needs to import is just two functions:

```solidity
interface ICredentialRegistry {
    function isCapable(address subject, bytes32 capabilityHash)
        external view returns (bool capable);

    function isCapableFromIssuer(address subject, bytes32 capabilityHash, address issuer)
        external view returns (bool capable);
}
```

`isCapable` is the workhorse — returns `true` if the subject holds at least one
valid (non-revoked, non-expired) credential for the given capability, from any
issuer. `isCapableFromIssuer` narrows the check to a specific issuer (useful
for whitelisted KYC providers, accredited-investor registries, etc.).

The capability hash is `keccak256("your.capability.name")`. Use the
`ligis-hash` helper to compute it offline.

---

## Aegis (escrow) — gate counterparties by `agent.commerce.escrow`

Aegis is the on-chain escrow Skill. Before opening an escrow, the buyer's
wallet must hold a valid `agent.commerce.escrow` credential issued by a known
marketplace operator. Three lines of Solidity in your escrow contract:

```solidity
import {ICredentialRegistry} from "ligis/interfaces/ICredentialRegistry.sol";

contract AegisEscrow {
    ICredentialRegistry public immutable creds;
    bytes32 public constant ESCROW_CAP = keccak256("agent.commerce.escrow");

    constructor(ICredentialRegistry _creds) { creds = _creds; }

    function openEscrow(address counterparty) external payable {
        require(creds.isCapable(counterparty, ESCROW_CAP),
                "Aegis: counterparty lacks agent.commerce.escrow");
        // ... rest of escrow logic
    }
}
```

What this gives you: a marketplace operator can pause a malicious seller by
revoking their `agent.commerce.escrow` credential without affecting open
escrows — only new openings are blocked.

**Live integration** (in the BUIDL context): Aegis on Atlantic testnet can be
wired to our `CredentialRegistry` at
`0x9E6eC93200E185c11423eb3A5150449D49d3473A` with a one-line constructor arg.

---

## Pact (cross-chain) — bind agent identity across chains

Pact is the cross-chain bridge. A common attack vector is replaying a
signature across chains. The registry's `DOMAIN_SEPARATOR` mixes the chainId
into the EIP-712 digest, so credentials are non-replayable across chains by
construction. To use the agent identity on the destination chain, the
destination contract calls `isCapable` against its own chain's
`CredentialRegistry` deployment:

```solidity
contract PactBridge {
    ICredentialRegistry public immutable creds; // local chain's registry
    bytes32 public constant PACT_CAP = keccak256("agent.crosschain.pact");

    function release(address recipient, uint256 amount) external {
        require(creds.isCapable(recipient, PACT_CAP),
                "Pact: recipient not authorized for cross-chain transfer");
        // ... release funds
    }
}
```

The same agent address has a separate `PharosAgentID` on each chain (the
agent can mint on each), but the same `DOMAIN_SEPARATOR` rule means a
credential issued on Atlantic is not usable on mainnet even if the subject
and capability match. The user re-issues credentials per chain.

---

## Farolink (data feeds) — gate premium feeds by `data.premium`

Farolink is the data-feed Skill. A simple paywall model: anyone can read the
free tier, but the premium tier requires a `data.premium` capability. One
external call replaces a custom access-control list:

```solidity
contract FarolinkPremium {
    ICredentialRegistry public immutable creds;
    bytes32 public constant PREMIUM_CAP = keccak256("data.premium");

    function readPremium(bytes32 feedId) external view returns (int256) {
        require(creds.isCapable(msg.sender, PREMIUM_CAP),
                "Farolink: caller lacks data.premium");
        return _latestPrice(feedId);
    }
}
```

A user subscribes by getting a `data.premium` credential from any registered
data-vendor issuer (e.g. "Chainlink-on-Pharos", "Pyth-on-Pharos", or a
proprietary in-house vendor). Revocation is instant — no off-chain
sub-cancellation flow needed.

---

## x402 facilitators — gate 402 challenges by `agent.commerce.x402`

x402 is the HTTP-402 payment-required protocol. The facilitator signs a
challenge for the payer's wallet. Before signing, the facilitator should
verify the payer is a known, credentialed agent — not just a fresh wallet
that happens to hold funds:

```solidity
contract X402Facilitator {
    ICredentialRegistry public immutable creds;
    bytes32 public constant X402_CAP = keccak256("agent.commerce.x402");

    function signChallenge(address payer, bytes32 challenge) external view returns (bytes memory) {
        require(creds.isCapable(payer, X402_CAP),
                "x402: payer is not a credentialed agent");
        return _sign(payer, challenge);
    }
}
```

This is the difference between "anyone with a wallet can pay" and "any
credentialed agent can pay". For high-value flows, you can narrow further with
`isCapableFromIssuer(payer, X402_CAP, trustedIssuer)` to only accept agents
credentialed by a specific KYC vendor.

---

## Why this matters for the Dual Cascade

Every Phase 1 Skill in the hackathon needs the same answer to the same
question: "should this agent be allowed to do X?" Today, every Skill
implements its own ad-hoc allowlist (a mapping, a struct, a registry, or
nothing). With this Skill, the answer is one external call, the credential
issuance is off-chain and gasless (EIP-712), and the revocation is
permanently recorded on-chain.

The dual cascade works like this: the **identity cascade** is the registry
(this Skill) + the agent ID (also this Skill). The **commerce cascade** is
Aegis/Pact/Farolink/x402 calling `isCapable(subject, capabilityHash)` to gate
their flows. With this Skill shipping, the other 5+ Phase 1 Skills can stop
re-implementing access control and start composing.

---

## Testing the integration

If you're a Skill developer and want to test against a real `CredentialRegistry`:

1. Deploy: `bash scripts/deploy.sh atlantic` (with a funded deployer)
2. Issue a test credential: `ligis issue --controller <your-wallet> --token-uri "ipfs://test"`
3. Sign: `ligis sign --issuer-key <issuer> --subject <your-wallet> --capability "your.capability" --expires-in 3600`
4. Submit: run the generated `cast send ...` line
5. Verify: `ligis verify --subject <your-wallet> --capability "your.capability"`
6. Use the same `verify` call inside your Skill's contract

Total: 4 commands, ~2 minutes from `git clone` to "my Skill is gated by
agent identity on Atlantic".
