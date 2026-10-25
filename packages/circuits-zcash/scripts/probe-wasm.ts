import { readFileSync } from "node:fs";
import {
  BackendType,
  Barretenberg,
  UltraHonkVerifierBackend,
} from "@aztec/bb.js";
import { MEMBERSHIP_VK_BASE64 } from "../src/vk.js";
import { PUBLIC_INPUT_ORDER, fieldHex } from "../src/fields.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../test/fixtures/membership-proof.json", import.meta.url),
    "utf8",
  ),
);
const start = Date.now();
const api = await Barretenberg.new({
  backend: BackendType.Wasm,
  threads: 1,
  srsSize: 2 ** 17,
});
try {
  const verifier = new UltraHonkVerifierBackend(api);
  const data = {
    proof: Buffer.from(fixture.proof.slice(2), "hex"),
    publicInputs: PUBLIC_INPUT_ORDER.map((k) =>
      fieldHex(BigInt(fixture.publicInputs[k])),
    ),
    verificationKey: Buffer.from(MEMBERSHIP_VK_BASE64, "base64"),
  };
  console.log(
    "valid:",
    await verifier.verifyProof(data, { verifierTarget: "noir-recursive" }),
  );
  data.publicInputs[0] = fieldHex(BigInt(data.publicInputs[0]!) + 1n);
  console.log(
    "tampered:",
    await verifier.verifyProof(data, { verifierTarget: "noir-recursive" }),
  );
  console.log("elapsedMs:", Date.now() - start);
} finally {
  await api.destroy();
}
