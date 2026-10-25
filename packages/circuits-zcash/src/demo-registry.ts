/**
 * Deterministic demo CredentialRegistry: events + signed subject
 * registrations, built through the same `buildRegistryRoot` path as a real
 * chain export. Every key and secret here is a PUBLIC TEST FIXTURE derived
 * from a label — never real key material, never funded.
 */
import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capabilityHashHex, fieldHex } from "./fields.js";
import { identityCommitment } from "./index.js";
import {
  buildRegistryRoot,
  registrationMessage,
  type RegistryEvent,
  type SubjectRegistration,
} from "./registry.js";

export const DEMO_CAPABILITY = "agent.commerce.escrow";
/** Demo issuer (Monad PasskeyIssuer address; used only as a field here). */
export const DEMO_ISSUER: Hex = "0x6C500B3968C54789b518D01066Aed2990d44c068";
/**
 * The demo payee: a shielded address with NO public credential on any
 * registry (unlike the `ZCASH_DEMO_*` fixtures in @ligis/core), so only a
 * zk proof can answer verified-payee for it.
 */
export const DEMO_PAYEE =
  "utest1jh85uls2r66r05ps5aww5c23qhh4yzj5jh85uls2r66r05ps5aww5c23qhh4yzj5jh85uls";
/** Holds a credential that the issuer revokes at block 110. */
export const DEMO_REVOKED_PAYEE =
  "utest1saldmx77ufmf405vgeund7zexpyf4ru0saldmx77ufmf405vgeund7zexpyf4ru0saldmx7";
export const DEMO_REVOKED_SECRET = 0x2002n;
export const DEMO_REVOKED_AT_BLOCK = 110;
export const DEMO_OTHER_PAYEE =
  "utest17l6muaech5kn4j3s0wdvt2fg8x9yrzpq7l6muaech5kn4j3s0wdvt2fg8x9yrzpqq4x0m2";
export const DEMO_EXPIRES = 1_924_992_000n; // 2031-01-01T00:00:00Z
export const DEMO_HOLDER_SECRET = 0xa11ce5ec12e7n;
export const DEMO_HOLDER_NONCE = 0n;

const fixtureKey = (label: string) =>
  keccak256(toHex(`ligis-zk-demo-fixture:${label}`));
const account = (label: string) => privateKeyToAccount(fixtureKey(label));

async function register(
  label: string,
  zcashAddress: string,
  secret: bigint,
  signer = label,
) {
  const subject = account(label).address;
  const commitment = fieldHex(await identityCommitment(secret));
  const signature = await account(signer).signMessage({
    message: registrationMessage(subject, zcashAddress, commitment),
  });
  return {
    subject,
    zcashAddress,
    identityCommitment: commitment,
    signature,
  } satisfies SubjectRegistration;
}

/** Demo events + registrations (holder, revoked, expired, other, unregistered, forged). */
export async function demoRegistryInput() {
  const cap = capabilityHashHex(DEMO_CAPABILITY);
  const kyc = capabilityHashHex("kyc.basic");
  const sub = (l: string) => account(l).address;
  let log = 0;
  const issued = (
    label: string,
    capabilityHash: Hex,
    nonce: bigint,
    expiresAt: bigint,
    block: number,
  ): RegistryEvent => ({
    type: "issued",
    issuer: DEMO_ISSUER,
    subject: sub(label),
    capabilityHash,
    nonce: nonce.toString(),
    issuedAt: "1761000000",
    expiresAt: expiresAt.toString(),
    blockNumber: String(block),
    logIndex: log++,
  });
  const events: RegistryEvent[] = [
    issued("holder", cap, DEMO_HOLDER_NONCE, DEMO_EXPIRES, 100),
    issued("revoked", cap, 0n, DEMO_EXPIRES, 101),
    issued("expired", cap, 0n, 1_761_000_100n, 102),
    issued("other", cap, 0n, DEMO_EXPIRES, 103),
    issued("other", kyc, 1n, DEMO_EXPIRES, 103),
    issued("unregistered", cap, 0n, DEMO_EXPIRES, 104),
    issued("forged", cap, 0n, DEMO_EXPIRES, 105),
    {
      type: "revoked",
      issuer: DEMO_ISSUER,
      subject: sub("revoked"),
      capabilityHash: cap,
      nonce: "0",
      revokedAt: "1761100000",
      blockNumber: String(DEMO_REVOKED_AT_BLOCK),
      logIndex: log++,
    },
  ];
  const registrations = [
    await register("holder", DEMO_PAYEE, DEMO_HOLDER_SECRET),
    await register("revoked", DEMO_REVOKED_PAYEE, DEMO_REVOKED_SECRET),
    await register("expired", DEMO_OTHER_PAYEE, 0x3003n),
    await register("other", DEMO_OTHER_PAYEE, 0x4004n),
    // Signed by the wrong key: must be rejected by the builder.
    await register("forged", DEMO_PAYEE, 0x5005n, "attacker"),
  ];
  return { events, registrations };
}

export async function demoRegistry(asOf: number) {
  const input = await demoRegistryInput();
  return buildRegistryRoot({
    ...input,
    asOf,
    source: { kind: "fixture", name: "ligis-zk-demo" },
  });
}
