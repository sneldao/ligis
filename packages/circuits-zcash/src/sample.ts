/**
 * Demo holder witness for tests, fixtures, and `pnpm prove:sample`, built
 * through the real pipeline: demo registry events + signed registrations →
 * root manifest → holder locates its leaf → circuit inputs.
 * Secrets here are public test fixtures — never real key material.
 */
import {
  buildInputs,
  capabilityField,
  contextField,
  gateContextLabel,
  issuerField,
  payeeField,
} from "./index.js";
import {
  DEMO_CAPABILITY,
  DEMO_EXPIRES,
  DEMO_HOLDER_NONCE,
  DEMO_HOLDER_SECRET,
  DEMO_ISSUER,
  DEMO_PAYEE,
  demoRegistry,
} from "./demo-registry.js";
import { witnessFromManifest } from "./registry.js";

export const SAMPLE_CAPABILITY = DEMO_CAPABILITY;
export const SAMPLE_PAYEE = DEMO_PAYEE;
export const SAMPLE_NOW = 1_761_350_400n; // 2025-10-25T00:00:00Z

export async function sampleRegistry(
  opts: { nonce?: string; currentTime?: bigint; asOf?: number } = {},
) {
  const currentTime = opts.currentTime ?? SAMPLE_NOW;
  const { manifest } = await demoRegistry(opts.asOf ?? Number(currentTime));
  const w = await witnessFromManifest(manifest, {
    identitySecret: DEMO_HOLDER_SECRET,
    zcashAddress: DEMO_PAYEE,
    capability: DEMO_CAPABILITY,
    issuer: DEMO_ISSUER,
    expiresAt: DEMO_EXPIRES,
    nonce: DEMO_HOLDER_NONCE,
  });
  if (!w) throw new Error("demo holder not found in demo manifest");
  const contextLabel = gateContextLabel(
    DEMO_PAYEE,
    DEMO_CAPABILITY,
    opts.nonce ?? "demo-1",
  );
  const inputs = await buildInputs({
    tree: w.tree,
    index: w.index,
    identitySecret: DEMO_HOLDER_SECRET,
    credential: {
      payeeHash: payeeField(DEMO_PAYEE),
      capabilityHash: capabilityField(DEMO_CAPABILITY),
      issuer: issuerField(DEMO_ISSUER),
      expiresAt: DEMO_EXPIRES,
      nonce: DEMO_HOLDER_NONCE,
    },
    context: contextField(contextLabel),
    currentTime,
  });
  return { manifest, inputs, holderSecret: DEMO_HOLDER_SECRET, contextLabel };
}
