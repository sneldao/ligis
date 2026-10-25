/**
 * Ligis × Zcash — Week 3 ZK gate demo (Zecathon 2026).
 *
 * One command, fully offline, no keys, no funds:
 *
 *   pnpm demo:zcash-zk
 *
 *   1. PUBLISH  build the registry root manifest from CredentialRegistry
 *               issue/revoke events + signed subject→commitment registrations
 *               (deterministic demo fixture), as an operator would with
 *               `build-root --rpc …`, and point the gate at it
 *   2. PROVE    holder proves (Noir + UltraHonk) "I hold an unexpired
 *               escrow credential for THIS payee in that root" — no subject,
 *               issuer, or leaf revealed
 *   3. GATE     /api/gate wiring (runGateDecision + zkDepsFromEnv + bb)  → GO
 *   4. REPLAY   same proof again                                       → STOP
 *   5. REDIRECT proof re-pointed at another payee                       → STOP
 *   6. NO BB    verifier unavailable                                    → UNKNOWN
 *   7. REVOKE   issuer revokes; new root published; old-root proof      → STOP
 *
 * Writes scripts/zcash-zk-demo.lastrun.txt at the repo root. Exits 1 on any
 * unexpected verdict.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { proveAndVerify, resolveToolchain } from "@ligis/circuits-zcash";
import {
  DEMO_CAPABILITY,
  DEMO_OTHER_PAYEE,
  DEMO_PAYEE,
  demoRegistryInput,
} from "@ligis/circuits-zcash/demo";
import {
  contextField,
  fieldHex,
  gateContextLabel,
  payeeField,
  PUBLIC_INPUT_ORDER,
  type MembershipPublicInputs,
} from "@ligis/circuits-zcash/fields";
import { buildRegistryRoot } from "@ligis/circuits-zcash/registry";
import { sampleRegistry } from "@ligis/circuits-zcash/sample";
import type { PaymentIntent } from "@/lib/decide";
import { runGateDecision } from "@/lib/gate-run";
import { zecAmount } from "@/lib/payment-asset";
import type { ZkProofInput } from "@/lib/zk-credential";

const lines: string[] = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};
let failures = 0;
const expect = (label: string, got: string, want: string, why = "") => {
  const ok = got === want;
  if (!ok) failures++;
  log(
    `  ${ok ? "✔" : "✖"} ${label}: ${got}${ok ? "" : ` (expected ${want})`}${why ? ` — ${why}` : ""}`,
  );
};

const tc = resolveToolchain();
if (typeof tc === "string") {
  console.error(
    `toolchain unavailable: ${tc}\n(install nargo 1.0.0-beta.22 + bb 5.0.0-nightly.20260522; see packages/circuits-zcash/README.md)`,
  );
  process.exit(1);
}

const nowS = Math.floor(Date.now() / 1000);
const dir = mkdtempSync(path.join(tmpdir(), "ligis-zk-demo-"));
const manifestFile = path.join(dir, "registry-root.json");
const input = await demoRegistryInput();

log("Ligis × Zcash — Week 3 ZK gate demo");
log(`as of ${new Date(nowS * 1000).toISOString()}`);
log();
log("1. PUBLISH registry root");
const v1 = await buildRegistryRoot({
  ...input,
  asOf: nowS,
  source: { kind: "fixture", name: "ligis-zk-demo" },
});
writeFileSync(manifestFile, JSON.stringify(v1.manifest, null, 2));
log(`  root ${v1.manifest.root}`);
log(
  `  ${v1.manifest.leafCount} leaves; skipped ${JSON.stringify(v1.manifest.skipped)}`,
);

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  LIGIS_JEV_ENABLED: "0",
  LIGIS_ZK_ROOT_MANIFEST: manifestFile,
  ...(process.env.LIGIS_ZK_BB_BIN
    ? { LIGIS_ZK_BB_BIN: process.env.LIGIS_ZK_BB_BIN }
    : {}),
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};

log();
log("2. PROVE (holder, locally)");
async function prove(nonce: string): Promise<ZkProofInput> {
  const { inputs, contextLabel } = await sampleRegistry({
    nonce,
    currentTime: BigInt(nowS),
    asOf: nowS,
  });
  const t0 = performance.now();
  const res = proveAndVerify(
    tc as Exclude<typeof tc, string>,
    inputs,
    `Demo_${nonce.replace(/\W/g, "_")}`,
  );
  if (!res.verified) throw new Error("local verify failed");
  const proof = readFileSync(path.join(res.outDir, "proof"));
  log(
    `  ${nonce}: ${proof.length}-byte UltraHonk proof in ${Math.round(performance.now() - t0)}ms; nullifier ${fieldHex(inputs.nullifier).slice(0, 18)}…`,
  );
  const publicInputs = Object.fromEntries(
    PUBLIC_INPUT_ORDER.map((k) => [k, inputs[k]]),
  ) as MembershipPublicInputs;
  return { proof: `0x${proof.toString("hex")}`, contextLabel, publicInputs };
}
const proofA = await prove("pay-001");
const proofB = await prove("pay-002");

const intentFor = (payee: string, zkProof: ZkProofInput): PaymentIntent => ({
  payee,
  amountUsd: 25,
  ...zecAmount("0.25"),
  purpose: "Release shielded ZEC for escrow settlement",
  capability: DEMO_CAPABILITY,
  mandate: { payees: [payee], maxUsd: 50, expectedUsd: 25 },
  zkProof,
});
async function gate(intent: PaymentIntent, e = env) {
  const out = await runGateDecision(intent, {
    env: e,
    // Shielded subject: no public credential read, so the proof alone
    // answers verified-payee (offline; no RPC).
    resolveSubject: async () => ({
      ok: false as const,
      error: "no public read",
    }),
  });
  if (!out.ok) throw new Error("gate errored");
  const z = out.decision.zkCredential!;
  return {
    verdict: out.decision.verdict,
    zk: `${z.status}/${z.verification}`,
    reason: z.reason,
    src: z.rootSource,
  };
}

log();
log("3. GATE");
const a = await gate(intentFor(DEMO_PAYEE, proofA));
expect("verdict", a.verdict, "GO", `zk ${a.zk} via ${a.src} root: ${a.reason}`);

log();
log("4. REPLAY same proof");
const r = await gate(intentFor(DEMO_PAYEE, proofA));
expect("verdict", r.verdict, "STOP", r.reason);

log();
log("5. REDIRECT proof to another payee");
const label = gateContextLabel(DEMO_OTHER_PAYEE, DEMO_CAPABILITY, "pay-001");
const relabel: ZkProofInput = {
  ...proofA,
  contextLabel: label,
  publicInputs: { ...proofA.publicInputs, context: contextField(label) },
};
const r1 = await gate(intentFor(DEMO_OTHER_PAYEE, relabel));
expect("relabel context only", r1.verdict, "STOP", r1.reason);
const r2 = await gate(
  intentFor(DEMO_OTHER_PAYEE, {
    ...relabel,
    publicInputs: {
      ...relabel.publicInputs,
      payee_hash: payeeField(DEMO_OTHER_PAYEE),
    },
  }),
);
expect("also rewrite payee_hash", r2.verdict, "STOP", r2.reason);

log();
log("6. VERIFIER UNAVAILABLE");
const u = await gate(intentFor(DEMO_PAYEE, proofB), {
  ...env,
  LIGIS_ZK_BB_BIN: "/nonexistent/bb",
});
expect("verdict", u.verdict, "UNKNOWN", u.reason);

log();
log("7. REVOKE + republish");
const issued = input.events.find((e) => e.type === "issued")!;
const v2 = await buildRegistryRoot({
  ...input,
  events: [
    ...input.events,
    {
      ...issued,
      type: "revoked",
      revokedAt: String(nowS),
      blockNumber: "999",
      logIndex: 0,
    } as never,
  ],
  asOf: nowS,
  source: { kind: "fixture", name: "ligis-zk-demo (after revoke)" },
});
await new Promise((res) => setTimeout(res, 20));
writeFileSync(manifestFile, JSON.stringify(v2.manifest, null, 2));
log(`  new root ${v2.manifest.root} (${v2.manifest.leafCount} leaves)`);
const rv = await gate(intentFor(DEMO_PAYEE, proofB));
expect("old-root proof", rv.verdict, "STOP", rv.reason);

log();
log(failures ? `FAILED (${failures})` : "ALL CHECKS PASSED");
writeFileSync(
  path.resolve(process.cwd(), "..", "scripts", "zcash-zk-demo.lastrun.txt"),
  `${lines.join("\n")}\n`,
);
process.exit(failures ? 1 : 0);
