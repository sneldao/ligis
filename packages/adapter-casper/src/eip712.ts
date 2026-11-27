/**
 * EIP-712 typed-data construction for Casper credentials.
 *
 * Casper's x402 ecosystem uses EIP-712 with Casper-specific domain fields
 * (`chain_name`, `contract_package_hash`) instead of the EVM defaults
 * (`chainId`, `verifyingContract`). The `@casper-ecosystem/casper-eip-712`
 * package handles both layouts.
 *
 * Cross-chain invariant: the `Credential` typed-data layout below is the
 * SAME as the EVM-side `CredentialRegistry.sol` EIP-712 schema. The only
 * thing that changes across chains is the domain separator (the verifying
 * contract identifier). This is what makes a credential signed by an issuer
 * with a secp256k1 key portable between Pharos and Casper.
 *
 * Limitation: this path supports **secp256k1** signers only (the same curve
 * used by Casper's x402 facilitator). Ed25519-only Casper accounts can boot
 * an AgentId here, but cannot issue credentials. This is consistent with the
 * x402 mainnet implementation.
 */
import {
  CASPER_DOMAIN_TYPES,
  hashDomainSeparator,
  hashTypedData,
  keccak256,
  recoverTypedDataSigner,
  toHex,
  verifySignature,
} from "@casper-ecosystem/casper-eip-712";
import type { CasperConfig } from "./config.js";

/** The on-wire credential payload that gets signed and submitted on-chain.
 * v2: `claim` is the canonical claim string (docs/credential-registry-v2.md);
 * the contract derives `claim_hash` on-chain and recomputes this digest, so
 * the signature provably binds the stored fields. */
export interface CredentialMessage extends Record<string, unknown> {
  issuer: string; // 0x-prefixed 20-byte secp256k1 Ethereum-style address
  subject: string; // chain-formatted subject identifier (account hash on Casper)
  claim: string; // canonical claim string, e.g. "rwa.accredited:jurisdiction=us"
  issuedAt: string; // decimal string (uint64)
  expiresAt: string; // decimal string (uint64)
  nonce: string; // decimal string (uint256)
}

/** EIP-712 type definitions for the `Credential` primary type (v2). */
const CREDENTIAL_TYPES = {
  Credential: [
    { name: "issuer", type: "address" },
    { name: "subject", type: "bytes32" },
    { name: "claim", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

/**
 * Kept for reference: revocation on v2 uses a raw-keccak packed digest
 * (see buildRevokeDigest), not typed-data. The Revocation EIP-712 type is
 * retained so external verifiers can reason about the legacy v1 format.
 */
const _REVOCATION_TYPES = {
  Revocation: [
    { name: "subject", type: "bytes32" },
    { name: "capabilityHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

/**
 * Strip hash prefix (contract-package-, hash-, 0x) from a hash string.
 */
function stripPrefix(hash: string): string {
  return hash
    .replace(/^contract-package-/, "")
    .replace(/^hash-/, "")
    .replace(/^0x/, "");
}

/** Convert the loaded config to a Casper-native EIP-712 domain. */
function buildDomain(config: CasperConfig): Record<string, string> {
  const registry = config.deployment.credentialRegistry;
  if (!registry) {
    throw new Error(
      "Casper credential registry not configured. " +
        "Deploy packages/contracts-casper and set LIGIS_CASPER_CREDENTIAL_REGISTRY.",
    );
  }
  return {
    name: "Ligis CredentialRegistry",
    version: "2",
    chain_name: `casper:${config.network.chainName}`,
    contract_package_hash: `0x${stripPrefix(registry)}`,
  };
}

/** The on-wire revocation payload that gets signed and submitted on-chain. */
export interface RevocationMessage extends Record<string, unknown> {
  subject: string; // chain-formatted subject identifier (account hash on Casper)
  capabilityHash: string; // 0x-prefixed 32-byte keccak256 hash
  nonce: string; // decimal string (uint256)
}

/** Compute the EIP-712 typed-data digest for a credential. */
export function buildCredentialDigest(
  config: CasperConfig,
  message: CredentialMessage,
): `0x${string}` {
  const domain = buildDomain(config);
  const digest = hashTypedData(
    domain,
    CREDENTIAL_TYPES,
    "Credential",
    message,
    {
      domainTypes: CASPER_DOMAIN_TYPES,
    },
  );
  return ("0x" + Buffer.from(digest).toString("hex")) as `0x${string}`;
}

/**
 * Compute the revocation digest the v2 contract binds to:
 *   keccak256(subject(32B) || claim_hash(32B) || nonce(u64 BE, 8B))
 * This is a raw-keccak packed digest — NOT an EIP-712 typed-data hash.
 * `keccak_revoke_digest` in the contract re-derives this exact value, so
 * producing anything else makes every revoke revert.
 */
export function buildRevokeDigest(
  _config: CasperConfig,
  message: RevocationMessage,
): `0x${string}` {
  const subject = Buffer.from(
    message.subject
      .replace(/^account-hash-/, "")
      .replace(/^0x/, "")
      .padStart(64, "0"),
    "hex",
  );
  const claimHash = Buffer.from(
    message.capabilityHash.replace(/^0x/, ""),
    "hex",
  );
  const buf = Buffer.alloc(72);
  subject.copy(buf, 0);
  claimHash.copy(buf, 32);
  buf.writeBigUInt64BE(BigInt(message.nonce), 64);
  return ("0x" + Buffer.from(keccak256(buf)).toString("hex")) as `0x${string}`;
}

/** Recover the issuer address from a signed credential (secp256k1). */
export function recoverCredentialIssuer(
  config: CasperConfig,
  message: CredentialMessage,
  signature: Uint8Array,
): string {
  const domain = buildDomain(config);
  const addrBytes = recoverTypedDataSigner(
    domain,
    CREDENTIAL_TYPES,
    "Credential",
    message,
    signature,
    {
      domainTypes: CASPER_DOMAIN_TYPES,
    },
  );
  return toHex(addrBytes);
}

/** Verify a credential signature matches the expected issuer. */
export function verifyCredentialSignature(
  config: CasperConfig,
  message: CredentialMessage,
  signature: Uint8Array,
  expectedIssuer: string,
): boolean {
  const domain = buildDomain(config);
  const digest = hashTypedData(
    domain,
    CREDENTIAL_TYPES,
    "Credential",
    message,
    {
      domainTypes: CASPER_DOMAIN_TYPES,
    },
  );
  return verifySignature(digest, signature, expectedIssuer);
}

/**
 * The EIP-712 domain separator for this deployment — what the v2 contract
 * stores via `set_domain_separator` after deploy and mixes into every
 * issue digest it recomputes on-chain.
 */
export function buildDomainSeparator(config: CasperConfig): `0x${string}` {
  const domain = buildDomain(config) as Parameters<
    typeof hashDomainSeparator
  >[0];
  const sep = hashDomainSeparator(domain, CASPER_DOMAIN_TYPES);
  return ("0x" + Buffer.from(sep).toString("hex")) as `0x${string}`;
}

export { CREDENTIAL_TYPES };
