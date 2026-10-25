import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CredentialTree,
  PUBLIC_INPUT_ORDER,
  capabilityField,
  contextField,
  parseGateContextLabel,
  verifyMembershipProof,
  fieldHex,
  getPoseidon,
  nullifierFor,
  proveAndVerify,
  resolveToolchain,
  toProverToml,
} from "../src/index.js";
import { SAMPLE_CAPABILITY, sampleRegistry } from "../src/sample.js";
import { MEMBERSHIP_VK_BASE64 } from "../src/vk.js";

describe("credential tree (TS mirror of main.nr)", () => {
  it("poseidon matches the Noir bn254 vector", async () => {
    // `bn254::hash_2([3, 1])`, from `nargo execute` on the probe circuit.
    const h = (await getPoseidon())([3n, 1n]);
    assert.equal(
      fieldHex(h),
      "0x0de304e79d1bb146ae53e3beabc2e947913eb4d31fb8df781105e18449e01050",
    );
  });

  it("recomputes the root from every leaf's path", async () => {
    const leaves = [11n, 22n, 33n, 44n, 55n];
    const tree = await CredentialTree.build(leaves, 4);
    const H = await getPoseidon();
    for (let i = 0; i < leaves.length; i++) {
      let node = leaves[i]!;
      let idx = i;
      for (const sib of tree.path(i)) {
        node = idx & 1 ? H([sib, node]) : H([node, sib]);
        idx >>= 1;
      }
      assert.equal(node, tree.root);
    }
  });

  it("nullifier is bound to capability and context", async () => {
    const cap = capabilityField(SAMPLE_CAPABILITY);
    const a = await nullifierFor(1n, cap, 1n);
    assert.notEqual(a, await nullifierFor(1n, cap, 2n));
    assert.notEqual(a, await nullifierFor(1n, cap + 1n, 1n));
    assert.equal(a, await nullifierFor(1n, cap, 1n));
  });

  it("serializes a Prover.toml with every circuit input", async () => {
    const { inputs } = await sampleRegistry();
    const toml = toProverToml(inputs);
    for (const k of [...PUBLIC_INPUT_ORDER, "identity_secret", "merkle_path"]) {
      assert.match(toml, new RegExp(`^${k} = `, "m"));
    }
  });
});

const tc = resolveToolchain();
describe(
  "end-to-end proof (nargo + bb)",
  { skip: typeof tc === "string" ? tc : false },
  () => {
    it("proves and verifies sample membership; tampered root has no witness", async () => {
      if (typeof tc === "string") return;
      const { inputs } = await sampleRegistry();
      const res = proveAndVerify(tc, inputs, "TestProver");
      assert.equal(res.verified, true);
      assert.deepEqual(
        res.publicInputs,
        PUBLIC_INPUT_ORDER.map((k) => fieldHex(inputs[k])),
      );
      // Week 3 payee binding: same holder, other payee → no witness.
      assert.throws(() =>
        proveAndVerify(
          tc,
          { ...inputs, payee_hash: inputs.payee_hash + 1n },
          "TestTampered",
        ),
      );
      assert.throws(() =>
        proveAndVerify(
          tc,
          { ...inputs, registry_root: inputs.registry_root + 1n },
          "TestTampered",
        ),
      );
    });
  },
);

describe("gate verifier (committed vk + bb)", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/membership-proof.json", import.meta.url),
      "utf8",
    ),
  ) as {
    proof: string;
    contextLabel: string;
    publicInputs: Record<(typeof PUBLIC_INPUT_ORDER)[number], string>;
  };
  const proof = Buffer.from(fixture.proof.slice(2), "hex");
  const pub = Object.fromEntries(
    PUBLIC_INPUT_ORDER.map((k) => [k, BigInt(fixture.publicInputs[k])]),
  ) as Record<(typeof PUBLIC_INPUT_ORDER)[number], bigint>;

  it("context label in the fixture hashes to its public context", () => {
    assert.equal(contextField(fixture.contextLabel), pub.context);
    assert.deepEqual(
      parseGateContextLabel(fixture.contextLabel)?.capability,
      SAMPLE_CAPABILITY,
    );
  });

  it("reports unavailable (never verified) when bb is missing", async () => {
    const out = await verifyMembershipProof(proof, pub, {
      env: { LIGIS_ZK_BB_BIN: "/nonexistent/bb" },
    });
    assert.equal(out.status, "unavailable");
  });

  it(
    "verifies the fixture and rejects a tampered public input",
    { skip: typeof tc === "string" ? tc : false },
    async () => {
      assert.equal(
        (await verifyMembershipProof(proof, pub)).status,
        "verified",
      );
      const bad = await verifyMembershipProof(proof, {
        ...pub,
        registry_root: pub.registry_root + 1n,
      });
      assert.equal(bad.status, "invalid");
    },
  );

  it(
    "committed vk matches the compiled circuit",
    { skip: typeof tc === "string" ? tc : false },
    async () => {
      if (typeof tc === "string") return;
      const { inputs } = await sampleRegistry();
      const res = proveAndVerify(tc, inputs, "TestProver");
      const vk = readFileSync(`${res.outDir}/vk`).toString("base64");
      assert.equal(
        vk,
        MEMBERSHIP_VK_BASE64,
        "run `pnpm write:vk` after changing main.nr",
      );
    },
  );
});
