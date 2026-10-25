/**
 * Gate ZK credential proofs (Zecathon Week 2): real UltraHonk fixture from
 * packages/circuits-zcash, verified with `bb` when present, plus stubbed
 * verifiers so every policy branch runs without the toolchain.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    assert.match(wrongPayee.zkCredential!.reason, /not bound to this payee/);
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
