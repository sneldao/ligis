import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAttestationPolicy, type AttestationTrustPolicy } from "@ligis/core";
import {
  EAS_ZERO_UID,
  EasAttestationVerifier,
  normalizeEasAttestation,
  type EasAttestationRecord,
} from "../src/eas.js";

const UID = "0x1111111111111111111111111111111111111111111111111111111111111111";
const SCHEMA = "0x2222222222222222222222222222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const ATTESTER = "0x4444444444444444444444444444444444444444";
const EAS_ADDRESS = "0x5555555555555555555555555555555555555555";
const CHECKED_AT = new Date("2026-07-18T00:00:00.000Z");
const CHECKED_AT_SECONDS = BigInt(Math.floor(CHECKED_AT.getTime() / 1000));

function record(overrides: Partial<EasAttestationRecord> = {}): EasAttestationRecord {
  return {
    uid: UID,
    schema: SCHEMA,
    time: CHECKED_AT_SECONDS - 60n,
    expirationTime: CHECKED_AT_SECONDS + 3600n,
    revocationTime: 0n,
    refUID: EAS_ZERO_UID,
    recipient: RECIPIENT,
    attester: ATTESTER,
    revocable: true,
    data: "0x1234",
    ...overrides,
  };
}

describe("normalizeEasAttestation", () => {
  it("normalizes an active EAS attestation into ExternalAttestation", () => {
    const attestation = normalizeEasAttestation(record(), {
      chainId: 8453,
      checkedAt: CHECKED_AT,
      decodeClaims: () => ({ kyc: true }),
    });

    assert.equal(attestation.evidence.source, "eas");
    assert.equal(attestation.evidence.uid, UID);
    assert.equal(attestation.evidence.schema, SCHEMA);
    assert.equal(attestation.evidence.chainId, "8453");
    assert.match(attestation.evidence.dataHash!, /^0x[0-9a-f]{64}$/);
    assert.equal(attestation.subject, RECIPIENT);
    assert.equal(attestation.attester, ATTESTER);
    assert.equal(attestation.status, "valid");
    assert.deepEqual(attestation.claims, { kyc: true });
  });

  it("marks missing, revoked, and expired attestations fail-closed", () => {
    assert.equal(
      normalizeEasAttestation(record({ uid: EAS_ZERO_UID }), {
        chainId: 8453,
        checkedAt: CHECKED_AT,
      }).status,
      "invalid",
    );
    assert.equal(
      normalizeEasAttestation(record({ revocationTime: CHECKED_AT_SECONDS - 1n }), {
        chainId: 8453,
        checkedAt: CHECKED_AT,
      }).status,
      "revoked",
    );
    assert.equal(
      normalizeEasAttestation(record({ expirationTime: CHECKED_AT_SECONDS }), {
        chainId: 8453,
        checkedAt: CHECKED_AT,
      }).status,
      "expired",
    );
  });
});

describe("EasAttestationVerifier", () => {
  it("reads EAS and produces an attestation that policy can accept", async () => {
    const client = {
      async readContract(args: { address: string; functionName: string; args: string[] }) {
        assert.equal(args.address, EAS_ADDRESS);
        assert.equal(args.functionName, "getAttestation");
        assert.deepEqual(args.args, [UID]);
        return record();
      },
    };
    const verifier = new EasAttestationVerifier({
      client: client as never,
      easAddress: EAS_ADDRESS,
      chainId: 8453,
      now: () => CHECKED_AT,
    });

    const attestation = await verifier.verify({
      source: "eas",
      subject: RECIPIENT,
      reference: { source: "eas", uid: UID },
    });
    const policy: AttestationTrustPolicy = {
      acceptedSources: ["eas"],
      trustedAttesters: { eas: [ATTESTER] },
      capabilityMappings: { [`eas:${SCHEMA}`]: "kyc.basic" },
      maxAgeSeconds: 300,
      requireFreshStatus: true,
    };

    const decision = evaluateAttestationPolicy(
      attestation,
      policy,
      CHECKED_AT.getTime(),
    );

    assert.equal(decision.accepted, true);
    assert.equal(decision.capability, "kyc.basic");
  });

  it("rejects non-EAS verification requests", async () => {
    const verifier = new EasAttestationVerifier({
      client: { async readContract() { return record(); } } as never,
      easAddress: EAS_ADDRESS,
      chainId: 8453,
      now: () => CHECKED_AT,
    });

    await assert.rejects(
      verifier.verify({
        source: "self",
        subject: RECIPIENT,
        reference: { source: "self", uid: UID },
      }),
      /only accepts EAS/,
    );
  });

  it("marks subject and schema mismatches invalid", async () => {
    const verifier = new EasAttestationVerifier({
      client: { async readContract() { return record(); } } as never,
      easAddress: EAS_ADDRESS,
      chainId: 8453,
      now: () => CHECKED_AT,
    });

    const wrongSubject = await verifier.verify({
      source: "eas",
      subject: "0x6666666666666666666666666666666666666666",
      reference: { source: "eas", uid: UID, schema: SCHEMA },
    });
    const wrongSchema = await verifier.verify({
      source: "eas",
      subject: RECIPIENT,
      reference: {
        source: "eas",
        uid: UID,
        schema: "0x7777777777777777777777777777777777777777777777777777777777777777",
      },
    });

    assert.equal(wrongSubject.status, "invalid");
    assert.equal(wrongSchema.status, "invalid");
  });

  it("rejects malformed attestation UIDs before reading EAS", async () => {
    let reads = 0;
    const verifier = new EasAttestationVerifier({
      client: { async readContract() { reads += 1; return record(); } } as never,
      easAddress: EAS_ADDRESS,
      chainId: 8453,
      now: () => CHECKED_AT,
    });

    await assert.rejects(
      verifier.verify({
        source: "eas",
        subject: RECIPIENT,
        reference: { source: "eas", uid: "0x1234" },
      }),
      /bytes32 hex/,
    );
    assert.equal(reads, 0);
  });
});
