/**
 * ZK credential presentation for the gate (Zecathon Weeks 2–3).
 *
 * A payee may attach a proof from `@ligis/circuits-zcash`: "I hold an
 * unexpired credential for capability X in the registry tree with root R;
 * here is my nullifier for this context" — without revealing which
 * credential, issuer, or subject.
 *
 * This module is the gate-side policy, pure and dependency-injected (the
 * `bb` verifier and the nullifier store are wired in `zk-verifier.ts`):
 *
 *   1. trusted root   — `registry_root` must be pinned in LIGIS_ZK_TRUSTED_ROOTS
 *                       or be the root of the published manifest
 *                       (LIGIS_ZK_ROOT_MANIFEST, rebuilt from CredentialRegistry
 *                       events; UNKNOWN if older than LIGIS_ZK_ROOT_MAX_AGE_S)
 *   2. capability     — `capability_hash` must equal the gate's capability
 *   2b. payee         — `payee_hash` (committed in the credential leaf) must
 *                       equal keccak(intent.payee): no cross-payee replay
 *   3. context        — `contextLabel` (ligis-gate:v1:<payee>:<cap>:<nonce>)
 *                       must name this payee + capability and hash to `context`
 *   4. freshness      — `current_time` within LIGIS_ZK_MAX_PROOF_AGE_S of now
 *   5. replay         — (context, nullifier) not seen before
 *   6. proof          — UltraHonk verify with the committed vk
 *   7. claim          — record (context, nullifier) atomically
 *
 * Outcomes are explicit: GO (verified), STOP (rejected), or UNKNOWN
 * (unverified — toolchain/config/store unavailable). Never a silent pass.
 */
import {
  PUBLIC_INPUT_ORDER,
  capabilityField,
  contextField,
  payeeField,
  fieldHex,
  parseField,
  parseGateContextLabel,
  type MembershipPublicInputs,
} from "@ligis/circuits-zcash/fields";
import type { VerifyOutcome } from "@ligis/circuits-zcash/verify";

export type ZkProofInput = {
  /** 0x-hex UltraHonk proof bytes (bb `proof` file). */
  proof: `0x${string}`;
  /** Preimage of `context`: `ligis-gate:v1:<payee>:<capability>:<nonce>`. */
  contextLabel: string;
  publicInputs: MembershipPublicInputs;
};

export type ZkCredentialResult = {
  status: "GO" | "STOP" | "UNKNOWN";
  verification: "verified" | "rejected" | "unverified";
  reason: string;
  registryRoot?: string;
  /** Where the trusted root came from. */
  rootSource?: "pinned" | "manifest";
  nullifier?: string;
  context?: string;
  currentTime?: string;
  verifier?: string;
  latencyMs?: number;
};

export type NullifierClaim = "claimed" | "replayed" | "unavailable";

export interface NullifierStore {
  /** Read-only check, used before the (expensive) verify. */
  seen(context: string, nullifier: string): Promise<boolean | "unavailable">;
  /** Atomically record; "replayed" if it already existed. */
  claim(context: string, nullifier: string): Promise<NullifierClaim>;
}

export class MemoryNullifierStore implements NullifierStore {
  private readonly used = new Set<string>();
  async seen(context: string, nullifier: string) {
    return this.used.has(`${context}:${nullifier}`);
  }
  async claim(context: string, nullifier: string): Promise<NullifierClaim> {
    const k = `${context}:${nullifier}`;
    if (this.used.has(k)) return "replayed";
    this.used.add(k);
    return "claimed";
  }
}

export type ZkDeps = {
  verify: (
    proof: Uint8Array,
    pub: MembershipPublicInputs,
  ) => Promise<VerifyOutcome>;
  nullifiers: NullifierStore;
  /** Trusted registry roots. `undefined`/empty → every proof is UNKNOWN. */
  trustedRoots?: bigint[];
  /** Published root manifest (already integrity-checked), or why it isn't usable. */
  rootManifest?: PublishedRoot | { error: string };
  /** Max age of the manifest's `asOf` (seconds). Default 86400. */
  maxRootAgeS?: number;
  /** Unix ms. */
  now?: () => number;
  /** Max age of `current_time` (seconds). Default 600. */
  maxProofAgeS?: number;
};

const MAX_PROOF_BYTES = 64 * 1024;
const FUTURE_SKEW_S = 60;
export const DEFAULT_MAX_PROOF_AGE_S = 600;
export const DEFAULT_MAX_ROOT_AGE_S = 86_400;

export type PublishedRoot = { root: bigint; asOf: number; leafCount: number };

/** Parse the optional `zkProof` request field. Returns an error string. */
export function parseZkProof(raw: unknown): ZkProofInput | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "zkProof must be an object { proof, contextLabel, publicInputs }";
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.proof !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(r.proof) ||
    (r.proof.length - 2) / 2 > MAX_PROOF_BYTES
  ) {
    return `zkProof.proof must be 0x-hex bytes (≤ ${MAX_PROOF_BYTES} bytes)`;
  }
  if (
    typeof r.contextLabel !== "string" ||
    !parseGateContextLabel(r.contextLabel)
  ) {
    return "zkProof.contextLabel must be ligis-gate:v1:<payee>:<capability>:<nonce>";
  }
  const pi = r.publicInputs;
  if (!pi || typeof pi !== "object" || Array.isArray(pi)) {
    return `zkProof.publicInputs must be an object with ${PUBLIC_INPUT_ORDER.join(", ")}`;
  }
  const out: Partial<MembershipPublicInputs> = {};
  for (const k of PUBLIC_INPUT_ORDER) {
    const v = parseField((pi as Record<string, unknown>)[k]);
    if (v === null) {
      return `zkProof.publicInputs.${k} must be a 0x-hex or decimal field element`;
    }
    out[k] = v;
  }
  return {
    proof: r.proof as `0x${string}`,
    contextLabel: r.contextLabel,
    publicInputs: out as MembershipPublicInputs,
  };
}

/** `LIGIS_ZK_TRUSTED_ROOTS`: comma-separated 0x-hex roots. Invalid entries are dropped. */
export function trustedRootsFromEnv(
  env: Record<string, string | undefined>,
): bigint[] {
  return (env.LIGIS_ZK_TRUSTED_ROOTS ?? "")
    .split(",")
    .map((s) => parseField(s.trim()))
    .filter((v): v is bigint => v !== null);
}

export async function evaluateZkCredential(
  zk: ZkProofInput,
  intent: { payee: string; capability?: string },
  deps: ZkDeps | undefined,
): Promise<ZkCredentialResult> {
  const pub = zk.publicInputs;
  const base: Pick<
    ZkCredentialResult,
    "registryRoot" | "context" | "currentTime" | "rootSource"
  > & { nullifier: string } = {
    registryRoot: fieldHex(pub.registry_root),
    nullifier: fieldHex(pub.nullifier),
    context: zk.contextLabel,
    currentTime: pub.current_time.toString(),
  };
  const stop = (reason: string, extra: Partial<ZkCredentialResult> = {}) =>
    ({
      ...base,
      status: "STOP",
      verification: "rejected",
      reason,
      ...extra,
    }) as const;
  const unknown = (reason: string) =>
    ({
      ...base,
      status: "UNKNOWN",
      verification: "unverified",
      reason,
    }) as const;

  if (!deps) return unknown("zk verifier not configured on this gate");
  const nowS = Math.floor((deps.now ?? Date.now)() / 1000);
  const pinned = deps.trustedRoots ?? [];
  const m = deps.rootManifest;
  const published = m && !("error" in m) ? m : undefined;
  if (pinned.length === 0 && !published) {
    return unknown(
      m && "error" in m
        ? `published root manifest unusable: ${m.error}`
        : "no trusted registry roots configured (LIGIS_ZK_TRUSTED_ROOTS / LIGIS_ZK_ROOT_MANIFEST)",
    );
  }
  let rootSource: "pinned" | "manifest";
  if (pinned.includes(pub.registry_root)) {
    rootSource = "pinned";
  } else if (published && published.root === pub.registry_root) {
    const maxRootAge = deps.maxRootAgeS ?? DEFAULT_MAX_ROOT_AGE_S;
    if (nowS - published.asOf > maxRootAge) {
      return unknown(
        `published registry root is stale (asOf ${published.asOf}, > ${maxRootAge}s old); revocations may be missing`,
      );
    }
    rootSource = "manifest";
  } else {
    return stop("registry_root is not a trusted CredentialRegistry root");
  }
  base.rootSource = rootSource;
  if (!intent.capability) {
    return unknown("no capability on the intent to bind the proof to");
  }
  const cap = capabilityField(intent.capability);
  if (pub.capability_hash !== cap) {
    return stop(
      `proof is for a different capability than ${intent.capability}`,
    );
  }
  if (pub.payee_hash !== payeeField(intent.payee)) {
    return stop("proof credential is bound to a different payee");
  }
  const label = parseGateContextLabel(zk.contextLabel)!;
  if (
    label.payee !== intent.payee.trim().toLowerCase() ||
    capabilityField(label.capability) !== cap ||
    contextField(zk.contextLabel) !== pub.context
  ) {
    return stop("proof context is not bound to this payee and capability");
  }
  const maxAge = deps.maxProofAgeS ?? DEFAULT_MAX_PROOF_AGE_S;
  const t = Number(pub.current_time);
  if (t > nowS + FUTURE_SKEW_S)
    return stop("proof current_time is in the future");
  if (nowS - t > maxAge) return stop(`proof is older than ${maxAge}s`);

  const ctxKey = fieldHex(pub.context);
  const seen = await deps.nullifiers.seen(ctxKey, base.nullifier);
  if (seen === "unavailable") return unknown("nullifier store unavailable");
  if (seen) return stop("nullifier already used for this context (replay)");

  const proofBytes = Uint8Array.from(Buffer.from(zk.proof.slice(2), "hex"));
  const outcome = await deps.verify(proofBytes, pub);
  if (outcome.status === "unavailable") {
    return unknown(`proof not verified: ${outcome.detail}`);
  }
  if (outcome.status === "invalid") {
    return stop(`proof failed verification (${outcome.detail})`, {
      verifier: outcome.verifier,
      latencyMs: outcome.latencyMs,
    });
  }
  const claim = await deps.nullifiers.claim(ctxKey, base.nullifier);
  if (claim === "replayed") {
    return stop("nullifier already used for this context (replay)");
  }
  if (claim === "unavailable") {
    return unknown("proof verified but nullifier could not be recorded");
  }
  return {
    ...base,
    status: "GO",
    verification: "verified",
    reason: "credential membership proven against a trusted registry root",
    verifier: outcome.verifier,
    latencyMs: outcome.latencyMs,
  };
}
