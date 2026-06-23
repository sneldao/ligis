# `ligis-sign` — Build and Sign an EIP-712 Credential Attestation

The credential is an EIP-712 typed-data signature. This reference shows how to build
the digest and sign it with the issuer's key. Use it for issuers (KYC providers, DAOs,
marketplace operators) that want to issue credentials from their own backends.

## Step 0 — Load the registry address

```bash
CREG=$(jq -r '.deployment.atlantic-testnet.credentialRegistry' assets/deployment.json)
RPC=$(jq -r '.networks.atlantic-testnet.rpcUrl' assets/networks.json)
```

## Step 1 — Compute the digest

The EIP-712 digest is:
```
keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash))
```

Where:
- `DOMAIN_SEPARATOR` is computed by the contract from `(name, version, chainId, verifyingContract)`.
- `structHash = keccak256(abi.encode(TYPEHASH, issuer, subject, capabilityHash, issuedAt, expiresAt, nonce))`.
- `TYPEHASH = keccak256("Credential(address issuer,address subject,bytes32 capabilityHash,uint256 issuedAt,uint256 expiresAt,uint256 nonce)")`.

You can either compute this off-chain in TypeScript / Python / Solidity, or call the
contract's `hashTypedData` view to verify:

```bash
ISSUER=0x...
SUBJECT=0x...
CAP_HASH=$(cast keccak "agent.commerce.escrow")
ISSUED_AT=1750000000
EXPIRES_AT=1752592000
NONCE=$(cast call $CREG "issuerNonce(address)(uint256)" $ISSUER --rpc-url $RPC)

cast call $CREG "hashTypedData(address,address,bytes32,uint256,uint256,uint256)(bytes32)" \
  $ISSUER $SUBJECT $CAP_HASH $ISSUED_AT $EXPIRES_AT $NONCE --rpc-url $RPC
```

## Step 2 — Sign with the issuer's key

```bash
ISSUER_KEY=0x...    # issuer's private key
DIGEST=0x...        # from Step 1

cast wallet sign --private-key $ISSUER_KEY --no-hash $DIGEST
# Outputs the signature in `r|s|v` form
```

`--no-hash` is critical — the digest is already hashed, you do not want to hash it again
(EIP-712 already produces the final 32-byte digest).

## Step 3 — Submit the signed attestation

Anyone (a relayer, the issuer, anyone) can submit the signed attestation. The contract
verifies the signature recovers to `issuer`, increments `issuerNonce[issuer]`, and
stores the credential.

```bash
SIG="0x...r...s...v"  # from Step 2

cast send $CREG "issue(address,address,bytes32,uint64,uint64,uint256,bytes)(uint256)" \
  $ISSUER $SUBJECT $CAP_HASH $ISSUED_AT $EXPIRES_AT $NONCE $SIG \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

The function returns the used nonce (which equals `$NONCE` from above).

## Off-chain reference implementations

### TypeScript (viem)

```typescript
import { hashTypedData, signTypedData } from "viem";

const CREDENTIAL_TYPEHASH = {
  Credential: [
    { name: "issuer", type: "address" },
    { name: "subject", type: "address" },
    { name: "capabilityHash", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const domain = {
  name: "PharosAgentCredential",
  version: "1",
  chainId: 688689,
  verifyingContract: "0x...", // CredentialRegistry
} as const;

const message = {
  issuer: "0x...",
  subject: "0x...",
  capabilityHash: "0x...", // keccak256("agent.commerce.escrow")
  issuedAt: 1750000000n,
  expiresAt: 1752592000n,
  nonce: 0n,
};

const signature = await signTypedData({
  domain,
  types: CREDENTIAL_TYPEHASH,
  primaryType: "Credential",
  message,
  privateKey: "0x...",
});
```

### Solidity (issuer is a contract)

If the issuer is itself a smart contract (e.g., a DAO that votes on whether to
credential a user), use the contract's `hashTypedData` view + `ecrecover` to verify
in the issuer contract, then have the issuer contract call `CredentialRegistry.issue(...)`.

```solidity
function issueTo(address subject, bytes32 capHash) external onlyGovernor {
    uint256 nonce = registry.issuerNonce(address(this));
    uint64 issuedAt = uint64(block.timestamp);
    uint64 expiresAt = issuedAt + 30 days;

    bytes32 digest = registry.hashTypedData(address(this), subject, capHash, issuedAt, expiresAt, nonce);
    bytes memory sig = ...; // governor signs the digest off-chain and submits

    registry.issue(address(this), subject, capHash, issuedAt, expiresAt, nonce, sig);
}
```

## Production hardening checklist

- [ ] Issuer's key stored in a Hardware Security Module (HSM) or a multi-sig Safe, not a
      plain env var
- [ ] Replay protection: nonce is read from chain at submission time, never trusted from
      the client
- [ ] Domain separator: the `verifyingContract` is the actual deployed `CredentialRegistry`
      on the target chain; the `chainId` matches
- [ ] Expiry: never issue with `expiresAt` further out than the issuer's own key rotation
      policy (e.g., a KYC provider with annual re-verification should issue credentials
      for 6 months, not 5 years)
- [ ] Logging: every issuance is logged with `(issuer, subject, capability, issuedAt,
      expiresAt, nonce)` for audit
- [ ] Rate limits: per-issuer and per-subject caps prevent credential flooding
- [ ] Revocation hook: the issuer's API should expose a "revoke" endpoint that calls
      `CredentialRegistry.revoke(...)` (this Skill provides it; see `references/revoke.md`)
