:warning: **Do not report security issues publicly.** Open a [private security advisory](https://github.com/sneldao/ligis/security/advisories/new) instead.

## Security Model

Ligis is designed to be non-custodial and permissionless:

- No admin, no owner, no upgrade keys, no backdoor
- Identity is soulbound and non-transferable
- Credentials are EIP-712 signed, revocable, expirable, and replay-resistant
- Key rotation is supported for recovery
- Both EVM/Solidity and Casper/Odra implementations enforce issuer-signature recovery on-chain

For a detailed security overview, see [docs/security.md](docs/security.md).

## Supported Versions

| Version | Supported |
|--------|-----------|
| main   | yes       |

## Reporting a Vulnerability

Please report vulnerabilities privately via GitHub Security Advisories:
https://github.com/sneldao/ligis/security/advisories/new

We will acknowledge receipt within 48 hours and work with you on a fix and disclosure timeline.
