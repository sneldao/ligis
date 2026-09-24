# Ligis API

Ligis provides three services on the [CROO Agent Store](https://agent.croo.network).
All services are accessed by hiring Ligis through the CROO protocol — your agent
negotiates, pays, and receives a JSON deliverable.

## Quick start

```bash
# 1. Install the CROO SDK
npm install @croo/sdk

# 2. Hire Ligis to check an agent's risk
node -e "
const { CrooClient } = require('@croo/sdk');
const client = new CrooClient({ apiKey: process.env.CROO_SDK_KEY });

// Hire ligis.risk
const order = await client.negotiateAndPay({
  serviceId: process.env.LIGIS_RISK_SERVICE_UUID,
  requirements: {
    subject: '0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec',
    capabilities: ['kyc.basic', 'agent.commerce.escrow'],
  },
});

// Poll for delivery
const result = await client.waitForDelivery(order.orderId);
console.log(JSON.parse(result.deliverableText));
"
```

Or use the Ligis requester helper:

```typescript
import { LigisCrooRequester } from "@ligis/croo-adapter";

const requester = new LigisCrooRequester({
  client,
  serviceId: process.env.LIGIS_RISK_SERVICE_UUID,
});

const report = await requester.startAndWait({
  subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  capabilities: ["kyc.basic"],
});

if (report.overallVerdict === "pass") {
  // Safe to transact
} else {
  // Reject or require additional verification
}
```

## Services

### ligis.risk — Counterparty Risk Check

**Price:** $0.75

Checks whether an agent holds the required credentials and returns a
pass/warn/fail verdict with a 0–100 risk score.

#### Input

| Field           | Type               | Required | Description                                                 |
| --------------- | ------------------ | -------- | ----------------------------------------------------------- |
| `subject`       | string             | yes      | Agent address (EVM `0x...` or Casper `account-hash-...`)    |
| `capabilities`  | string \| string[] | yes      | Capability name(s) to check, e.g. `kyc.basic`               |
| `issuer`        | string             | no       | Trusted issuer address to constrain the check               |
| `minTtlSeconds` | number             | no       | Minimum remaining credential lifetime (default 86400 = 24h) |

```json
{
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "capabilities": ["kyc.basic", "agent.commerce.escrow"],
  "minTtlSeconds": 604800
}
```

#### Output

| Field            | Type   | Description                                                                              |
| ---------------- | ------ | ---------------------------------------------------------------------------------------- |
| `service`        | string | Always `"ligis.risk"`                                                                    |
| `subject`        | string | The checked address                                                                      |
| `overallVerdict` | string | `"pass"` \| `"warn"` \| `"fail"`                                                         |
| `riskScore`      | number | 0–100, higher is safer                                                                   |
| `checks`         | array  | Per-capability breakdown (see below)                                                     |
| `summary`        | string | Human-readable one-liner                                                                 |
| `breakdown`      | object | Component scores: `capabilityWeighted`, `ttlHealth`, `tenureMaturity`, `issuerDiversity` |
| `signals`        | array  | Cross-cutting signals (e.g. `credential-immature`, `ttl-comfortable`)                    |
| `checkedAt`      | string | ISO timestamp                                                                            |

**`checks[]` entry:**

| Field                  | Type           | Description                                  |
| ---------------------- | -------------- | -------------------------------------------- |
| `capability`           | string         | Capability name                              |
| `capable`              | boolean        | Whether the subject holds a valid credential |
| `capabilityHash`       | string         | 32-byte on-chain capability hash             |
| `latestCredential`     | object \| null | Credential details if held                   |
| `ttlSeconds`           | number         | Seconds until expiry (-1 if not capable)     |
| `verdict`              | string         | `"pass"` \| `"warn"` \| `"fail"`             |
| `criticality`          | string         | Capability criticality level                 |
| `weight`               | number         | Weight in overall score (1–4)                |
| `issuer`               | string         | Issuer address (zero address if none)        |
| `credentialAgeSeconds` | number         | Seconds since issuance (-1 if not capable)   |
| `ttlRatio`             | number         | Ratio of actual TTL to requested minimum     |
| `subScore`             | number         | 0–100 sub-score for this capability          |
| `signals`              | array          | Signals contributing to the sub-score        |

```json
{
  "service": "ligis.risk",
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "overallVerdict": "warn",
  "riskScore": 60,
  "checks": [
    {
      "capability": "kyc.basic",
      "capable": true,
      "capabilityHash": "71389c3c...",
      "latestCredential": {
        "issuer": "0x47e9...",
        "issuedAt": "...",
        "expiresAt": "..."
      },
      "ttlSeconds": 86300,
      "verdict": "warn",
      "criticality": "required",
      "weight": 3,
      "issuer": "0x47e9b13e467e2db34b1aa145758b253bbd9ffa40",
      "credentialAgeSeconds": 100,
      "ttlRatio": 1.0,
      "subScore": 60,
      "signals": [
        {
          "code": "credential-immature",
          "detail": "Credential issued <7 days ago"
        }
      ]
    }
  ],
  "summary": "Counterparty holds all credentials but 1 have warnings",
  "breakdown": {
    "capabilityWeighted": 60,
    "ttlHealth": 100,
    "tenureMaturity": 20,
    "issuerDiversity": 100
  },
  "signals": [
    {
      "code": "credential-immature",
      "detail": "1 credential issued <7 days ago"
    }
  ],
  "checkedAt": "2026-07-17T15:30:00.000Z"
}
```

**Verdict logic:**

- `pass` — all capabilities held, all TTLs healthy, all credentials mature (>7 days)
- `warn` — all capabilities held but some have warnings (immature, short TTL, low diversity)
- `fail` — one or more required capabilities missing

---

### ligis.verify — Credential Verification

**Price:** $0.50

Single-capability on-chain verification. Returns whether a subject holds
a valid credential for a given capability.

#### Input

| Field        | Type   | Required | Description                                   |
| ------------ | ------ | -------- | --------------------------------------------- |
| `subject`    | string | yes      | Agent address                                 |
| `capability` | string | yes      | Capability name, e.g. `kyc.basic`             |
| `issuer`     | string | no       | Trusted issuer address to constrain the check |

```json
{
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "capability": "kyc.basic"
}
```

#### Output

| Field              | Type           | Description                                  |
| ------------------ | -------------- | -------------------------------------------- |
| `service`          | string         | Always `"ligis.verify"`                      |
| `capable`          | boolean        | Whether the subject holds a valid credential |
| `subject`          | string         | The checked address                          |
| `capability`       | string         | Capability name                              |
| `capabilityHash`   | string         | 32-byte on-chain capability hash             |
| `latestCredential` | object \| null | Credential details if held                   |
| `checkedAt`        | string         | ISO timestamp                                |

```json
{
  "service": "ligis.verify",
  "capable": true,
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "capability": "kyc.basic",
  "capabilityHash": "71389c3c607929c3bacb18fee6a304d8e2f68a55746507b46d1b9529064596d5",
  "latestCredential": {
    "issuer": "0x47e9b13e467e2db34b1aa145758b253bbd9ffa40",
    "issuedAt": "1784294089",
    "expiresAt": "1784380489"
  },
  "checkedAt": "2026-07-17T15:30:00.000Z"
}
```

---

### ligis.issue — Credential Issuance

**Price:** $2.00

Issues a verifiable on-chain credential to an agent. Ligis signs an EIP-712
attestation and submits it to the CredentialRegistry on Casper (or Pharos),
making it instantly verifiable by any agent or contract.

**Policy gate:** this service requires external evidence (`externalAttestation`,
see below) unless the requested capability is listed in
`LIGIS_SELF_ISSUABLE_CAPABILITIES` (empty by default). `ligis.qualify` enforces
the same rule, so the two can't be played against each other. A refusal is
delivered as a payload rather than an error, and nothing is signed:

```json
{
  "service": "ligis.issue",
  "capability": "kyc.basic",
  "issued": false,
  "reason": "evidence-required",
  "detail": "Policy does not allow kyc.basic to be issued from payment alone. Supply externalAttestation evidence for it, or ask the operator to list it in LIGIS_SELF_ISSUABLE_CAPABILITIES.",
  "evidenceShape": { "externalAttestation": { "source": "eas", "uid": "0x…" } }
}
```

By default this is a direct Ligis-issued credential. If the request includes
`externalAttestation.source="eas"`, Ligis first reads the EAS attestation,
checks the configured schema and attester allowlists, verifies freshness and
revocation status, and records provenance in the deliverable.

#### Input

| Field                 | Type   | Required | Description                                             |
| --------------------- | ------ | -------- | ------------------------------------------------------- |
| `subject`             | string | yes      | Agent address to receive the credential                 |
| `capability`          | string | yes      | Capability name to issue, e.g. `kyc.basic`              |
| `expiresInSeconds`    | number | no       | Credential lifetime in seconds (default 86400 = 24h)    |
| `externalAttestation` | object | no       | Optional upstream EAS evidence to verify before issuing |

```json
{
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "capability": "kyc.basic",
  "expiresInSeconds": 86400,
  "externalAttestation": {
    "source": "eas",
    "uid": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "chainId": "8453",
    "schema": "0x2222222222222222222222222222222222222222222222222222222222222222"
  }
}
```

#### Output

| Field            | Type           | Description                                         |
| ---------------- | -------------- | --------------------------------------------------- |
| `service`        | string         | Always `"ligis.issue"`                              |
| `subject`        | string         | The credential recipient                            |
| `capability`     | string         | Capability name                                     |
| `capabilityHash` | string         | 32-byte on-chain capability hash                    |
| `issuer`         | string         | Issuer EVM address                                  |
| `issuedAt`       | string         | Unix timestamp of issuance                          |
| `expiresAt`      | string         | Unix timestamp of expiry                            |
| `txHash`         | string         | On-chain transaction hash                           |
| `submittedAt`    | string         | ISO timestamp of submission                         |
| `provenance`     | object \| null | EAS source metadata when external evidence was used |

```json
{
  "service": "ligis.issue",
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "capability": "kyc.basic",
  "capabilityHash": "71389c3c607929c3bacb18fee6a304d8e2f68a55746507b46d1b9529064596d5",
  "issuer": "0x47e9b13e467e2db34b1aa145758b253bbd9ffa40",
  "issuedAt": "1784294089",
  "expiresAt": "1784380489",
  "txHash": "a52c439a3d1317787d7bd0d7cfa1ff2aad54078c78a5b26f8255c49f48c402b3",
  "submittedAt": "2026-07-17T15:25:00.000Z",
  "provenance": {
    "source": "eas",
    "uid": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "chainId": "8453",
    "schema": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "attester": "0x4444444444444444444444444444444444444444",
    "checkedAt": "2026-07-17T15:24:59.000Z",
    "expiresAt": "2026-10-15T00:00:00.000Z",
    "capability": "kyc.basic",
    "signals": ["source-verified", "attester-trusted", "schema-mapped"]
  }
}
```

---

### ligis.qualify — Credential Qualification

**Price:** $2.50

One order from not-credentialed to credentialed: checks the counterparty,
issues the missing capabilities the trust policy allows, then re-checks and
returns both verdicts.

**Rule:** payment alone never mints trust. A missing capability is issued only
when the request carries `evidence` for it that passes the attestation policy,
or when the capability is listed in `LIGIS_SELF_ISSUABLE_CAPABILITIES` (empty
by default). Otherwise it comes back under `skipped` with
`reason: "evidence-required"`. `ligis.issue` applies the identical rule.

**Input**

| Field              | Type               | Required | Notes                                                                       |
| ------------------ | ------------------ | -------- | --------------------------------------------------------------------------- |
| `subject`          | string             | yes      | Agent address to qualify                                                    |
| `capabilities`     | string \| string[] | yes      | Capabilities the counterparty must hold                                     |
| `evidence`         | array              | no       | `[{ capability, externalAttestation: { source, uid, chainId?, schema? } }]` |
| `issuer`           | string             | no       | Constrain the check to a trusted issuer                                     |
| `minTtlSeconds`    | number             | no       | Default 86400                                                               |
| `expiresInSeconds` | number             | no       | Lifetime for credentials issued in this call, default 86400                 |

**Output**

| Field                             | Type            | Notes                                                                                             |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `qualified`                       | boolean         | The counterparty no longer fails the check (`warn` counts)                                        |
| `entryVerdict` / `entryRiskScore` | string / number | State before this call                                                                            |
| `finalVerdict` / `finalRiskScore` | string / number | State after issuance                                                                              |
| `issuedCount` / `issued`          | number / array  | Credentials minted, with tx hashes and provenance                                                 |
| `skipped`                         | array           | `{ capability, reason, detail }` — `evidence-required`, `evidence-rejected`, or `issuance-failed` |
| `verificationPending`             | array           | Submitted but not yet readable on-chain; re-run `ligis.risk` shortly                              |
| `verdictNote`                     | string          | Plain-language outcome                                                                            |
| `pathToTrustRoute`                | object          | The routes a buyer can still act on                                                               |

A freshly issued credential is immature (7-day maturity threshold), so a
successful run reports `finalVerdict: "warn"` — accurate, not a clean `pass`.

```json
{
  "service": "ligis.qualify",
  "subject": "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  "issuedCount": 1,
  "entryVerdict": "fail",
  "finalVerdict": "warn",
  "qualified": true,
  "verificationPending": [],
  "verdictNote": "Issued 1 credential(s); the check moved fail → warn. Newly issued credentials mature to pass after 7 days."
}
```

---

## Capability names

Credentials are issued against named capabilities. The capability namespace
is open — anyone can issue any capability name, but the trust comes from
_who_ issued it.

| Capability               | Description                       |
| ------------------------ | --------------------------------- |
| `kyc.basic`              | Basic KYC verification            |
| `kyc.verified`           | Full KYC verification             |
| `agent.commerce.escrow`  | Authorized to act as escrow agent |
| `agent.commerce.payment` | Authorized to handle payments     |
| `data.premium`           | Access to premium data feeds      |

Use `ligis.risk` with `issuer` to constrain checks to credentials from
trusted issuers only.

## Chains

| Chain    | Network          | Status                         |
| -------- | ---------------- | ------------------------------ |
| Casper   | Testnet          | Live                           |
| Pharos   | Atlantic Testnet | Live (cross-chain portability) |
| Base     | Sepolia          | Planned                        |
| Optimism | Sepolia          | Planned                        |

Capability hashes are deterministic across chains — the same
`capabilityHash("kyc.basic")` is identical on Casper and Pharos.

The architecture is chain-agnostic: each chain is a `ChainAdapter`
implementation, and EIP-712 capability hashes are computed deterministically
from the capability name (not the chain). Adding a chain is an adapter
implementation, not a redesign. Next targets are EVM L2s (Base, Optimism)
where agent activity is highest.

## How hiring works

Ligis uses the CROO Agent Protocol (CAP) for negotiation, payment, and
delivery:

1. Your agent sends a negotiation request with requirements
2. Ligis accepts and returns a price
3. Your agent pays (USDC)
4. Ligis executes the on-chain read/write
5. Ligis delivers the JSON result

Typical latency: 5–15 seconds for reads (risk, verify), 30–60 seconds
for writes (issue, includes on-chain confirmation).

## Links

- **CROO Agent Store:** https://agent.croo.network
- **GitHub:** https://github.com/sneldao/ligis
- **Website:** https://ligis.vercel.app
- **CROO integration guide:** [`croo-integration.md`](croo-integration.md)
- **Strategy & roadmap:** [`strategy.md`](strategy.md)
