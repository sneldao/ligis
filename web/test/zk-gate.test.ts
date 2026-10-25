/**
 * Gate ZK credential proofs (Zecathon Weeks 2–3): real UltraHonk fixture from
 * packages/circuits-zcash, verified with `bb` when present, plus stubbed
 * verifiers so every policy branch runs without the toolchain.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  contextField,
  fieldHex,
  gateContextLabel,
  payeeField,
} from "@ligis/circuits-zcash/fields";
import { DEMO_OTHER_PAYEE, demoRegistry } from "@ligis/circuits-zcash/demo";
import { describe, it } from "node:test";
import {
  resolveBb,
  verifyMembershipProof,
  type VerifyOutcome,
} from "@ligis/circuits-zcash/verify";
import { decide, type DecideDeps, type PaymentIntent } from "@/lib/decide";
import { bodyToIntent, fromBadRequest } from "@/lib/gate-intent";
import { runGateDecision } from "@/lib/gate-run";
import { zecAmount } from "@/lib/payment-asset";
import { loadRootManifest, zkRootInfo } from "@/lib/zk-root";
import {
  MemoryNullifierStore,
  parseZkProof,
  trustedRootsFromEnv,
  type ZkDeps,
  type ZkProofInput,
} from "@/lib/zk-credential";

const rawFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/circuits-zcash/test/fixtures/membership-proof.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const fixture = parseZkProof(rawFixture) as ZkProofInput;
assert.ok(typeof fixture !== "string");
const PAYEE = fixture.contextLabel.split(":")[2]!;
const ROOT = fixture.publicInputs.registry_root;
const NOW_MS = Number(fixture.publicInputs.current_time) * 1000 + 5_000;

const env: NodeJS.ProcessEnv = { NODE_ENV: "test", LIGIS_JEV_ENABLED: "0" };

const intent: PaymentIntent = {
  payee: PAYEE,
  amountUsd: 25,
  ...zecAmount("0.25"),
  purpose: "Release shielded ZEC for escrow settlement",
  capability: "agent.commerce.escrow",
  mandate: { payees: [PAYEE], maxUsd: 50, expectedUsd: 25 },
  zkProof: fixture,
};

const stubVerify =
  (outcome: VerifyOutcome, calls?: { n: number }) =>
  async (): Promise<VerifyOutcome> => {
    if (calls) calls.n++;
    return outcome;
  };
const VERIFIED: VerifyOutcome = {
  status: "verified",
  verifier: "stub",
  latencyMs: 1,
};

function zk(over: Partial<ZkDeps> = {}): ZkDeps {
  return {
    verify: stubVerify(VERIFIED),
    nullifiers: new MemoryNullifierStore(),
    trustedRoots: [ROOT],
    now: () => NOW_MS,
    ...over,
  };
}

function deps(z: ZkDeps | undefined): DecideDeps {
  return {
    env,
    // No public credential for this shielded subject: verified-payee would be
    // SKIPPED without the proof, so the proof is what answers it.
    resolveSubject: async () => ({
      ok: false as const,
      error: "no public read",
    }),
    zk: z,
  };
}

const vp = (d: Awaited<ReturnType<typeof decide>>) =>
  d.signals.find((s) => s.id === "verified-payee")!;

const bb = await resolveBb();
const noBb = bb.ok ? false : `bb unavailable: ${bb.reason}`;

describe("gate zk credential proofs", () => {
  it("valid proof (stub verifier) → zk GO, verified-payee GO, verdict GO", async () => {
    const d = await decide(intent, deps(zk()));
    assert.equal(d.zkCredential?.status, "GO");
    assert.equal(d.zkCredential?.verification, "verified");
    assert.equal(vp(d).status, "GO");
    assert.equal(d.verdict, "GO");
    assert.ok(
      d.provenance.some((p) => p.startsWith("zk-credential verified go")),
    );
  });

  it(
    "valid proof verifies with real bb + committed vk",
    { skip: noBb },
    async () => {
      const d = await decide(
        intent,
        deps(zk({ verify: (p, pub) => verifyMembershipProof(p, pub) })),
      );
      assert.equal(d.zkCredential?.status, "GO", d.zkCredential?.reason ?? "");
      assert.match(d.zkCredential?.verifier ?? "", /^bb .* ultra_honk$/);
      assert.equal(d.verdict, "GO");
    },
  );

  it("untrusted root → STOP without calling the verifier", async () => {
    const calls = { n: 0 };
    const d = await decide(
      intent,
      deps(
        zk({ trustedRoots: [ROOT + 1n], verify: stubVerify(VERIFIED, calls) }),
      ),
    );
    assert.equal(d.zkCredential?.status, "STOP");
    assert.match(d.zkCredential!.reason, /not a trusted/);
    assert.equal(calls.n, 0);
    assert.equal(vp(d).status, "STOP");
    assert.equal(d.verdict, "STOP");
  });

  it(
    "bad root that IS trusted but not what was proven → bb rejects → STOP",
    { skip: noBb },
    async () => {
      const forged = {
        ...fixture,
        publicInputs: { ...fixture.publicInputs, registry_root: ROOT + 1n },
      };
      const d = await decide(
        { ...intent, zkProof: forged },
        deps(
          zk({
            trustedRoots: [ROOT + 1n],
            verify: (p, pub) => verifyMembershipProof(p, pub),
          }),
        ),
      );
      assert.equal(d.zkCredential?.status, "STOP");
      assert.equal(d.zkCredential?.verification, "rejected");
      assert.match(d.zkCredential!.reason, /failed verification/);
      assert.equal(d.verdict, "STOP");
    },
  );

  it("replayed nullifier in the same context → STOP", async () => {
    const z = zk();
    const first = await decide(intent, deps(z));
    assert.equal(first.zkCredential?.status, "GO");
    const second = await decide(intent, deps(z));
    assert.equal(second.zkCredential?.status, "STOP");
    assert.match(second.zkCredential!.reason, /replay/);
    assert.equal(second.verdict, "STOP");
  });

  it("toolchain missing → UNKNOWN (unverified), verdict UNKNOWN, nullifier not burned", async () => {
    const store = new MemoryNullifierStore();
    const d = await decide(
      intent,
      deps(
        zk({
          nullifiers: store,
          verify: (p, pub) =>
            verifyMembershipProof(p, pub, {
              env: { LIGIS_ZK_BB_BIN: "/nonexistent/bb" },
            }),
        }),
      ),
    );
    assert.equal(d.zkCredential?.status, "UNKNOWN");
    assert.equal(d.zkCredential?.verification, "unverified");
    assert.match(d.zkCredential!.reason, /not verified: bb not runnable/);
    assert.equal(vp(d).status, "UNKNOWN");
    assert.equal(d.verdict, "UNKNOWN");
    assert.equal(
      await store.seen(
        `0x${fixture.publicInputs.context.toString(16).padStart(64, "0")}`,
        `0x${fixture.publicInputs.nullifier.toString(16).padStart(64, "0")}`,
      ),
      false,
    );
  });

  it("no trusted roots configured / no zk deps → UNKNOWN, never GO", async () => {
    assert.equal(
      (await decide(intent, deps(zk({ trustedRoots: [] })))).verdict,
      "UNKNOWN",
    );
    const d = await decide(intent, deps(undefined));
    assert.equal(d.zkCredential?.status, "UNKNOWN");
    assert.match(d.zkCredential!.reason, /not configured/);
  });

  it("proof bound to another payee, another capability, or stale → STOP", async () => {
    const other =
      "utest1s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw08wk3r5n";
    const wrongPayee = await decide(
      { ...intent, payee: other, mandate: { payees: [other], maxUsd: 50 } },
      deps(zk()),
    );
    assert.match(wrongPayee.zkCredential!.reason, /different payee/);
    const wrongCap = await decide(
      { ...intent, capability: "kyc.basic" },
      deps(zk()),
    );
    assert.match(wrongCap.zkCredential!.reason, /different capability/);
    const stale = await decide(
      intent,
      deps(zk({ now: () => NOW_MS + 3_600_000 })),
    );
    assert.match(stale.zkCredential!.reason, /older than 600s/);
    for (const d of [wrongPayee, wrongCap, stale])
      assert.equal(d.verdict, "STOP");
  });

  it("a verified proof never masks a public-registry STOP", async () => {
    const d = await decide(intent, {
      ...deps(zk()),
      resolveSubject: async () =>
        ({
          ok: true as const,
          subject: PAYEE,
          capable: false,
          selfIssued: true,
          primary: {
            chain: { id: "zcash-testnet", name: "Zcash Testnet" },
            outcome: { ok: true, capable: false, revoked: true },
          },
          verdicts: [],
        }) as never,
    });
    assert.equal(d.zkCredential?.status, "GO");
    assert.equal(vp(d).status, "STOP");
    assert.equal(d.verdict, "STOP");
  });

  const publicRead = (outcome: object, extra: object = {}) =>
    (async () =>
      ({
        ok: true as const,
        subject: PAYEE,
        capable: false,
        ...extra,
        primary: {
          chain: { id: "zcash-testnet", name: "Zcash Testnet" },
          outcome,
        },
        verdicts: [
          { chain: { id: "zcash-testnet", name: "Zcash Testnet" }, outcome },
        ],
      }) as never) as DecideDeps["resolveSubject"];

  it("shielded payee with NO public credential: a verified proof answers GO (private presentation)", async () => {
    const absent = { ok: true, capable: false, revoked: false };
    const without = await decide(
      { ...intent, zkProof: undefined },
      { ...deps(zk()), resolveSubject: publicRead(absent) },
    );
    assert.equal(vp(without).status, "STOP");
    const d = await decide(intent, {
      ...deps(zk()),
      resolveSubject: publicRead(absent),
    });
    assert.equal(vp(d).status, "GO");
    assert.match(vp(d).reason ?? "", /no public credential/);
    assert.equal(d.verdict, "GO");
  });

  it("public revoked or self-issued still wins over a verified proof", async () => {
    for (const [outcome, extra] of [
      [{ ok: true, capable: false, revoked: true }, {}],
      [{ ok: true, capable: false, revoked: false }, { selfIssued: true }],
    ] as const) {
      const d = await decide(intent, {
        ...deps(zk()),
        resolveSubject: publicRead(outcome, extra),
      });
      assert.equal(d.zkCredential?.status, "GO");
      assert.equal(d.verdict, "STOP");
    }
  });

  it("an unverified proof never rescues public absence", async () => {
    const d = await decide(intent, {
      ...deps(
        zk({
          verify: stubVerify({
            status: "unavailable",
            detail: "bb missing",
          } as VerifyOutcome),
        }),
      ),
      resolveSubject: publicRead({ ok: true, capable: false, revoked: false }),
    });
    assert.equal(d.zkCredential?.status, "UNKNOWN");
    assert.equal(d.verdict, "STOP");
  });
});

describe("Week 3: payee binding", () => {
  it("relabelled context alone can't redirect a proof: payee_hash still names the original payee", async () => {
    const label = gateContextLabel(
      DEMO_OTHER_PAYEE,
      "agent.commerce.escrow",
      "demo-1",
    );
    const relabelled: ZkProofInput = {
      ...fixture,
      contextLabel: label,
      publicInputs: { ...fixture.publicInputs, context: contextField(label) },
    };
    const d = await decide(
      {
        ...intent,
        payee: DEMO_OTHER_PAYEE,
        mandate: { payees: [DEMO_OTHER_PAYEE], maxUsd: 50 },
        zkProof: relabelled,
      },
      deps(zk()),
    );
    assert.equal(d.zkCredential?.status, "STOP");
    assert.match(d.zkCredential!.reason, /different payee/);
  });

  it(
    "rewriting payee_hash + context to another payee → bb rejects → STOP",
    { skip: noBb },
    async () => {
      const label = gateContextLabel(
        DEMO_OTHER_PAYEE,
        "agent.commerce.escrow",
        "demo-1",
      );
      const forged: ZkProofInput = {
        ...fixture,
        contextLabel: label,
        publicInputs: {
          ...fixture.publicInputs,
          payee_hash: payeeField(DEMO_OTHER_PAYEE),
          context: contextField(label),
        },
      };
      const d = await decide(
        {
          ...intent,
          payee: DEMO_OTHER_PAYEE,
          mandate: { payees: [DEMO_OTHER_PAYEE], maxUsd: 50 },
          zkProof: forged,
        },
        deps(zk({ verify: (p, pub) => verifyMembershipProof(p, pub) })),
      );
      assert.equal(d.zkCredential?.status, "STOP");
      assert.match(d.zkCredential!.reason, /failed verification/);
      assert.equal(d.verdict, "STOP");
    },
  );
});

describe("Week 3: published registry root manifest", () => {
  const ASOF = Number(fixture.publicInputs.current_time);
  const manifestPromise = demoRegistry(ASOF).then((r) => r.manifest);
  const published = async () => {
    const m = await manifestPromise;
    return { root: BigInt(m.root), asOf: m.asOf, leafCount: m.leafCount };
  };

  it("demo manifest root is the fixture's proven root", async () => {
    assert.equal((await manifestPromise).root, fieldHex(ROOT));
  });

  it("manifest root alone (no pinned roots) is trusted → GO, rootSource=manifest", async () => {
    const d = await decide(
      intent,
      deps(zk({ trustedRoots: [], rootManifest: await published() })),
    );
    assert.equal(d.zkCredential?.status, "GO", d.zkCredential?.reason ?? "");
    assert.equal(d.zkCredential?.rootSource, "manifest");
    assert.equal(d.verdict, "GO");
  });

  it("stale manifest → UNKNOWN (revocations may be missing), nullifier not burned", async () => {
    const store = new MemoryNullifierStore();
    const d = await decide(
      intent,
      deps(
        zk({
          trustedRoots: [],
          nullifiers: store,
          rootManifest: await published(),
          maxRootAgeS: 1,
        }),
      ),
    );
    assert.equal(d.zkCredential?.status, "UNKNOWN");
    assert.match(d.zkCredential!.reason, /stale/);
    assert.equal(d.verdict, "UNKNOWN");
    assert.equal(
      (await decide(intent, deps(zk({ nullifiers: store })))).zkCredential
        ?.status,
      "GO",
    );
  });

  it("pinned root bypasses manifest staleness; unusable manifest → UNKNOWN", async () => {
    const pinned = await decide(
      intent,
      deps(zk({ rootManifest: await published(), maxRootAgeS: 1 })),
    );
    assert.equal(pinned.zkCredential?.rootSource, "pinned");
    assert.equal(pinned.zkCredential?.status, "GO");
    const broken = await decide(
      intent,
      deps(zk({ trustedRoots: [], rootManifest: { error: "nope" } })),
    );
    assert.equal(broken.zkCredential?.status, "UNKNOWN");
    assert.match(broken.zkCredential!.reason, /manifest unusable: nope/);
  });

  it("loadRootManifest re-derives the root; tampered file is rejected; /api/zk/root body", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ligis-root-"));
    const good = path.join(dir, "good.json");
    const bad = path.join(dir, "bad.json");
    const m = await manifestPromise;
    writeFileSync(good, JSON.stringify(m));
    writeFileSync(bad, JSON.stringify({ ...m, leaves: m.leaves.slice(1) }));
    const ok = await loadRootManifest({
      NODE_ENV: "test",
      LIGIS_ZK_ROOT_MANIFEST: good,
    });
    assert.ok(ok && !("error" in ok));
    assert.equal(ok.published.root, ROOT);
    const tampered = await loadRootManifest({
      NODE_ENV: "test",
      LIGIS_ZK_ROOT_MANIFEST: bad,
    });
    assert.ok(tampered && "error" in tampered);
    assert.equal(await loadRootManifest({ NODE_ENV: "test" }), undefined);

    const info = await zkRootInfo(
      {
        NODE_ENV: "test",
        LIGIS_ZK_ROOT_MANIFEST: good,
        LIGIS_ZK_TRUSTED_ROOTS: "0x01",
      },
      (ASOF + 10) * 1000,
    );
    assert.deepEqual(info.pinnedRoots, [fieldHex(1n)]);
    assert.equal(info.manifest?.status, "fresh");
    assert.ok(
      info.manifest &&
        "root" in info.manifest &&
        info.manifest.root === fieldHex(ROOT),
    );
    assert.equal(info.publicInputs[1], "payee_hash");
    const stale = await zkRootInfo(
      { NODE_ENV: "test", LIGIS_ZK_ROOT_MANIFEST: good },
      (ASOF + 90_000) * 1000,
    );
    assert.equal(stale.manifest?.status, "stale");
  });
});

describe("zkProof request parsing + route wiring", () => {
  it("bodyToIntent accepts the prover's JSON and rejects malformed proofs", () => {
    const ok = bodyToIntent({
      payee: PAYEE,
      amountUsd: 25,
      purpose: "x",
      capability: "agent.commerce.escrow",
      tokenSymbol: "ZEC",
      amountBaseUnits: "25000000",
      zkProof: rawFixture,
    });
    assert.ok(typeof ok !== "string", String(ok));
    assert.equal(ok.zkProof?.publicInputs.registry_root, ROOT);
    const bad = bodyToIntent({
      payee: PAYEE,
      amountUsd: 25,
      purpose: "x",
      tokenSymbol: "ZEC",
      amountBaseUnits: "25000000",
      zkProof: { ...rawFixture, proof: "nope" },
    });
    assert.match(fromBadRequest(bad as string), /zkProof.proof/);
  });

  it("LIGIS_ZK_TRUSTED_ROOTS parses comma-separated hex roots", () => {
    assert.deepEqual(
      trustedRootsFromEnv({
        LIGIS_ZK_TRUSTED_ROOTS: ` ${rawFixture.publicInputs.registry_root}, junk ,0x01`,
      }),
      [ROOT, 1n],
    );
  });

  it("runGateDecision forwards zk deps and surfaces zkCredential", async () => {
    const out = await runGateDecision(intent, {
      env,
      resolveSubject: async () => ({
        ok: false as const,
        error: "no public read",
      }),
      zk: zk(),
    });
    assert.ok(out.ok);
    assert.equal(out.decision.zkCredential?.status, "GO");
    assert.equal(out.decision.verdict, "GO");
  });
});
