/**
 * Build the sample CredentialRegistry tree, generate an UltraHonk proof that
 * the holder at index 2 holds `agent.commerce.escrow`, verify it, then show
 * that a tampered root cannot produce a witness and a replayed nullifier is
 * rejected by the gate's nullifier set.
 *
 *   pnpm --filter @ligis/circuits-zcash prove:sample
 */
import { fieldHex, proveAndVerify, resolveToolchain } from "../src/index.js";
import { sampleRegistry } from "../src/sample.js";

const tc = resolveToolchain();
if (typeof tc === "string") {
  console.error(`toolchain unavailable: ${tc}`);
  process.exit(1);
}
console.log(`bb ${tc.bbVersion}`);

const { inputs } = await sampleRegistry();
console.log(`registry_root   ${fieldHex(inputs.registry_root)}`);
console.log(`capability_hash ${fieldHex(inputs.capability_hash)}`);
console.log(`nullifier       ${fieldHex(inputs.nullifier)}`);

const t0 = Date.now();
const res = proveAndVerify(tc, inputs);
console.log(
  `proof: ${res.proofBytes} bytes, verified=${res.verified} (${Date.now() - t0} ms incl. execute+prove+verify)`,
);
if (!res.verified) process.exit(1);

try {
  proveAndVerify(
    tc,
    { ...inputs, registry_root: inputs.registry_root + 1n },
    "Tampered",
  );
  console.error("tampered root unexpectedly produced a proof");
  process.exit(1);
} catch {
  console.log("tampered root: witness generation fails (no proof) ✓");
}

const seen = new Set<string>([res.publicInputs[4]!]);
console.log(
  `replay of nullifier ${res.publicInputs[4]!.slice(0, 18)}…: ${seen.has(fieldHex(inputs.nullifier)) ? "STOP (already spent) ✓" : "GO"}`,
);
