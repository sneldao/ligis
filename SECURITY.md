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

## Dependency Audit Policy

Run dependency audits from the repository root:

```bash
pnpm run audit:deps
```

This fails on moderate, high, and critical npm advisories. The current pnpm
lockfile reports no moderate-or-higher npm vulnerabilities.

For a full npm audit, including low-severity advisories:

```bash
pnpm run audit:deps:all
```

The full audit ignores only `CVE-2025-14505` / `GHSA-848j-6mx2-7j84`, a
low-severity `elliptic <= 6.6.1` advisory with no patched npm release. Ligis
does not depend on `elliptic` directly; it is pulled transitively through
`@0gfoundation/0g-compute-ts-sdk -> circomlibjs -> ethers@5` and
`@0gfoundation/0g-compute-ts-sdk -> crypto-browserify`. The latest available
0G compute SDK still contains this dependency path, so this exception should be
removed as soon as upstream ships a version that no longer resolves to the
vulnerable package. The exception is recorded in `pnpm-workspace.yaml` under
`auditConfig.ignoreCves`.

The workspace also uses pnpm overrides in `pnpm-workspace.yaml` to force patched
transitive versions for known vulnerable `axios`, `postcss`, and `ws` ranges.
Do not remove those overrides unless `pnpm audit` remains clean without them.

## Reporting a Vulnerability

Please report vulnerabilities privately via GitHub Security Advisories:
https://github.com/sneldao/ligis/security/advisories/new

We will acknowledge receipt within 48 hours and work with you on a fix and disclosure timeline.
