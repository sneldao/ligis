import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDemoProof, zkDemoEnabled } from "@/lib/zk-demo";
import { loadRootManifest, zkRootInfo } from "@/lib/zk-root";
import { demoRegistry } from "@ligis/circuits-zcash/demo";

const on = {
  NODE_ENV: "test",
  LIGIS_ZK_ROOT_MANIFEST: "demo",
} as NodeJS.ProcessEnv;
const fake = (async () => ({ scenario: "holder" })) as never;

describe("guided demo proofs (/api/zk/demo-proof)", () => {
  it("is off unless the gate trusts the demo registry", async () => {
    assert.equal(zkDemoEnabled({ NODE_ENV: "test" }), false);
    const r = await runDemoProof({ NODE_ENV: "test" }, "holder", fake);
    assert.ok(!r.ok && r.status === 403);
  });

  it("validates the scenario and reports a missing toolchain as 503", async () => {
    const bad = await runDemoProof(on, "admin", fake);
    assert.ok(!bad.ok && bad.status === 400);
    const missing = await runDemoProof(
      on,
      "holder",
      (async () => "nargo not found") as never,
    );
    assert.ok(!missing.ok && missing.status === 503);
    assert.match(missing.error, /nargo not found/);
    const ok = await runDemoProof(on, "revoked", fake);
    assert.ok(ok.ok);
  });

  it("limits concurrent proving", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async () => {
      await gate;
      return { scenario: "holder" };
    }) as never;
    const a = runDemoProof(on, "holder", slow);
    const b = runDemoProof(on, "holder", slow);
    const c = await runDemoProof(on, "holder", slow);
    assert.ok(!c.ok && c.status === 429);
    release();
    assert.ok((await a).ok && (await b).ok);
  });

  it("LIGIS_ZK_ROOT_MANIFEST=demo trusts the fresh demo registry root", async () => {
    const loaded = await loadRootManifest(on);
    assert.ok(loaded && !("error" in loaded));
    const now = Math.floor(Date.now() / 1000);
    assert.equal(loaded.manifest.root, (await demoRegistry(now)).manifest.root);
    assert.ok(now - loaded.published.asOf < 600);
    assert.equal((await zkRootInfo(on)).manifest?.status, "fresh");
  });
});
