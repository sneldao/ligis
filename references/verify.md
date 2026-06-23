# `ligis-verify` — Check if an Agent Holds a Capability

Read-only. Safe to call without a private key. Use this *before* letting an agent use a
gated Skill (Aegis escrow, FaroLink swap, Maestro mandates, Pact x402, Pharos NFT
Manager, etc.).

## Step 0 — Load addresses and RPC

```bash
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
CREG=$(jq -r '.deployment.atlantic-testnet.credentialRegistry' assets/deployment.json)
```

## Step 1 — Hash the capability

```bash
CAP_HASH=$(cast keccak "agent.commerce.escrow")
```

## Step 2 — Verify

```bash
SUBJECT=0x...   # the agent's controller wallet

cast call $CREG "isCapable(address,bytes32)(bool)" $SUBJECT $CAP_HASH --rpc-url $RPC
# returns true / false
```

That's it. No private key needed, no gas (it's a view call).

## Optional: verify from a specific issuer

Some Skills require the credential to come from a known issuer (e.g., a DAO, a KYC
provider, a marketplace operator). Use `isCapableFromIssuer` to check:

```bash
ISSUER=0x...   # the expected issuer

cast call $CREG "isCapableFromIssuer(address,bytes32,address)(bool)" \
  $SUBJECT $CAP_HASH $ISSUER --rpc-url $RPC
```

## Optional: read the latest credential view

For richer info (issuer, issuedAt, expiresAt, revoked status, validity), use
`latestCredential`:

```bash
cast call $CREG "latestCredential(address,bytes32)(address,uint64,uint64,bool,bool)" \
  $SUBJECT $CAP_HASH --rpc-url $RPC
```

Returns `(issuer, issuedAt, expiresAt, revoked, valid)`.

## Integration pattern for downstream Skills

```solidity
import {ICredentialRegistry} from "./interfaces/ICredentialRegistry.sol";

contract AegisEscrow {
    ICredentialRegistry public immutable creds;
    bytes32 public constant KYC_BASIC = keccak256("kyc.basic");

    modifier onlyKYCed(address payer) {
        require(creds.isCapable(payer, KYC_BASIC), "Aegis: payer not KYCed");
        _;
    }

    function createEscrow(address payer, ...) external onlyKYCed(payer) { ... }
}
```

The `isCapable` call is a `view` (no gas from the user's perspective when called
off-chain via `cast call`, and very cheap when called on-chain by another contract).

## Errors

- `cast call` returns empty bytes → the contract is not deployed at `$CREG`. Check
  `assets/deployment.json`. The most common cause is `PENDING_DEPLOYMENT` because
  `scripts/deploy.sh` was never run on this network.
- The capability hash is **case-sensitive** and must match what was used at issue time.
  Use `cast keccak "exact-name"` to be safe. Common pitfall: `"agent.commerce.escrow"`
  vs `"Agent.Commerce.Escrow"`.

## What the result means

- `true` — the subject currently holds a valid (non-revoked, non-expired) credential for
  the capability from at least one issuer. The downstream Skill may proceed.
- `false` — either no credential was issued, the credential was revoked, or the
  credential expired. The downstream Skill should reject the action and tell the user to
  get a fresh credential via `ligis-issue`.
- For a per-issuer check, `isCapableFromIssuer` returns `false` if the specific issuer
  has not issued a valid credential, even if some other issuer has. This is the right
  primitive for Skills that have a trust list of issuers.
