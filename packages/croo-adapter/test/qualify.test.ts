import assert from "node:assert";
import { describe, it } from "node:test";
import { handleQualify } from "../src/qualify.js";
import { SERVICE_ID } from "../src/services.js";
import { mockVerifyResult } from "./mock-adapter.js";
import type {
  AttestationTrustPolicy,
  AttestationVerifier,
  ExternalAttestation,
  VerifyResult,
} from "@ligis/core";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const ATTESTER = "0x47e9b13e467e2db34b1aa145758b253bbd9ffa40";
const SCHEMA = "eas:kyc-v1";

function makeReq(requirements: object) {
  return {
    serviceId: SERVICE_ID.qualify,
    requirements: JSON.stringify(requirements),
  };
}

function parseResult(res: { deliverableText: string }) {
  const parsed = JSON.parse(res.deliverableText);
  for (const key of [
    "checks",
    "signals",
    "breakdown",
    "issued",
    "skipped",
    "evidence",
    "verificationPending",
    "capabilities",
    "issuedCapabilities",
    "pathToTrust",
    "pathToTrustRoute",
  ]) {
    if (typeof parsed[key] === "string") parsed[key] = JSON.parse(parsed[key]);
  }
  return parsed;
}

/**
 * Chain adapter that behaves like a real one for issuance: signing and
 * submitting a credential makes it readable on the next check.
 *
 * `flipOnSubmit: false` simulates a registry that hasn't caught up yet.
 */
class QualifyChainAdapter {
  readonly chainId = "casper-testnet";
  readonly chainName = "Casper Testnet";
  readonly explorerUrl = "https://testnet.cspr.live";

  public submitted: Array<{ capability: string; subject: string }> = [];
  private held = new Map<string, VerifyResult>();
  private flipOnSubmit: boolean;

  constructor(
    capabilities: string[],
    opts: { held?: Map<string, VerifyResult>; flipOnSubmit?: boolean } = {},
  ) {
    for (const capability of capabilities) {
      this.held.set(capability, mockVerifyResult({ capable: false }));
    }
    if (opts.held) {
      for (const [capability, result] of opts.held)
        this.held.set(capability, result);
    }
    this.flipOnSubmit = opts.flipOnSubmit ?? true;
  }

  async verifyCapability(opts: {
    subject: string;
    capability: string;
    issuer?: string;
  }): Promise<VerifyResult> {
    return (
      this.held.get(opts.capability) ?? mockVerifyResult({ capable: false })
    );
  }

  async signCredential(opts: {
    issuerKey: string;
    subject: string;
    capability: string;
    expiresInSeconds: number;
  }) {
    const issuedAt = Math.floor(NOW.getTime() / 1000);
    return {
      subject: opts.subject,
      capability: opts.capability,
      capabilityHash:
        "0x00000000000000000000000000000000000000000000000000000000000000aa",
      issuer: ATTESTER,
      issuedAt: String(issuedAt),
      expiresAt: String(issuedAt + opts.expiresInSeconds),
      signature: "0xdeadbeef",
    };
  }

  async submitCredential(signed: { capability: string; subject: string }) {
    this.submitted.push({
      capability: signed.capability,
      subject: signed.subject,
    });
    if (this.flipOnSubmit) {
      // Freshly issued and therefore immature → `warn`, not `pass`.
      //
      // Timestamps come from the wall clock, not the frozen NOW used for
      // attestation freshness: `buildRiskReport` computes TTL against real
      // time, so a credential anchored to a fixed date turns into an expired
      // credential the moment that date passes.
      const nowSeconds = Math.floor(Date.now() / 1000);
      this.held.set(
        signed.capability,
        mockVerifyResult({
          capable: true,
          capability: signed.capability,
          issuedAtSeconds: nowSeconds - 5,
          expiresAtSeconds: nowSeconds + 24 * 60 * 60,
        }),
      );
    }
    return { tx: { hash: `tx-${signed.capability}` } };
  }
}

function passingVerifier(): AttestationVerifier {
  return {
    source: "eas",
    async verify(): Promise<ExternalAttestation> {
      return {
        evidence: { source: "eas", uid: "0xuid", schema: SCHEMA },
        subject: "0xtest",
        attester: ATTESTER,
        status: "valid",
        issuedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
        claims: {},
        checkedAt: NOW.toISOString(),
      };
    },
  };
}

const POLICY: AttestationTrustPolicy = {
  acceptedSources: ["eas"],
  trustedAttesters: { eas: [ATTESTER] },
  capabilityMappings: { [SCHEMA]: "kyc.basic", "kyc-v1": "kyc.basic" },
  maxAgeSeconds: 300,
  requireFreshStatus: true,
};

/** Deterministic deps: no env, no network, no chain. */
function deps(adapter: QualifyChainAdapter, extra: object = {}) {
  return {
    loadAdapter: async () => adapter,
    verifier: passingVerifier(),
    policy: POLICY,
    now: () => NOW,
    settleDelayMs: 1,
    ...extra,
  } as never;
}

const ISSUER_KEY = "0x" + "11".repeat(32);
const ISSUE_EVIDENCE = {
  capability: "kyc.basic",
  externalAttestation: { source: "eas", uid: "0xuid", schema: "kyc-v1" },
};

describe("handleQualify", () => {
  let savedIssuerKey: string | undefined;
  const setup = () => {
    savedIssuerKey = process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_ISSUER_PRIVATE_KEY = ISSUER_KEY;
  };
  const teardown = () => {
    if (savedIssuerKey === undefined)
      delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
    else process.env.LIGIS_ISSUER_PRIVATE_KEY = savedIssuerKey;
    delete process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES;
    delete process.env.LIGIS_QUALIFY_SELF_ISSUABLE;
  };

  it("issues against passing evidence and re-checks in one order", async () => {
    setup();
    try {
      const adapter = new QualifyChainAdapter(["kyc.basic"]);
      const res = await handleQualify(
        makeReq({
          subject: "0xtest",
          capabilities: "kyc.basic",
          evidence: [ISSUE_EVIDENCE],
        }),
        deps(adapter),
      );
      const report = parseResult(res);

      assert.strictEqual(report.entryVerdict, "fail");
      assert.strictEqual(report.issuedCount, 1);
      assert.deepStrictEqual(report.issuedCapabilities, ["kyc.basic"]);
      assert.deepStrictEqual(report.skipped, []);
      // A fresh credential is immature: warn, not a fake pass.
      assert.strictEqual(report.finalVerdict, "warn");
      assert.strictEqual(report.qualified, true);
      assert.deepStrictEqual(report.verificationPending, []);
      // Provenance from the verified attestation is recorded on the credential.
      assert.strictEqual(report.issued[0].provenance.attester, ATTESTER);
      assert.strictEqual(report.issued[0].txHash, "tx-kyc.basic");
      assert.ok(report.verdictNote.includes("mature"));
      // No path-to-trust needed once qualified, but the route is still reported.
      assert.ok(
        report.pathToTrustRoute.recommended.service === SERVICE_ID.qualify,
      );
    } finally {
      teardown();
    }
  });

  it("never mints a critical capability from payment alone", async () => {
    setup();
    try {
      const adapter = new QualifyChainAdapter(["kyc.basic"]);
      const res = await handleQualify(
        makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
        deps(adapter),
      );
      const report = parseResult(res);

      assert.strictEqual(report.issuedCount, 0);
      assert.strictEqual(report.skipped.length, 1);
      assert.strictEqual(report.skipped[0].capability, "kyc.basic");
      assert.strictEqual(report.skipped[0].reason, "evidence-required");
      // The refusal names the capability and the config that would unlock it.
      assert.ok(report.skipped[0].detail.includes("Policy does not allow"));
      assert.ok(
        report.skipped[0].detail.includes("LIGIS_SELF_ISSUABLE_CAPABILITIES"),
      );
      assert.strictEqual(report.finalVerdict, "fail");
      assert.strictEqual(report.qualified, false);
      assert.deepStrictEqual(adapter.submitted, []);
      // The refusal still hands the buyer the actionable route.
      assert.ok(report.pathToTrust);
      assert.deepStrictEqual(report.pathToTrust.evidenceRequiredFor, [
        "kyc.basic",
      ]);
    } finally {
      teardown();
    }
  });

  it("mints an allowlisted capability without evidence", async () => {
    setup();
    process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES = "data.premium";
    try {
      const adapter = new QualifyChainAdapter(["data.premium"]);
      const res = await handleQualify(
        makeReq({ subject: "0xtest", capabilities: "data.premium" }),
        deps(adapter),
      );
      const report = parseResult(res);

      assert.strictEqual(report.issuedCount, 1);
      assert.strictEqual(report.issued[0].capability, "data.premium");
      // No evidence was supplied, so there is no provenance to claim.
      assert.strictEqual(report.issued[0].provenance, null);
      assert.strictEqual(report.qualified, true);
    } finally {
      teardown();
    }
  });

  it("refuses rejected evidence without failing the whole order", async () => {
    setup();
    try {
      const adapter = new QualifyChainAdapter(["kyc.basic"]);
      // Policy maps this schema to a different capability, so the decision
      // can't back kyc.basic.
      const mismatched: AttestationTrustPolicy = {
        ...POLICY,
        capabilityMappings: {
          [SCHEMA]: "identity.human-backed",
          "kyc-v1": "identity.human-backed",
        },
      };
      const res = await handleQualify(
        makeReq({
          subject: "0xtest",
          capabilities: "kyc.basic",
          evidence: [ISSUE_EVIDENCE],
        }),
        deps(adapter, { policy: mismatched }),
      );
      const report = parseResult(res);

      assert.strictEqual(report.issuedCount, 0);
      assert.strictEqual(report.skipped.length, 1);
      assert.strictEqual(report.skipped[0].reason, "evidence-rejected");
      assert.ok(
        report.skipped[0].detail.includes("External attestation rejected"),
      );
      assert.deepStrictEqual(adapter.submitted, []);
      // The buyer still receives the check they paid for.
      assert.strictEqual(report.entryVerdict, "fail");
      assert.deepStrictEqual(report.verificationPending, []);
    } finally {
      teardown();
    }
  });

  it("reports a submitted-but-unreadable credential instead of a failure", async () => {
    setup();
    try {
      // The registry never reflects the submission within the settle budget.
      const adapter = new QualifyChainAdapter(["kyc.basic"], {
        flipOnSubmit: false,
      });
      const res = await handleQualify(
        makeReq({
          subject: "0xtest",
          capabilities: "kyc.basic",
          evidence: [ISSUE_EVIDENCE],
        }),
        deps(adapter, { settleAttempts: 2 }),
      );
      const report = parseResult(res);

      assert.strictEqual(report.issuedCount, 1);
      assert.deepStrictEqual(report.verificationPending, ["kyc.basic"]);
      // Honest: the check still fails to read the credential...
      assert.strictEqual(report.finalVerdict, "fail");
      assert.strictEqual(report.qualified, false);
      // ...but the note and tx hash say why, and what to do.
      assert.ok(report.verdictNote.includes("had not caught up"));
      assert.ok(report.verdictNote.includes(SERVICE_ID.risk));
      assert.strictEqual(report.issued[0].txHash, "tx-kyc.basic");
    } finally {
      teardown();
    }
  });

  it("leaves an already-qualified subject untouched", async () => {
    setup();
    try {
      const mature = new Map<string, VerifyResult>([
        [
          "kyc.basic",
          mockVerifyResult({
            capable: true,
            capability: "kyc.basic",
            issuedAtSeconds:
              Math.floor(NOW.getTime() / 1000) - 60 * 24 * 60 * 60,
            expiresAtSeconds:
              Math.floor(NOW.getTime() / 1000) + 180 * 24 * 60 * 60,
          }),
        ],
      ]);
      const adapter = new QualifyChainAdapter(["kyc.basic"], { held: mature });
      const res = await handleQualify(
        makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
        deps(adapter),
      );
      const report = parseResult(res);

      assert.strictEqual(report.entryVerdict, "pass");
      assert.strictEqual(report.finalVerdict, "pass");
      assert.strictEqual(report.issuedCount, 0);
      assert.deepStrictEqual(adapter.submitted, []);
      // No mint, so nothing to wait on.
      assert.deepStrictEqual(report.verificationPending, []);
    } finally {
      teardown();
    }
  });

  it("rejects malformed requirements", async () => {
    await assert.rejects(
      () =>
        handleQualify(
          makeReq({ subject: "0xtest" }),
          deps(new QualifyChainAdapter([])),
        ),
      /ligis\.qualify requirements must include/,
    );
  });

  it("honors the legacy allowlist variable", async () => {
    setup();
    process.env.LIGIS_QUALIFY_SELF_ISSUABLE = "data.premium";
    try {
      const adapter = new QualifyChainAdapter(["data.premium"]);
      const res = await handleQualify(
        makeReq({ subject: "0xtest", capabilities: "data.premium" }),
        deps(adapter),
      );
      const report = parseResult(res);
      assert.strictEqual(report.issuedCount, 1);
    } finally {
      teardown();
    }
  });

  it("requires the issuer key before minting", async () => {
    delete process.env.LIGIS_ISSUER_PRIVATE_KEY;
    process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES = "data.premium";
    try {
      const adapter = new QualifyChainAdapter(["data.premium"]);
      const res = await handleQualify(
        makeReq({ subject: "0xtest", capabilities: "data.premium" }),
        deps(adapter),
      );
      const report = parseResult(res);
      assert.strictEqual(report.issuedCount, 0);
      assert.strictEqual(report.skipped[0].reason, "issuance-failed");
      assert.ok(report.skipped[0].detail.includes("LIGIS_ISSUER_PRIVATE_KEY"));
    } finally {
      teardown();
    }
  });
});
