# Agentic KY-A Protocol: Portable Agent Identity & Credential Verification for Regulators

**Track:** Know Your Agent (KY-A), Digital Verification & Digital Public Infrastructure

**Team:** [Team Name]
**Contact:** [Email]

---

## Problem

AI agents now execute financial transactions, manage portfolios, negotiate contracts, and interact with consumers — all at machine speed. Yet regulators have no standardized way to answer four basic questions:

1. **Who is this agent?** — No portable, verifiable agent identity exists across chains and jurisdictions.
2. **What is this agent authorized to do?** — No standardized credential model for agent capabilities (KYC, accredited investor, trading权限, escrow).
3. **Can I verify this independently?** — Credentials are siloed per platform, per chain, per jurisdiction.
4. **Who is accountable?** — When an agent acts, there is no tamper-evident audit trail linking the action back to a verified identity and its human principal.

The result: regulators are blind to agentic activity. The "trust fracture" between what agents can do and what authorities can oversee grows wider every day.

## Solution: Agentic KY-A Protocol

We propose a **decentralized, chain-agnostic Know Your Agent (KY-A) protocol** that gives every agent a portable, verifiable identity and capability credential — and gives regulators the tools to verify, monitor, and audit agent activity across any chain.

The protocol has four layers:

```
                    ┌─────────────────────────────────────┐
                    │       REGULATOR DASHBOARD           │
                    │  Verify · Monitor · Alert · Audit   │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │       KY-A VERIFICATION API          │
                    │  "is this agent capable of X?"       │
                    └──────────────────┬──────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
┌────────▼────────┐          ┌─────────▼─────────┐       ┌─────────▼─────────┐
│   EVM Chain     │          │   Casper Chain     │       │   Future Chains   │
│ (Pharos/Ethereum)│          │   (WASM/Odra)      │       │   (Adapter API)   │
│                  │          │                    │       │                   │
│  AgentID.sol     │          │  AgentId (Odra)    │       │   ChainAdapter    │
│  CredRegistry    │          │  CredRegistry      │       │   Implementation  │
│  .sol            │          │  (Rust/Odra)       │       │                   │
└──────────────────┘          └────────────────────┘       └──────────────────┘
         │                             │                             │
         └─────────────────────────────┼─────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │     AGENT TRUST STEWARD              │
                    │  BOOT → REASON → GATE → ACT → RECORD │
                    │  (Autonomous identity lifecycle)     │
                    └─────────────────────────────────────┘
```

### Layer 1: Portable Agent Identity

Every agent receives a **soulbound, non-transferable on-chain identity** — an AgentID NFT (ERC-721 / Odra equivalent) that:

- Is bound to the agent's keypair and survives key rotation
- Is **chain-agnostic**: issued on Pharos, verifiable on Casper, via a standardized `did:ligis:<chain>:<id>` format
- Proves **persistent existence** — an agent cannot discard and re-emerge under a new identity without leaving an on-chain trail

The identity lifecycle is fully autonomous: the agent's Trust Steward mints its own ID on boot, rotates keys if compromised, and self-revokes if decommissioned.

### Layer 2: Verifiable Capability Credentials

Agents hold **EIP-712 signed attestations** that prove capabilities — not identity documents, but machine-verifiable claims:

| Capability | Meaning | Regulatory Relevance |
|---|---|---|
| `kyc.basic` | Human principal KYC'd | Consumer protection |
| `trade.cex-retail` | Authorized for retail trading | Market integrity |
| `agent.commerce.escrow` | Can hold escrow | Payment oversight |
| `agent.commerce.x402` | Can execute pay-per-call | Payment oversight |
| `rwa.accredited` | Verified accredited investor | Securities regulation |
| `compliance.aml` | AML screening passed | Financial crime |
| `data.premium` | Access to premium data | Data governance |

Credentials are:
- **Self-issued** (agent proves its own capability by signing off-chain and recording on-chain)
- **Third-party attested** (a regulator or authorized issuer signs for the agent)
- **Revocable** by the issuer at any time
- **Cross-chain portable** (EIP-712 domain separation per chain prevents replay, same hash = same capability)

### Layer 3: Autonomous Trust Steward

Every agent runs a **Trust Steward** — a lightweight autonomous loop that manages its identity lifecycle without human intervention:

```
BOOT → REASON → GATE → ACT → RECORD
 │        │        │      │       │
 │        │        │      │       └─ Anchor evidence onchain
 │        │        │      └───────── Self-issue missing credentials
 │        │        └─────────────── Verify required capabilities
 │        └────────────────────── Map goal → required capabilities
 └───────────────────────────── Mint AgentID if none exists
```

For regulators, this means every agent has a **self-maintained, auditable identity trail** — no manual registration, no expiring certificates, no orphaned identities.

### Layer 4: Regulator Verification Dashboard

A web-based dashboard that gives regulators:

- **Agent lookup**: Query `did:ligis:*` to see identity, capabilities, issuance history, revocation status
- **Credential verification**: Verify any EIP-712 capability attestation independently — no trusted third party required
- **Cross-chain search**: Same agent's identity across EVM and Casper
- **Audit trail**: Every credential issuance, rotation, and revocation is on-chain and timestamped
- **Alert rules**: Notify when an agent's key rotates, a capability is revoked, or a new agent appears with suspicious capability combinations

## Track Fit: KY-A & Digital Public Infrastructure

This directly addresses **Track 4: Know Your Agent (KY-A), Digital Verification & Digital Public Infrastructure**:

| Requirement | Our Solution |
|---|---|
| Authenticate & verify AI agents | `AgentID` (soulbound NFT) + `CredentialRegistry` (EIP-712 attestations) |
| Detect autonomous exploitation of DPI layers | Credential gating on digital ID/data sharing — `isCapable()` check before access |
| Agentic solutions for accountability | Tamper-evident on-chain audit trail linking actions to verified identity |
| Cross-jurisdiction portability | Chain-agnostic adapters (EVM + Casper live, more via `ChainAdapter` interface) |

It also contributes to **Track 3: Agentic Payments & Commerce** via the x402 payment gating, and **Track 5: DeFi Market Infrastructure** via the existing credential composability with smart contracts.

## Guardrails

| Required Guardrail | How We Address It |
|---|---|
| **Human-in-the-loop** | Regulator dashboard requires human confirmation for: critical alerts, bulk revocation, investigation holds. Agent can self-issue low-risk credentials but high-risk capabilities (escrow, accredited investor) require third-party issuer signature |
| **Auditability & Traceability** | Every identity action is on-chain: mint, rotate, revoke, credential issue, credential revoke. Evidence manifests anchored to 0G Storage with on-chain Merkle root. Verifiable independently without our infrastructure |
| **Safety & governance controls** | Capability-based access control — fine-grained, revocable, time-bound. Credential registry supports programmable gating (e.g., require 2-of-3 multi-sig for escrow credentials) |
| **Cyber risk** | Key rotation preserves identity across compromised keys. Revocation is instant and on-chain. Soulbound design prevents identity theft (token cannot be transferred to attacker). EIP-712 domain binding prevents cross-chain credential replay |

## Scalability & Transferability

- **Cross-regulatory domain**: KY-A credentials work for financial regulators (KYC, accredited investor), data authorities (data access permissions), communications regulators (agent identity on communication networks)
- **Cross-jurisdiction**: Same protocol, different credential issuers per jurisdiction. A UK FCA credential and an MAS credential use the same on-chain format — regulators verify each other's credentials
- **Technology transfer**: Already live on Pharos (EVM) and Casper (WASM). The `ChainAdapter` interface makes adding new chains (Ethereum, Solana, Base) a matter of implementing ~10 methods
- **Open protocol**: Proposed as open standard for agent identity — not a vendor lock-in

## Technical Maturity

- **Live on 2 chains**: Pharos Atlantic testnet (EVM) and Casper Testnet (WASM/Odra)
- **Live agent**: Trust Steward running autonomously — mints ID, reasons with LLM (0G Compute TEE), self-issues credentials, anchors evidence to 0G Storage
- **Live marketplace**: 3 paid services on CROO Agent Store (`ligis.risk`, `ligis.verify`, `ligis.issue`)
- **Live CLI**: `ligis` binary with issue, verify, revoke, rotate, agent run commands
- **Live API**: MCP server + x402 payment-gated HTTP API
- **Auditable**: Open-source, Foundry/Terraform deployment, reproducible builds

## Summary

Agentic AI is already transacting across financial systems. Regulators cannot afford to be blind to who these agents are and what they are authorized to do. **The Agentic KY-A Protocol** gives every AI agent a portable, verifiable, chain-agnostic identity — and gives regulators the tools to verify, monitor, and audit agentic activity across the entire digital economy.

Not a monitoring tool bolted onto existing infrastructure. An identity layer built into how agents operate — so regulation scales at the speed of AI.
