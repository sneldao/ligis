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
  hashTypedData,
  recoverTypedDataSigner,
  toHex,
  verifySignature,
} from "@casper-ecosystem/casper-eip-712";
import type { CasperConfig } from "./config.js";

/** The on-wire credential payload that gets signed and submitted on-chain. */
export interface CredentialMessage extends Record<string, unknown> {
  issuer: string;          // 0x-prefixed 20-byte secp256k1 Ethereum-style address
  subject: string;         // chain-formatted subject identifier (account hash on Casper)
  capabilityHash: string;  // 0x-prefixed 32-byte keccak256 hash
  issuedAt: string;        // decimal string (uint64)
  expiresAt: string;       // decimal string (uint64)
  nonce: string;           // decimal string (uint256)
}

/** EIP-712 type definitions for the `Credential` primary type. */
const CREDENTIAL_TYPES = {
  Credential: [
    { name: "issuer", type: "address" },
    { name: "subject", type: "bytes32" },
    { name: "capabilityHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

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
    version: "1",
    chain_name: `casper:${config.network.chainName}`,
    contract_package_hash: registry.startsWith("hash-")
      ? `0x${registry.slice("hash-".length)}`
      : registry,
  };
}

/** Compute the EIP-712 typed-data digest for a credential. */
export function buildCredentialDigest(
  config: CasperConfig,
  message: CredentialMessage,
): `0x${string}` {
  const domain = buildDomain(config);
  const digest = hashTypedData(domain, CREDENTIAL_TYPES, "Credential", message, {
    domainTypes: CASPER_DOMAIN_TYPES,
  });
  return ("0x" + Buffer.from(digest).toString("hex")) as `0x${string}`;
}

/** Recover the issuer address from a signed credential (secp256k1). */
export function recoverCredentialIssuer(
  config: CasperConfig,
  message: CredentialMessage,
  signature: Uint8Array,
): string {
  const domain = buildDomain(config);
  const addrBytes = recoverTypedDataSigner(domain, CREDENTIAL_TYPES, "Credential", message, signature, {
    domainTypes: CASPER_DOMAIN_TYPES,
  });
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
  const digest = hashTypedData(domain, CREDENTIAL_TYPES, "Credential", message, {
    domainTypes: CASPER_DOMAIN_TYPES,
  });
  return verifySignature(digest, signature, expectedIssuer);
}

export { CREDENTIAL_TYPES };
