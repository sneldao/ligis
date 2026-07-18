import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AttestationVerifier,
  ExternalAttestation,
  SignedCredential,
} from "@ligis/core";
import { handleIssue } from "../src/issue.js";

const NOW = new Date("2026-07-18T00:00:00.000Z");
const SUBJECT = "0x3333333333333333333333333333333333333333";
const ATTESTER = "0x4444444444444444444444444444444444444444";
const SCHEMA = "0x2222222222222222222222222222222222222222222222222222222222222222";
const UID = "0x1111111111111111111111111111111111111111111111111111111111111111";

function request(requirements: object) {
  return {
    serviceId: "ligis.issue",
    requirements: JSON.stringify(requirements),
  };
}

function mockAdapter() {
  const calls: {
    signed: Array<{ issuerKey: string; subject: string; capability: string }>;
    submitted: SignedCredential[];
  } = { signed: [], submitted: [] };

  return {
    calls,
    adapter: {
      async signCredential(opts: {
        issuerKey: string;
        subject: string;
        capability: string;
      }): Promise<SignedCredential> {
        calls.signed.push(opts);
        return {
          issuer: ATTESTER,
          subject: opts.subject,
          capabilityHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          issuedAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-19T00:00:00.000Z",
          nonce: "1",
          digest:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          signature: "0xsig",
        };
      },
      async submitCredential(signed: SignedCredential) {
        calls.submitted.push(signed);
        return { tx: { hash: "0xtx" } };
      },
    },
  };
}

function verifier(status: ExternalAttestation["status"] = "valid"): AttestationVerifier {
  return {
    source: "eas",
    async verify(): Promise<ExternalAttestation> {
      return {
        evidence: {
          source: "eas",
          uid: UID,
          chainId: "8453",
          schema: SCHEMA,
          dataHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        subject: SUBJECT,
        attester: ATTESTER,
        status,
        issuedAt: "2026-07-17T23:59:00.000Z",
        expiresAt: "2026-07-19T00:00:00.000Z",
        claims: { kyc: true },
        checkedAt: NOW.toISOString(),
      };
    },
  };
}

describe("handleIssue", () => {
  it("keeps the legacy self-issued path when no external attestation is supplied", async () => {
    const previous = process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_ISSUER_PRIVATE_KEY = "0xissuer";
    const { adapter, calls } = mockAdapter();

    try {
      const res = await handleIssue(
        request({ subject: SUBJECT, capability: "kyc.basic" }),
        { loadAdapter: async () => adapter as never, now: () => NOW },
      );
      const payload = JSON.parse(res.deliverableText);

      assert.equal(payload.service, "ligis.issue");
      assert.equal(payload.provenance, null);
      assert.equal(calls.signed.length, 1);
      assert.equal(calls.submitted.length, 1);
    } finally {
      if (previous === undefined) delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
      else process.env.LIGIS_ISSUER_PRIVATE_KEY = previous;
    }
  });

  it("issues with EAS provenance after policy accepts the attestation", async () => {
    const previous = process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_ISSUER_PRIVATE_KEY = "0xissuer";
    const { adapter } = mockAdapter();

    try {
      const res = await handleIssue(
        request({
          subject: SUBJECT,
          capability: "kyc.basic",
          externalAttestation: { source: "eas", uid: UID, schema: SCHEMA },
        }),
        {
          loadAdapter: async () => adapter as never,
          verifier: verifier(),
          policy: {
            acceptedSources: ["eas"],
            trustedAttesters: { eas: [ATTESTER] },
            capabilityMappings: { [`eas:${SCHEMA}`]: "kyc.basic" },
            maxAgeSeconds: 300,
            requireFreshStatus: true,
          },
          now: () => NOW,
        },
      );
      const payload = JSON.parse(res.deliverableText);

      assert.equal(payload.capability, "kyc.basic");
      assert.equal(payload.provenance.source, "eas");
      assert.equal(payload.provenance.uid, UID);
      assert.deepEqual(payload.provenance.signals, [
        "source-verified",
        "attester-trusted",
        "schema-mapped",
      ]);
    } finally {
      if (previous === undefined) delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
      else process.env.LIGIS_ISSUER_PRIVATE_KEY = previous;
    }
  });

  it("rejects issuance when the external attestation fails policy", async () => {
    const previous = process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_ISSUER_PRIVATE_KEY = "0xissuer";
    const { adapter, calls } = mockAdapter();

    try {
      await assert.rejects(
        handleIssue(
          request({
            subject: SUBJECT,
            capability: "kyc.basic",
            externalAttestation: { source: "eas", uid: UID, schema: SCHEMA },
          }),
          {
            loadAdapter: async () => adapter as never,
            verifier: verifier("revoked"),
            policy: {
              acceptedSources: ["eas"],
              trustedAttesters: { eas: [ATTESTER] },
              capabilityMappings: { [`eas:${SCHEMA}`]: "kyc.basic" },
              maxAgeSeconds: 300,
              requireFreshStatus: true,
            },
            now: () => NOW,
          },
        ),
        /External attestation rejected/,
      );
      assert.equal(calls.signed.length, 0);
      assert.equal(calls.submitted.length, 0);
    } finally {
      if (previous === undefined) delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
      else process.env.LIGIS_ISSUER_PRIVATE_KEY = previous;
    }
  });
});
