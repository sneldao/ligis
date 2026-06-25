/**
 * Chain-neutral hashing utilities.
 *
 * Capabilities are identified by the keccak256 hash of their human-readable
 * name. The same hash is used across all chains so that a capability minted
 * on Pharos and a capability minted on Casper for the same name are
 * referentially identical at the protocol level.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import type { Bytes32, CapabilityHash } from "./types.js";

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Type guard: is this string a 32-byte hex value? */
export function isHexBytes32(s: string): s is Bytes32 {
  return BYTES32_RE.test(s);
}

/** Compute keccak256 of a UTF-8 string and return as a 0x-prefixed 32-byte hex. */
export function capabilityHash(name: string): CapabilityHash {
  const bytes = keccak_256(new TextEncoder().encode(name));
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as CapabilityHash;
}

/** Parse a capability arg as either a 32-byte hex hash or a human-readable name. */
export function parseCapability(s: string): CapabilityHash {
  if (isHexBytes32(s)) return s as CapabilityHash;
  return capabilityHash(s);
}
