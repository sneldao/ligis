/**
 * Server side of the guided Zcash demo (`/zcash`): one-click proofs for the
 * public demo registry. Enabled only when the gate trusts that registry
 * (`LIGIS_ZK_ROOT_MANIFEST=demo`), so demo proofs can never satisfy a gate
 * configured for a real registry. Proving needs nargo + bb on the server
 * (`pnpm --filter @ligis/circuits-zcash fetch-crs` + README toolchain).
 */
import "server-only";
import {
  demoProof,
  type DemoProof,
  type DemoScenario,
} from "@ligis/circuits-zcash/demo-proof";
import { DEMO_MANIFEST } from "./zk-root";

export type { DemoProof, DemoScenario };

export function zkDemoEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.LIGIS_ZK_ROOT_MANIFEST?.trim() === DEMO_MANIFEST;
}

const MAX_CONCURRENT = 2;
let inFlight = 0;

export type DemoProofResponse =
  | { ok: true; proof: DemoProof }
  | { ok: false; status: 400 | 403 | 429 | 503; error: string };

export async function runDemoProof(
  env: NodeJS.ProcessEnv,
  scenario: unknown,
  prove: typeof demoProof = demoProof,
): Promise<DemoProofResponse> {
  if (!zkDemoEnabled(env)) {
    return {
      ok: false,
      status: 403,
      error:
        "Live demo proofs are off on this server (set LIGIS_ZK_ROOT_MANIFEST=demo).",
    };
  }
  if (scenario !== "holder" && scenario !== "revoked") {
    return {
      ok: false,
      status: 400,
      error: "scenario must be holder or revoked",
    };
  }
  if (inFlight >= MAX_CONCURRENT) {
    return {
      ok: false,
      status: 429,
      error: "Prover busy — try again in a second.",
    };
  }
  inFlight++;
  try {
    const out = await prove({ scenario });
    return typeof out === "string"
      ? { ok: false, status: 503, error: `Prover unavailable: ${out}` }
      : { ok: true, proof: out };
  } finally {
    inFlight--;
  }
}
