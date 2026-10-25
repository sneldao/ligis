/**
 * Live demo proofs for the guided Zcash flow (`/zcash` in the web app).
 *
 * Everything here is a public fixture (see `demo-registry.ts`): the holder
 * secrets are constants, so this proves nothing about a real person. It
 * exists so a first-time visitor can generate a real UltraHonk proof with
 * one click instead of pasting 14 KB of JSON from a CLI.
 *
 *   holder  — the demo payee proves its escrow credential against the
 *             current published root.
 *   revoked — a holder whose credential was revoked at block 110 proves
 *             against the last root that still contained it. The proof is
 *             valid, but the gate no longer trusts that root.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_CAPABILITY,
  DEMO_EXPIRES,
  DEMO_ISSUER,
  DEMO_PAYEE,
  DEMO_REVOKED_AT_BLOCK,
  DEMO_REVOKED_PAYEE,
  DEMO_REVOKED_SECRET,
  demoRegistryInput,
} from "./demo-registry.js";
import {
  PUBLIC_INPUT_ORDER,
  capabilityField,
  contextField,
  fieldHex,
  gateContextLabel,
  issuerField,
  payeeField,
} from "./fields.js";
import { buildInputs, type CircuitInputs } from "./index.js";
import { buildRegistryRoot, witnessFromManifest } from "./registry.js";
import { sampleRegistry } from "./sample.js";
import {
  CIRCUIT_DIR,
  proveAndVerify,
  resolveToolchain,
  type Toolchain,
} from "./toolchain.js";

export type DemoScenario = "holder" | "revoked";

export type DemoProof = {
  scenario: DemoScenario;
  payee: string;
  capability: string;
  /** The root this proof was made against. */
  root: `0x${string}`;
  provedInMs: number;
  proofBytes: number;
  /** Ready to send as `zkProof` to `POST /api/gate`. */
  zkProof: {
    proof: `0x${string}`;
    contextLabel: string;
    publicInputs: Record<(typeof PUBLIC_INPUT_ORDER)[number], string>;
  };
};

async function revokedInputs(nonce: string, now: number) {
  const input = await demoRegistryInput();
  // The registry as it stood just before the revocation.
  const before = await buildRegistryRoot({
    events: input.events.filter(
      (e) => Number(e.blockNumber) < DEMO_REVOKED_AT_BLOCK,
    ),
    registrations: input.registrations,
    asOf: now,
    source: { kind: "fixture", name: "ligis-zk-demo (pre-revocation)" },
  });
  const w = await witnessFromManifest(before.manifest, {
    identitySecret: DEMO_REVOKED_SECRET,
    zcashAddress: DEMO_REVOKED_PAYEE,
    capability: DEMO_CAPABILITY,
    issuer: DEMO_ISSUER,
    expiresAt: DEMO_EXPIRES,
    nonce: 0n,
  });
  if (!w) throw new Error("revoked demo credential missing from snapshot");
  const contextLabel = gateContextLabel(
    DEMO_REVOKED_PAYEE,
    DEMO_CAPABILITY,
    nonce,
  );
  const inputs = await buildInputs({
    tree: w.tree,
    index: w.index,
    identitySecret: DEMO_REVOKED_SECRET,
    credential: {
      payeeHash: payeeField(DEMO_REVOKED_PAYEE),
      capabilityHash: capabilityField(DEMO_CAPABILITY),
      issuer: issuerField(DEMO_ISSUER),
      expiresAt: DEMO_EXPIRES,
      nonce: 0n,
    },
    context: contextField(contextLabel),
    currentTime: BigInt(now),
  });
  return { inputs, contextLabel };
}

/**
 * Prove a demo scenario with the local nargo + bb. Returns a reason string
 * when the toolchain is unavailable or proving fails.
 */
export async function demoProof(opts: {
  scenario: DemoScenario;
  nonce?: string;
  /** Unix seconds. Default now. */
  now?: number;
  toolchain?: Toolchain;
}): Promise<DemoProof | string> {
  const tc = opts.toolchain ?? resolveToolchain();
  if (typeof tc === "string") return tc;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? `demo-${randomBytes(6).toString("hex")}`;
  let inputs: CircuitInputs;
  let contextLabel: string;
  if (opts.scenario === "holder") {
    ({ inputs, contextLabel } = await sampleRegistry({
      nonce,
      currentTime: BigInt(now),
      asOf: now,
    }));
  } else {
    ({ inputs, contextLabel } = await revokedInputs(nonce, now));
  }
  // Unique witness name so concurrent requests don't collide.
  const name = `Demo_${randomBytes(6).toString("hex")}`;
  const t0 = Date.now();
  try {
    const res = proveAndVerify(tc, inputs, name);
    if (!res.verified) return "local verification of the demo proof failed";
    const proof = readFileSync(join(res.outDir, "proof"));
    const publicInputs = Object.fromEntries(
      PUBLIC_INPUT_ORDER.map((k) => [
        k,
        k === "current_time" ? inputs[k].toString() : fieldHex(inputs[k]),
      ]),
    ) as DemoProof["zkProof"]["publicInputs"];
    return {
      scenario: opts.scenario,
      payee: opts.scenario === "holder" ? DEMO_PAYEE : DEMO_REVOKED_PAYEE,
      capability: DEMO_CAPABILITY,
      root: fieldHex(inputs.registry_root),
      provedInMs: Date.now() - t0,
      proofBytes: proof.length,
      zkProof: {
        proof: `0x${proof.toString("hex")}`,
        contextLabel,
        publicInputs,
      },
    };
  } catch (err) {
    return `proving failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  } finally {
    for (const p of [
      join(CIRCUIT_DIR, `${name}.toml`),
      join(CIRCUIT_DIR, "target", `${name}.gz`),
      join(CIRCUIT_DIR, "target", name),
    ]) {
      rmSync(p, { recursive: true, force: true });
    }
  }
}
