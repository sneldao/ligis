/** Node WASM verifier for the pinned UltraHonk proof format. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PUBLIC_INPUT_ORDER,
  fieldHex,
  type MembershipPublicInputs,
} from "./fields.js";
import { MEMBERSHIP_VK_BASE64 } from "./vk.js";
import type { VerifyOutcome } from "./verify.js";

/**
 * Explicit opt-in backend. CRS initialization needs network access on a cold
 * cache and writable cache storage. Deployment tracing must include bb.js assets.
 * Calls are serialized per process to bound WASM memory usage.
 */
let queue: Promise<unknown> = Promise.resolve();
export function verifyMembershipProofWasm(
  proof: Uint8Array,
  pub: MembershipPublicInputs,
): Promise<VerifyOutcome> {
  const operation = queue.then(async (): Promise<VerifyOutcome> => {
    const started = Date.now();
    const verifier = "bb.js 5.0.0-nightly.20260522 wasm ultra_honk";
    if (!proof.length || proof.length % 32 !== 0 || proof.length > 131072) {
      return {
        status: "invalid",
        verifier,
        latencyMs: 0,
        detail: "invalid proof byte length",
      };
    }
    let api: import("@aztec/bb.js").Barretenberg | undefined;
    try {
      const { BackendType, Barretenberg, UltraHonkVerifierBackend } =
        await import("@aztec/bb.js");
      api = await Barretenberg.new({
        backend: BackendType.Wasm,
        threads: 1,
        srsSize: 2 ** 17,
        crsPath: join(tmpdir(), "ligis-bb-crs"),
      });
      const valid = await new UltraHonkVerifierBackend(api).verifyProof(
        {
          proof,
          publicInputs: PUBLIC_INPUT_ORDER.map((k) => fieldHex(pub[k])),
          verificationKey: Buffer.from(MEMBERSHIP_VK_BASE64, "base64"),
        },
        { verifierTarget: "noir-recursive" },
      );
      const latencyMs = Date.now() - started;
      return valid
        ? { status: "verified", verifier, latencyMs }
        : {
            status: "invalid",
            verifier,
            latencyMs,
            detail: "WASM verifier rejected the proof",
          };
    } catch (error) {
      // Runtime/CRS failures must never be interpreted as proof validity.
      const reason =
        error instanceof Error ? error.message.slice(0, 160) : "unknown error";
      return {
        status: "unavailable",
        detail: `WASM verifier unavailable: ${reason}`,
      };
    } finally {
      await api?.destroy().catch(() => undefined);
    }
  });
  queue = operation.catch(() => undefined);
  return operation;
}
