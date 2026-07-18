import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateAttestationPolicy,
  type ExternalAttestation,
  type AttestationTrustPolicy,
} from "../src/attestations.js";

const NOW = Date.parse("2026-07-18T00:00:00.000Z");
const POLICY: AttestationTrustPolicy = {
  acceptedSources: ["eas"],
  trustedAttesters: { eas: ["issuer"] },
  capabilityMappings: { "eas:schema": "kyc.basic" },
  maxAgeSeconds: 300,
  requireFreshStatus: true,
};

function attestation(overrides: Partial<ExternalAttestation> = {}): ExternalAttestation {
  return {
    evidence: {
      source: "eas",
      uid: "uid",
      schema: "schema",
    },
    subject: "subject",
    attester: "issuer",
    status: "valid",
    issuedAt: "2026-07-17T23:59:00.000Z",
    expiresAt: "2026-07-18T01:00:00.000Z",
    claims: {},
    checkedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluateAttestationPolicy", () => {
  it("rejects future checkedAt values", () => {
    const decision = evaluateAttestationPolicy(
      attestation({ checkedAt: "2026-07-18T00:00:01.000Z" }),
      POLICY,
      NOW,
    );

    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.signals, ["source-stale"]);
  });

  it("rejects invalid expiry values", () => {
    const decision = evaluateAttestationPolicy(
      attestation({ expiresAt: "not-a-date" }),
      POLICY,
      NOW,
    );

    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.signals, ["expiry-invalid"]);
  });

  it("rejects future issue times", () => {
    const decision = evaluateAttestationPolicy(
      attestation({ issuedAt: "2026-07-18T00:00:01.000Z" }),
      POLICY,
      NOW,
    );

    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.signals, ["issued-at-invalid"]);
  });
});
