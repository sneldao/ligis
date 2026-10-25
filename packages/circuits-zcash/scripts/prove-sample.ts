/**
 * Build the sample CredentialRegistry tree, generate an UltraHonk proof that
 * the holder at index 2 holds the capability, verify it with the gate's
 * verifier (committed vk), and optionally emit the `/api/gate` `zkProof` JSON.
 *
 *   pnpm --filter @ligis/circuits-zcash prove:sample
 *   pnpm --filter @ligis/circuits-zcash prove:sample -- --payee <addr> \
 *     --capability agent.commerce.escrow --nonce pay-42 --json /tmp/zk.json
 *   pnpm --filter @ligis/circuits-zcash prove:sample -- --fixture   # test fixture
 *
 * `current_time` defaults to now (the gate rejects stale proofs); --fixture
 * pins it to SAMPLE_NOW so tests are deterministic.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  fieldHex,
  proveAndVerify,
  resolveToolchain,
  verifyMembershipProof,
} from "../src/index.js";
import { SAMPLE_NOW, sampleRegistry } from "../src/sample.js";

const { values } = parseArgs({
  // pnpm forwards the `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    payee: { type: "string" },
    capability: { type: "string" },
    nonce: { type: "string" },
    now: { type: "string" },
    json: { type: "string" },
    fixture: { type: "boolean", default: false },
  },
});

const tc = resolveToolchain();
if (typeof tc === "string") {
  console.error(`toolchain unavailable: ${tc}`);
  process.exit(1);
}
const log = (s: string) => console.error(s);
log(`bb ${tc.bbVersion}`);

const currentTime = values.fixture
  ? SAMPLE_NOW
  : BigInt(values.now ?? Math.floor(Date.now() / 1000));
const { inputs, contextLabel } = await sampleRegistry({
  payee: values.payee,
  capability: values.capability,
  nonce: values.nonce ?? (values.fixture ? "fixture-1" : undefined),
  currentTime,
});
log(
  `registry_root   ${fieldHex(inputs.registry_root)}  (LIGIS_ZK_TRUSTED_ROOTS)`,
);
log(`capability_hash ${fieldHex(inputs.capability_hash)}`);
log(`context         ${contextLabel}`);
log(`nullifier       ${fieldHex(inputs.nullifier)}`);

const t0 = Date.now();
const res = proveAndVerify(tc, inputs);
log(
  `proof: ${res.proofBytes} bytes, nargo/bb verified=${res.verified} (${Date.now() - t0} ms)`,
);
const proof = readFileSync(join(res.outDir, "proof"));
const pub = {
  registry_root: inputs.registry_root,
  capability_hash: inputs.capability_hash,
  context: inputs.context,
  current_time: inputs.current_time,
  nullifier: inputs.nullifier,
};
const gate = await verifyMembershipProof(proof, pub);
log(`gate verifier (committed vk): ${gate.status}`);
if (!res.verified || gate.status !== "verified") process.exit(1);

const zkProof = {
  proof: `0x${proof.toString("hex")}`,
  contextLabel,
  publicInputs: {
    registry_root: fieldHex(pub.registry_root),
    capability_hash: fieldHex(pub.capability_hash),
    context: fieldHex(pub.context),
    current_time: pub.current_time.toString(),
    nullifier: fieldHex(pub.nullifier),
  },
};
const out = values.fixture
  ? join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test",
      "fixtures",
      "membership-proof.json",
    )
  : values.json;
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(zkProof, null, 2)}\n`);
  log(`wrote ${out}`);
} else {
  try {
    proveAndVerify(
      tc,
      { ...inputs, registry_root: inputs.registry_root + 1n },
      "Tampered",
    );
    log("tampered root unexpectedly produced a proof");
    process.exit(1);
  } catch {
    log("tampered root: witness generation fails (no proof) ✓");
  }
}
