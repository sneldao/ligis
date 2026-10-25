/**
 * Deterministic sample registry for tests and `pnpm prove:sample`.
 * Secrets here are public test fixtures — never real key material.
 */
import {
  CredentialTree,
  buildInputs,
  capabilityField,
  contextField,
  credentialLeaf,
  identityCommitment,
  issuerField,
  type CircuitInputs,
} from "./index.js";

export const SAMPLE_CAPABILITY = "agent.commerce.escrow";
export const SAMPLE_ISSUER = "0x6C500B3968C54789b518D01066Aed2990d44c068";
export const SAMPLE_NOW = 1_761_350_400n; // 2025-10-25T00:00:00Z
export const SAMPLE_EXPIRES = 1_824_422_400n; // 2027-10-25T00:00:00Z
export const SAMPLE_HOLDER_INDEX = 2;

export async function sampleRegistry(
  context = "ligis-gate:zecathon-demo:intent-1",
) {
  const cap = capabilityField(SAMPLE_CAPABILITY);
  const issuer = issuerField(SAMPLE_ISSUER);
  const secrets = [0x1001n, 0x2002n, 0xa11ce5ec12e7n, 0x4004n, 0x5005n];
  const leaves = await Promise.all(
    secrets.map(async (s, i) =>
      credentialLeaf({
        identityCommitment: await identityCommitment(s),
        capabilityHash: i === 3 ? capabilityField("kyc.basic") : cap,
        issuer,
        expiresAt: SAMPLE_EXPIRES,
        nonce: BigInt(i),
      }),
    ),
  );
  const tree = await CredentialTree.build(leaves);
  const holderSecret = secrets[SAMPLE_HOLDER_INDEX]!;
  const inputs: CircuitInputs = await buildInputs({
    tree,
    index: SAMPLE_HOLDER_INDEX,
    identitySecret: holderSecret,
    credential: {
      capabilityHash: cap,
      issuer,
      expiresAt: SAMPLE_EXPIRES,
      nonce: BigInt(SAMPLE_HOLDER_INDEX),
    },
    context: contextField(context),
    currentTime: SAMPLE_NOW,
  });
  return { tree, inputs, holderSecret };
}
