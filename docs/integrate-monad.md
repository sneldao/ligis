# Gate a payment in 10 minutes — Ligis on Monad

Ligis is a trust gate for autonomous payments: one on-chain read that returns
GO or STOP before your agent pays a stranger. This is the whole integration.

## The one-liner (Solidity)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILigisRegistry {
    function isCapable(address subject, bytes32 capabilityHash) external view returns (bool);
}

contract GatedPayout {
    ILigisRegistry constant LIGIS =
        ILigisRegistry(0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a); // Monad testnet

    function pay(address agent) external {
        require(
            LIGIS.isCapable(agent, keccak256("agent.commerce.escrow")),
            "gate: STOP"
        );
        // … transfer / escrow / call the counterparty …
    }
}
```

`isCapable` is a `view` — it costs nothing to call and reverts nothing on its
own. `true` means a credential for that capability exists, is issued by a
registered issuer, is unrevoked, and is unexpired. `false` — STOP.

## The 5-liner (TypeScript, viem)

```ts
import { createPublicClient, http, keccak256, toHex } from "viem";

const client = createPublicClient({
  transport: http("https://testnet-rpc.monad.xyz"),
});
const capable = await client.readContract({
  address: "0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a",
  abi: ["function isCapable(address,bytes32) view returns (bool)"],
  functionName: "isCapable",
  args: [agent, keccak256(toHex("kyc.basic"))],
}); // true → GO · false → STOP
```

That's the entire client. No SDK, no API key — the registry contract is the
API. Chain is Monad testnet (10143).

## Issuer-scoped reads

`isCapable` is multi-issuer: any trusted issuer's live credential opens the
gate. If you only accept credentials from a specific issuer (your KYC
provider, a DAO, Ligis's passkey issuer):

```solidity
LIGIS.isCapableFromIssuer(agent, capHash, issuer)
```

PasskeyIssuer (`0x6C500B3968C54789b518D01066Aed2990d44c068`) issues
credentials authorized by a real WebAuthn/passkey signature, verified on-chain
by Monad's P256 precompile at `0x0100` — no key material on any server.

## Issuing + revoking

Issuance is EIP-712-signed. The fastest way to feel it:
`https://ligis.vercel.app/vouch?chain=monad-testnet` — the issuer desk signs
an `issue` with the demo steward key, and a second click pulls it back via
`revoke`. Watch the gate flip on the next read.

For your own issuer key:

```bash
ligis issue --subject 0xAgent… --capability agent.commerce.escrow   # GO
ligis revoke --subject 0xAgent… --capability agent.commerce.escrow  # STOP
```

Or call `issue(issuer, subject, capabilityHash, issuedAt, expiresAt, nonce,
signature)` directly — the digest is `hashTypedData(...)` on the registry.
Revocation is `revoke(subject, capabilityHash, nonce)` by the original issuer
and takes effect inside one Monad block.

## Reputation (ERC-8004)

Ligis writes every gate verdict to the Monad ERC-8004 ReputationRegistry as
`ligis.gate` feedback (value 100 = GO, 0 = STOP). If your agent participates
in ERC-8004, gate decisions are already readable through the standard
`getSummary(agentId, clients, "", "")` — no new integration.

## Addresses (Monad testnet, chain 10143)

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| CredentialRegistry  | `0xf589013b0D41efBdb25b8BDF98c83d676B02aF5a` |
| AgentId (identity)  | `0x7371bf6c8cBedcbb6B3da78c1da080e408cA7987` |
| PasskeyIssuer       | `0x6C500B3968C54789b518D01066Aed2990d44c068` |
| ERC-8004 Identity   | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

All contracts are source-verified (Sourcify, exact match). Reference
capabilities: `kyc.basic`, `agent.commerce.escrow`, `data.premium`,
`demo.passkey` — or request your own via the steward / CROO
`ligis.qualify` service.

## See it working

- `https://ligis.vercel.app/gate?subject=0x…&capability=kyc.basic` — the live
  check, no chain param needed; the subject resolves across every live
  registry (`&chain=monad-testnet` scopes it)
- `https://ligis.vercel.app/vouch?chain=monad-testnet` — the issuer desk:
  vouch → GO, pull back → STOP
- `https://ligis.vercel.app/passkey` — enroll a passkey, mint, revoke
- `pnpm demo:monad-x402` — credential-gated x402 payment, mid-stream kill
