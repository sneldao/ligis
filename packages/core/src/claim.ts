/**
 * Canonical capability claims (CredentialRegistry v2).
 *
 * A claim is a capability plus optional typed parameters:
 *
 *   claim      := capability [ ":" param "=" value ]*
 *   capability := segment ( "." segment )+         // ≥ 1 dot required
 *   namespace  := the FIRST segment of capability
 *   segment    := [a-z0-9] [a-z0-9_-]*
 *   param      := [a-z] [a-z0-9_]*
 *   value      := [a-zA-Z0-9_+.\-]+                 // ':' and '=' not allowed
 *
 * Canonical form: params sorted strictly ascending by key, unique keys,
 * lowercase segments/keys, no whitespace, ≤ MAX_CLAIM_LEN bytes, ≤
 * MAX_CLAIM_PARAMS params.
 *
 * `claimHash(claim) = keccak256(utf8(canonical_claim))` — identical to v1
 * `capabilityHash(name)` for parameter-free claims, so v2 is a superset of
 * the existing hash space and the cross-chain portability invariant holds.
 *
 * Spec: docs/credential-registry-v2.md. The Casper contract validates the
 * same grammar on-chain at issue() — this module is the chain-neutral
 * reference both sides conform to.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Bytes32 } from "./types.js";

export const MAX_CLAIM_LEN = 192;
export const MAX_CLAIM_PARAMS = 8;

const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/;
const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/;
const PARAM_VALUE_RE = /^[a-zA-Z0-9_+.-]+$/;

export interface ClaimParam {
  key: string;
  value: string;
}

export interface ParsedClaim {
  /** The canonical form — what gets hashed and stored on-chain. */
  canonical: string;
  /** Dotted capability path ("rwa.accredited"). */
  capability: string;
  /** First segment of the capability ("rwa"). */
  namespace: string;
  /** Sorted, unique parameters (may be empty). */
  params: ClaimParam[];
}

function fail(reason: string): never {
  throw new Error(`claim: ${reason}`);
}

/** Validate the dotted capability portion and return it + the namespace. */
function parseCapabilityPart(part: string): {
  capability: string;
  namespace: string;
} {
  const capability = part.toLowerCase();
  const segments = capability.split(".");
  if (segments.length < 2) {
    fail(`capability '${part}' must contain a namespace and a name (a.b)`);
  }
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      fail(`capability '${part}' has invalid segment '${seg}'`);
    }
  }
  return { capability, namespace: segments[0] };
}

/** Parse one `key=value` param token (key lowercased during canonicalize). */
function parseParam(token: string): ClaimParam {
  const eq = token.indexOf("=");
  if (eq <= 0) fail(`param '${token}' is not key=value`);
  const key = token.slice(0, eq).toLowerCase();
  const value = token.slice(eq + 1);
  if (!PARAM_KEY_RE.test(key)) fail(`param key '${key}' is invalid`);
  if (!PARAM_VALUE_RE.test(value)) fail(`param value '${value}' is invalid`);
  return { key, value };
}

/**
 * Canonicalize a claim: lowercase the capability and param keys, sort
 * params ascending by key, and validate grammar. Throws on invalid input
 * (bad charset, duplicate keys, too many params, over-length, missing
 * namespace). Two inputs with the same meaning canonicalize to the same
 * string, so their hashes are identical.
 */
export function canonicalizeClaim(input: string): string {
  if (input.length === 0) fail("empty claim");
  const tokens = input.split(":");
  const { capability } = parseCapabilityPart(tokens[0]);
  const params = tokens.slice(1).map(parseParam);
  if (params.length > MAX_CLAIM_PARAMS) {
    fail(`too many params (${params.length} > ${MAX_CLAIM_PARAMS})`);
  }
  const keys = params.map((p) => p.key);
  const sorted = [...keys].sort();
  const dup = sorted.find((k, i) => i > 0 && k === sorted[i - 1]);
  if (dup) fail(`duplicate param '${dup}'`);
  const byKey = new Map(params.map((p) => [p.key, p.value]));
  const canonical =
    capability + sorted.map((k) => `:${k}=${byKey.get(k)}`).join("");
  if (canonical.length > MAX_CLAIM_LEN) {
    fail(`claim too long (${canonical.length} > ${MAX_CLAIM_LEN})`);
  }
  return canonical;
}

/** True when `input` is already in canonical form. */
export function isCanonicalClaim(input: string): boolean {
  try {
    return canonicalizeClaim(input) === input;
  } catch {
    return false;
  }
}

/**
 * Strictly parse a claim — the input must already be canonical. Use this
 * for anything destined for the registry (hashing, storage, signing) so
 * non-canonical input fails loudly instead of producing a second hash for
 * the same meaning.
 */
export function parseClaim(input: string): ParsedClaim {
  const canonical = canonicalizeClaim(input);
  if (canonical !== input) {
    fail(`claim is not in canonical form (expected '${canonical}')`);
  }
  const { capability, namespace } = parseCapabilityPart(
    canonical.split(":")[0],
  );
  const params = canonical.split(":").slice(1).map(parseParam);
  return { canonical, capability, namespace, params };
}

/** Convenience: tryParseClaim returns null instead of throwing. */
export function tryParseClaim(input: string): ParsedClaim | null {
  try {
    return parseClaim(input);
  } catch {
    return null;
  }
}

/** The namespace (first capability segment) of a claim. */
export function namespaceOf(claim: string): string {
  return parseClaim(claim).namespace;
}

function keccakHex(data: Uint8Array): Bytes32 {
  const bytes = keccak_256(data);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Bytes32;
}

/**
 * keccak256 of the canonical claim string. For parameter-free claims this
 * is byte-identical to v1 `capabilityHash(name)` — the portability
 * invariant. Accepts non-canonical input only via canonicalize-first
 * semantics? No — strict: input must be canonical (use
 * `canonicalizeClaim` first if the source is untrusted).
 */
export function claimHash(claim: string): Bytes32 {
  const { canonical } = parseClaim(claim);
  return keccakHex(new TextEncoder().encode(canonical));
}

/** keccak256 of the claim's namespace — the accreditation key. */
export function namespaceHash(claim: string): Bytes32 {
  const { namespace } = parseClaim(claim);
  return keccakHex(new TextEncoder().encode(namespace));
}

/** keccak256 of an arbitrary namespace string (e.g. "rwa"). */
export function namespaceHashOf(namespace: string): Bytes32 {
  if (!SEGMENT_RE.test(namespace)) {
    fail(`namespace '${namespace}' is invalid`);
  }
  return keccakHex(new TextEncoder().encode(namespace));
}
