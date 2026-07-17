/**
 * Browser-safe Casper secp256k1 keypair utilities.
 *
 * Uses only `casper-js-sdk` (5.x) for PublicKey/PrivateKey classes and
 * `@noble/curves` for direct ECDSA — no Node.js fs / crypto / execSync
 * dependencies. This is the file the browser imports when the user
 * generates a sandbox session or pastes a hex key.
 *
 * secp256k1 is the only supported algorithm here because Ligis
 * credentials use EIP-712 across Casper and Pharos, and on-chain signature
 * recovery on CredentialRegistry requires `k256` (secp256k1). The Casper
 * Wallet extension's default ed25519 key is therefore insufficient — see
 * the `ConnectWallet` UI for the explanation shown to users.
 */
import * as casperSdk from "casper-js-sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const { PrivateKey, PublicKey, KeyAlgorithm } = casperSdk;

export const CASPER_KEY_ALG = KeyAlgorithm.SECP256K1;

export interface CasperKeyPair {
  /** Hex private key with `0x` prefix (32 bytes). */
  privateKeyHex: string;
  /** Hex public key with algorithm byte prefix (`02...` for secp256k1). */
  publicKeyHex: string;
  /** Account hash hex without prefix (32 bytes). */
  accountHashHex: string;
  /** Account hash hex with `account-hash-` prefix — the chain-formatted address. */
  accountHash: string;
}

/**
 * Generate a brand-new secp256k1 Casper keypair in the browser.
 *
 * Draws a 32-byte scalar via `@noble/curves/secp256k1.utils.randomSecretKey()`
 * and constructs a casper-js-sdk PrivateKey from its hex. This sidesteps
 * the SDK's opaque internal private-key shape (v5.0.12 doesn't expose
 * the raw scalar on the public type) while keeping both the SDK
 * identity (PublicKey / accountHash derivation) and the scalar (for
 * `@noble/curves` ECDSA signing in `signDigest()`).
 */
export function generateKeyPair(): CasperKeyPair {
  const scalar = secp256k1.utils.randomSecretKey();
  if (!(scalar instanceof Uint8Array) || scalar.length !== 32) {
    throw new Error(
      `generateKeyPair: randomSecretKey returned ${scalar?.length ?? "?"} bytes; expected 32.`,
    );
  }
  let hex = "";
  for (const b of scalar) hex += b.toString(16).padStart(2, "0");
  return keyPairFromHexPrivateKey(`0x${hex}`);
}

/** Decode a hex private key (with or without `0x`). Throws on bad input. */
export function keyPairFromHexPrivateKey(hex: string): CasperKeyPair {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(
      "private key must be 64 hex characters (32 bytes); secp256k1 only",
    );
  }
  const pk = PrivateKey.fromHex(clean, CASPER_KEY_ALG);
  const publicKeyHex = pk.publicKey.toHex();
  const accountHashHex = pk.publicKey.accountHash().toHex();
  const accountHash = `account-hash-${accountHashHex}`;
  return {
    privateKeyHex: `0x${clean}`,
    publicKeyHex,
    accountHashHex,
    accountHash,
  };
}

/**
 * Derive the EVM-style 20-byte address from a secp256k1 private key.
 *
 * Used to recover the issuer address EIP-712 credentials are signed
 * under — the address submitted as `Credential.issuer` on-chain.
 */
export function evmAddressFromSecpKey(privateKeyHex: string): `0x${string}` {
  const clean = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("evmAddressFromSecpKey: invalid hex private key");
  }
  const privBytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < privBytes.length; i++) {
    privBytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const pub = secp256k1.getPublicKey(privBytes, false); // uncompressed: 0x04 || X || Y
  const hash = keccak_256(pub.slice(1)); // strip 0x04 prefix
  const addr = hash.slice(-20);
  let hex = "0x";
  for (const b of addr) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/** Classify a public-key hex by its leading algorithm byte. */
export function classifyAlgorithm(publicKeyHex: string): "ed25519" | "secp256k1" | "unknown" {
  const c = publicKeyHex[0];
  if (c === "0" && (publicKeyHex[1] === "1" || publicKeyHex[1] === "2" || publicKeyHex[1] === "3")) {
    return publicKeyHex[1] === "1" ? "ed25519" : "secp256k1";
  }
  // The Casper public-key hex always starts with `0` (algorithm byte)
  // followed by `1`/`2`/`3` (key variant). If the string doesn't
  // match, fall back to runtime check via PublicKey.fromHex.
  return "unknown";
}

/** Validate that a hex string looks like a Casper public key. */
export function isPublicKeyHex(hex: string): boolean {
  return /^0[1-3][a-fA-F0-9]{64}$/.test(hex) || /^0x0[1-3][a-fA-F0-9]{64}$/.test(hex);
}

// Re-export for callers who want to keep using PublicKey directly.
export { PrivateKey, PublicKey };
