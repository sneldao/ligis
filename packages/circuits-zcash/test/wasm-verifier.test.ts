import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyMembershipProof } from "../src/verify.js";
import {
  PUBLIC_INPUT_ORDER,
  type MembershipPublicInputs,
} from "../src/fields.js";

// Opt in because a cold cache downloads CRS and initializes a WASM runtime.
test(
  "WASM verifies native proof; rejects tampered root and proof",
  {
    skip: process.env.LIGIS_ZK_TEST_WASM !== "1",
    timeout: 90_000,
  },
  async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/membership-proof.json", import.meta.url),
        "utf8",
      ),
    );
    const proof = Buffer.from(fixture.proof.slice(2), "hex");
    const pub = Object.fromEntries(
      PUBLIC_INPUT_ORDER.map((k) => [k, BigInt(fixture.publicInputs[k])]),
    ) as MembershipPublicInputs;
    const opts = {
      env: { LIGIS_ZK_VERIFIER: "wasm", LIGIS_ZK_BB_BIN: "/not-installed/bb" },
    };
    const valid = await verifyMembershipProof(proof, pub, opts);
    assert.equal(valid.status, "verified", JSON.stringify(valid));
    assert.equal(
      (
        await verifyMembershipProof(
          proof,
          { ...pub, registry_root: pub.registry_root + 1n },
          opts,
        )
      ).status,
      "invalid",
    );
    const changed = Buffer.from(proof);
    changed[changed.length - 1] ^= 1;
    assert.notEqual(
      (await verifyMembershipProof(changed, pub, opts)).status,
      "verified",
    );
    assert.equal(
      (await verifyMembershipProof(new Uint8Array(1), pub, opts)).status,
      "invalid",
    );
  },
);
