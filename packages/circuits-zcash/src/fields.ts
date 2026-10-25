/**
 * Pure field helpers shared by the prover side and the gate's verifier.
 * No Poseidon/circomlibjs and no Node built-ins — safe to bundle anywhere.
 */
import { keccak_256 } from "@noble/hashes/sha3";

/** BN254 scalar field modulus. Every circuit input is reduced into it. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Must match `global DEPTH` in circuit/src/main.nr. */
export const TREE_DEPTH = 16;

/** Public inputs in circuit declaration order (bb's `public_inputs`). */
export const PUBLIC_INPUT_ORDER = [
  "registry_root",
  "capability_hash",
  "context",
  "current_time",
  "nullifier",
] as const;

export type PublicInputName = (typeof PUBLIC_INPUT_ORDER)[number];
export type MembershipPublicInputs = Record<PublicInputName, bigint>;

export function toField(v: bigint | number | string): bigint {
  const n = typeof v === "bigint" ? v : BigInt(v);
  return ((n % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;
}

export function fieldHex(v: bigint): `0x${string}` {
  return `0x${toField(v).toString(16).padStart(64, "0")}`;
}

/** Parse a 0x-hex or decimal string as a canonical field element (no reduction). */
export function parseField(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
    return BigInt(v);
  if (typeof v !== "string") return null;
  if (!/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(v)) return null;
  const n = BigInt(v);
  return n < FIELD_MODULUS ? n : null;
}

function keccakField(bytes: Uint8Array): bigint {
  let hex = "";
  for (const b of keccak_256(bytes)) hex += b.toString(16).padStart(2, "0");
  return toField(BigInt(`0x${hex}`));
}

/**
 * Capability hash as a circuit field: `uint256(keccak256(name)) mod p`.
 * Accepts the 0x-prefixed bytes32 that `@ligis/core` `capabilityHash()`
 * and the EVM CredentialRegistry use, or a human-readable name.
 */
export function capabilityField(capability: string): bigint {
  if (/^0x[0-9a-fA-F]{64}$/.test(capability))
    return toField(BigInt(capability));
  return keccakField(new TextEncoder().encode(capability));
}

/** Issuer EVM address as a field element. */
export function issuerField(address: string): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new TypeError(`issuer must be an EVM address: ${address}`);
  }
  return BigInt(address);
}

/** Presentation context label → field (`keccak256(label) mod p`). */
export function contextField(label: string): bigint {
  return keccakField(new TextEncoder().encode(label));
}

/** Gate context labels: `ligis-gate:v1:<payee>:<capability>:<nonce>`. */
export const GATE_CONTEXT_PREFIX = "ligis-gate:v1";
const NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Canonical gate presentation context. Binds the nullifier (and therefore
 * the proof) to one payee, one capability, and one caller-chosen nonce.
 */
export function gateContextLabel(
  payee: string,
  capability: string,
  nonce: string,
): string {
  if (!NONCE_RE.test(nonce))
    throw new TypeError("nonce must match /^[A-Za-z0-9_-]{1,64}$/");
  return `${GATE_CONTEXT_PREFIX}:${payee.trim().toLowerCase()}:${capability}:${nonce}`;
}

/** Parse a gate context label; null when it isn't one. */
export function parseGateContextLabel(
  label: string,
): { payee: string; capability: string; nonce: string } | null {
  if (!label.startsWith(`${GATE_CONTEXT_PREFIX}:`) || label.length > 512)
    return null;
  const rest = label.slice(GATE_CONTEXT_PREFIX.length + 1).split(":");
  if (rest.length !== 3) return null;
  const [payee, capability, nonce] = rest as [string, string, string];
  if (!payee || !capability || !NONCE_RE.test(nonce)) return null;
  return { payee, capability, nonce };
}
