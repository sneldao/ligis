/**
 * Browser-side EIP-712 typed-data signing for Casper credentials.
 *
 * Single-line philosophy: we use the SAME library
 * (`@casper-ecosystem/casper-eip-712`) as the server-side adapter, so
 * the digest produced in the browser is byte-identical to the digest
 * the on-chain `CredentialRegistry.issue` recovers when it calls back
 * into the same library on the server. No cryptographic drift.
 *
 * The library prefers to use Node's `crypto` module server-side; in the
 * browser it falls back to `@noble/hashes` (which `@noble/curves`
 * already pulls in), so the bundle works without polyfills.
 */
import {
  CASPER_DOMAIN_TYPES,
  hashTypedData,
  verifySignature,
} from "@casper-ecosystem/casper-eip-712";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { evmAddressFromSecpKey } from "./keypair";

const CREDENTIAL_TYPES = {
  Credential: [
    { name: "issuer", type: "address" },
    { name: "subject", type: "bytes32" },
    { name: "claim", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const REVOCATION_TYPES = {
  Revocation: [
    { name: "subject", type: "bytes32" },
    { name: "capabilityHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
void REVOCATION_TYPES; // legacy v1 reference; v2 revoke uses raw-keccak

export interface CasperEip712Domain {
  name: string;
  version: string;
  chain_name: string;
  contract_package_hash: string; // 0x-prefixed hex
}

export interface CredentialMessage {
  issuer: string; // 0x-prefixed 20-byte EVM address
  subject: string; // 0x-prefixed 32-byte bytes32
  claim: string; // canonical claim string (registry v2)
  issuedAt: string; // uint64 (decimal or hex; we'll coerce)
  expiresAt: string;
  nonce: string; // uint256
}

export interface RevocationMessage {
  subject: string;
  capabilityHash: string;
  nonce: string;
}

/** Build the Casper-native EIP-712 domain from a CredentialRegistry package hash. */
export function buildCredentialDomain(params: {
  contractPackageHashHex: string; // no 0x, no "contract-package-" prefix
  chainName: string; // e.g. "casper-test"
  domainName?: string;
  domainVersion?: string;
}): CasperEip712Domain {
  return {
    name: params.domainName ?? "Ligis CredentialRegistry",
    version: params.domainVersion ?? "2",
    chain_name: `casper:${params.chainName}`,
    contract_package_hash: `0x${params.contractPackageHashHex}`,
  };
}

/** Compute the EIP-712 digest for a credential.
 *
 * The `hashTypedData` types from `@casper-ecosystem/casper-eip-712` expect
 * mutable `TypedField[]` arrays; we cast from our `as const` literal —
 * the cast is safe because `hashTypedData` only reads the field list
 * and does not mutate it. Comment captured here so the next reader
 * doesn't try to "fix" it back to a readonly typing.
 */
export function buildCredentialDigest(
  domain: CasperEip712Domain,
  message: CredentialMessage,
): `0x${string}` {
  const digest = hashTypedData(
    domain as unknown as Record<string, string>,
    CREDENTIAL_TYPES as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    "Credential",
    toMessage(message),
    { domainTypes: CASPER_DOMAIN_TYPES },
  );
  return ("0x" + bufferToHex(digest)) as `0x${string}`;
}

/** Compute the revocation digest the v2 contract binds to:
 *   keccak256(subject(32B) || claim_hash(32B) || nonce(u64 BE, 8B))
 * Raw-keccak packed — NOT an EIP-712 typed-data hash. `keccak_revoke_digest`
 * in the contract re-derives this exact value. */
export function buildRevokeDigest(
  _domain: CasperEip712Domain,
  message: RevocationMessage,
): `0x${string}` {
  const clean = (h: string) =>
    h.replace(/^account-hash-/, "").replace(/^0x/, "");
  const subject = new Uint8Array(32);
  const sHex = clean(message.subject).padStart(64, "0");
  for (let i = 0; i < 32; i++)
    subject[i] = parseInt(sHex.slice(i * 2, i * 2 + 2), 16);
  const claimHash = new Uint8Array(32);
  const cHex = clean(message.capabilityHash).padStart(64, "0");
  for (let i = 0; i < 32; i++)
    claimHash[i] = parseInt(cHex.slice(i * 2, i * 2 + 2), 16);
  const buf = new Uint8Array(72);
  buf.set(subject, 0);
  buf.set(claimHash, 32);
  let nonce = BigInt(message.nonce);
  for (let i = 7; i >= 0; i--) {
    buf[64 + i] = Number(nonce & 0xffn);
    nonce >>= 8n;
  }
  return ("0x" + bufferToHex(keccak_256(buf))) as `0x${string}`;
}

/**
 * Sign a digest with a secp256k1 private key and return the 65-byte
 * EVM-style signature (`r || s || v`) with `v = 27 + recovery`.
 */
export function signDigest(
  digestHex: `0x${string}`,
  privateKeyHex: string,
): `0x${string}` {
  const cleanPriv = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const cleanDigest = digestHex.startsWith("0x")
    ? digestHex.slice(2)
    : digestHex;
  const privBytes = new Uint8Array(cleanPriv.length / 2);
  const digestBytes = new Uint8Array(cleanDigest.length / 2);
  for (let i = 0; i < privBytes.length; i++) {
    privBytes[i] = parseInt(cleanPriv.slice(i * 2, i * 2 + 2), 16);
  }
  for (let i = 0; i < digestBytes.length; i++) {
    digestBytes[i] = parseInt(cleanDigest.slice(i * 2, i * 2 + 2), 16);
  }
  const sig = secp256k1.sign(digestBytes, privBytes);
  const compact = sig.toCompactRawBytes();
  const full = new Uint8Array(65);
  full.set(compact, 0);
  full[64] = 27 + (sig.recovery ?? 0);
  let hex = "0x";
  for (const b of full) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/**
 * Sign a credential message end-to-end. Convenience wrapper used by both
 * `submitCredential` flows and the credential receipt.
 */
export function signCredentialMessage(params: {
  domain: CasperEip712Domain;
  issuerPrivateKeyHex: string;
  message: CredentialMessage;
}): { digest: `0x${string}`; signature: `0x${string}`; issuer: `0x${string}` } {
  const issuer = evmAddressFromSecpKey(params.issuerPrivateKeyHex);
  const message: CredentialMessage = { ...params.message, issuer };
  const digest = buildCredentialDigest(params.domain, message);
  const signature = signDigest(digest, params.issuerPrivateKeyHex);
  return { digest, signature, issuer };
}

export function signRevocationMessage(params: {
  domain: CasperEip712Domain;
  issuerPrivateKeyHex: string;
  message: RevocationMessage;
}): { digest: `0x${string}`; signature: `0x${string}` } {
  const digest = buildRevokeDigest(params.domain, params.message);
  const signature = signDigest(digest, params.issuerPrivateKeyHex);
  return { digest, signature };
}

/** Verify the issuer of a signed digest matches an expected EVM address. */
export function verifyIssuer(
  digestHex: `0x${string}`,
  signatureHex: `0x${string}`,
  expectedIssuer: `0x${string}`,
): boolean {
  const sigBytes = new Uint8Array(65 * 2); // fallback
  const sigClean = signatureHex.startsWith("0x")
    ? signatureHex.slice(2)
    : signatureHex;
  const arr = new Uint8Array(sigClean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(sigClean.slice(i * 2, i * 2 + 2), 16);
  }
  void sigBytes;
  const digestBytes = new Uint8Array(
    (digestHex.startsWith("0x") ? digestHex.slice(2) : digestHex).length / 2,
  );
  const digestClean = digestHex.startsWith("0x")
    ? digestHex.slice(2)
    : digestHex;
  for (let i = 0; i < digestBytes.length; i++) {
    digestBytes[i] = parseInt(digestClean.slice(i * 2, i * 2 + 2), 16);
  }
  return verifySignature(digestBytes, arr, expectedIssuer);
}

// ---------- internal helpers ----------

function toMessage(m: CredentialMessage): Record<string, unknown> {
  // uint fields are passed as bigint, not decimal strings: the encoder
  // treats string values as HEX, so "1000" would silently become 0x1000.
  return {
    issuer: m.issuer,
    subject: m.subject,
    claim: m.claim,
    issuedAt: BigInt(m.issuedAt),
    expiresAt: BigInt(m.expiresAt),
    nonce: BigInt(m.nonce),
  };
}

function toRevocationMessage(m: RevocationMessage): Record<string, string> {
  return {
    subject: m.subject,
    capabilityHash: m.capabilityHash,
    nonce: BigInt(m.nonce).toString(),
  };
}
void toRevocationMessage;

function bufferToHex(buf: Uint8Array): string {
  let h = "";
  for (const b of buf) h += b.toString(16).padStart(2, "0");
  return h;
}
