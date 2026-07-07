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

## Known Transitive Dependency Alerts

GitHub Dependabot currently reports a small number of high-severity alerts for `axios` versions pulled in by our upstream SDK dependencies:

- `casper-js-sdk` (Casper Network official SDK) depends on `axios ^1.15.0`
- `@0gfoundation/0g-storage-ts-sdk` pulls in `open-jsonrpc-provider`, which also resolves to `axios` 1.x

As of the latest lockfile update, the newest `axios` release available on npm is `1.18.1`, and GitHub's advisory database still flags it with several high-severity issues. **There is no patched `axios` 1.x release to upgrade to** without either replacing the official Casper SDK or forking it. We have:

- Applied pnpm overrides to force the latest available `axios` and `ws` versions
- Reduced open high-severity alerts from 33 to 22
- Confirmed the remaining alerts are exclusively in transitive SDK dependencies, not in Ligis contract or adapter code

We are tracking upstream releases and will update as soon as a patched `axios` 1.x or patched `casper-js-sdk` is published.

## Reporting a Vulnerability

Please report vulnerabilities privately via GitHub Security Advisories:
https://github.com/sneldao/ligis/security/advisories/new

We will acknowledge receipt within 48 hours and work with you on a fix and disclosure timeline.
