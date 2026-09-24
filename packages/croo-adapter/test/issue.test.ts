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
const SCHEMA =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const UID =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

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

function verifier(
  status: ExternalAttestation["status"] = "valid",
): AttestationVerifier {
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
  /** Each test manages the issuer key; the allowlist is cleared between them. */
  function withEnv<T>(
    env: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const saved = process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_ISSUER_PRIVATE_KEY = "0xissuer";
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    return fn().finally(() => {
      if (saved === undefined) delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
      else process.env.LIGIS_ISSUER_PRIVATE_KEY = saved;
      delete process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES;
      delete process.env.LIGIS_QUALIFY_SELF_ISSUABLE;
    });
  }

  it("refuses a capability that is not allowlisted, signing nothing", async () => {
    const { adapter, calls } = mockAdapter();

    const payload = await withEnv({}, async () => {
      const res = await handleIssue(
        request({ subject: SUBJECT, capability: "kyc.basic" }),
        { loadAdapter: async () => adapter as never, now: () => NOW },
      );
      return JSON.parse(res.deliverableText);
    });

    assert.equal(payload.service, "ligis.issue");
    assert.equal(payload.issued, false);
    assert.equal(payload.reason, "evidence-required");
    assert.ok(payload.detail.includes("kyc.basic"));
    assert.ok(payload.detail.includes("LIGIS_SELF_ISSUABLE_CAPABILITIES"));
    assert.ok(payload.evidenceShape.externalAttestation.source === "eas");
    // Nothing signed, nothing submitted — a refusal costs no gas.
    assert.equal(calls.signed.length, 0);
    assert.equal(calls.submitted.length, 0);
  });

  it("mints an allowlisted capability without evidence", async () => {
    const { adapter, calls } = mockAdapter();

    const payload = await withEnv(
      {
        LIGIS_SELF_ISSUABLE_CAPABILITIES: "data.premium,agent.commerce.escrow",
      },
      async () => {
        const res = await handleIssue(
          request({ subject: SUBJECT, capability: "data.premium" }),
          { loadAdapter: async () => adapter as never, now: () => NOW },
        );
        return JSON.parse(res.deliverableText);
      },
    );

    assert.equal(payload.capability, "data.premium");
    assert.equal(payload.provenance, null);
    assert.equal(calls.signed.length, 1);
    assert.equal(calls.submitted.length, 1);
  });

  it("still honors the legacy allowlist variable", async () => {
    const { adapter, calls } = mockAdapter();

    const payload = await withEnv(
      { LIGIS_QUALIFY_SELF_ISSUABLE: "data.premium" },
      async () => {
        const res = await handleIssue(
          request({ subject: SUBJECT, capability: "data.premium" }),
          { loadAdapter: async () => adapter as never, now: () => NOW },
        );
        return JSON.parse(res.deliverableText);
      },
    );

    assert.equal(payload.capability, "data.premium");
    assert.equal(calls.submitted.length, 1);
  });

  it("prefers the canonical allowlist when both variables are set", async () => {
    const { adapter, calls } = mockAdapter();

    const payload = await withEnv(
      {
        LIGIS_SELF_ISSUABLE_CAPABILITIES: "data.premium",
        // Legacy list would allow kyc.basic; canonical must win.
        LIGIS_QUALIFY_SELF_ISSUABLE: "kyc.basic",
      },
      async () => {
        const res = await handleIssue(
          request({ subject: SUBJECT, capability: "kyc.basic" }),
          { loadAdapter: async () => adapter as never, now: () => NOW },
        );
        return JSON.parse(res.deliverableText);
      },
    );

    assert.equal(payload.issued, false);
    assert.equal(payload.reason, "evidence-required");
    assert.equal(calls.submitted.length, 0);
  });

  it("issues with EAS provenance after policy accepts the attestation", async () => {
    const { adapter } = mockAdapter();

    const payload = await withEnv({}, async () => {
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
      return JSON.parse(res.deliverableText);
    });

    assert.equal(payload.capability, "kyc.basic");
    assert.equal(payload.provenance.source, "eas");
    assert.equal(payload.provenance.uid, UID);
    assert.deepEqual(payload.provenance.signals, [
      "source-verified",
      "attester-trusted",
      "schema-mapped",
    ]);
  });

  it("evidence unlocks a capability that is not allowlisted", async () => {
    const { adapter, calls } = mockAdapter();

    const payload = await withEnv({}, async () => {
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
      return JSON.parse(res.deliverableText);
    });

    assert.equal(payload.provenance.source, "eas");
    assert.equal(calls.submitted.length, 1);
  });

  it("rejects issuance when the external attestation fails policy", async () => {
    const { adapter, calls } = mockAdapter();

    await withEnv({}, async () => {
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
    });

    assert.equal(calls.signed.length, 0);
    assert.equal(calls.submitted.length, 0);
  });
});
