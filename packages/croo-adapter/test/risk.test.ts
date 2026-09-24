import assert from "node:assert";
import { describe, it } from "node:test";
import { handleRisk } from "../src/risk.js";
import { SERVICE_ID, SERVICE_PRICE_USD } from "../src/services.js";
import { defaultServices } from "../src/provider.js";
import { MockChainAdapter, mockVerifyResult } from "./mock-adapter.js";
import type { VerifyResult } from "@ligis/core";

function makeReq(requirements: object) {
  return {
    serviceId: "ligis.risk",
    requirements: JSON.stringify(requirements),
  };
}

function parseResult(res: { deliverableText: string }) {
  const parsed = JSON.parse(res.deliverableText);
  // The CROO deliverable flattens checks/signals/breakdown into JSON strings.
  // Unwrap them for test assertions.
  if (typeof parsed.checks === "string")
    parsed.checks = JSON.parse(parsed.checks);
  if (typeof parsed.signals === "string")
    parsed.signals = JSON.parse(parsed.signals);
  if (typeof parsed.breakdown === "string")
    parsed.breakdown = JSON.parse(parsed.breakdown);
  if (typeof parsed.pathToTrust === "string")
    parsed.pathToTrust = JSON.parse(parsed.pathToTrust);
  return parsed;
}

describe("handleRisk scoring", () => {
  it("scores 0 and verdict=fail when no credentials are held", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({ capable: false })],
      ["kyc.basic", mockVerifyResult({ capable: false })],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["agent.commerce.escrow", "kyc.basic"],
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "fail");
    assert.strictEqual(report.riskScore, 0);
    assert.strictEqual(report.checks.length, 2);
    assert.strictEqual(report.checks[0].verdict, "fail");
    assert.strictEqual(report.checks[1].verdict, "fail");
    // Critical capability missing should trigger the signal
    const signal = report.signals.find(
      (s: { code: string }) => s.code === "critical-capability-missing",
    );
    assert.ok(signal, "expected critical-capability-missing signal");
  });

  it("scores high and verdict=pass when all credentials are mature with comfortable TTL", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // 30 days ago
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60, // 180 days
        }),
      ],
      [
        "kyc.basic",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60, // 60 days ago
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 365 days
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["agent.commerce.escrow", "kyc.basic"],
        minTtlSeconds: 24 * 60 * 60, // 1 day
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "pass");
    assert.ok(
      report.riskScore >= 95,
      `expected score >= 95, got ${report.riskScore}`,
    );
    // Each check should have pass verdict
    for (const check of report.checks) {
      assert.strictEqual(check.verdict, "pass");
      assert.ok(
        check.subScore >= 95,
        `expected subScore >= 95, got ${check.subScore}`,
      );
    }
  });

  it("scores warn when credential is capable but immature (just issued)", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "agent.commerce.escrow",
        minTtlSeconds: 24 * 60 * 60,
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "warn");
    assert.ok(
      report.riskScore < 80,
      `expected score < 80 for immature credential, got ${report.riskScore}`,
    );
    const immatureSignal = report.checks[0].signals.find(
      (s: { code: string }) => s.code === "credential-immature",
    );
    assert.ok(immatureSignal, "expected credential-immature signal");
  });

  it("scores warn when TTL is below minimum", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // mature
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, // 1 hour left
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "agent.commerce.escrow",
        minTtlSeconds: 24 * 60 * 60, // require 1 day
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "warn");
    const ttlSignal = report.checks[0].signals.find(
      (s: { code: string }) => s.code === "ttl-below-minimum",
    );
    assert.ok(ttlSignal, "expected ttl-below-minimum signal");
  });

  it("downgrades to fail when critical capability has TTL below half minimum", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "kyc.basic",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, // 1 hour left, min is 1 day
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "kyc.basic",
        minTtlSeconds: 24 * 60 * 60,
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    // kyc.basic has weight 4, TTL < minTtl/2 → fail not warn
    assert.strictEqual(report.checks[0].verdict, "fail");
    assert.strictEqual(report.overallVerdict, "fail");
  });

  it("weights critical capabilities more heavily in the overall score", async () => {
    // One critical (kyc.basic, weight 4) fails, one low (data.premium, weight 1) passes
    const results = new Map<string, VerifyResult>([
      ["kyc.basic", mockVerifyResult({ capable: false })],
      [
        "data.premium",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["kyc.basic", "data.premium"],
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "fail");
    // Score should be low because the critical capability (weight 4) dominates
    // Weighted: (0*4 + 100*1) / 5 = 20
    assert.ok(
      report.riskScore <= 25,
      `expected score <= 25 when critical fails, got ${report.riskScore}`,
    );
  });

  it("detects single-issuer concentration when multiple credentials share one issuer", async () => {
    const sameIssuer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuer: sameIssuer,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
      [
        "agent.commerce.swap",
        mockVerifyResult({
          capable: true,
          issuer: sameIssuer,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["agent.commerce.escrow", "agent.commerce.swap"],
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    const concentration = report.signals.find(
      (s: { code: string }) => s.code === "single-issuer-concentration",
    );
    assert.ok(concentration, "expected single-issuer-concentration signal");
    assert.ok(
      report.breakdown.issuerDiversity <= 50,
      "expected low issuer diversity",
    );
  });

  it("reports high issuer diversity when credentials come from different issuers", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
      [
        "agent.commerce.swap",
        mockVerifyResult({
          capable: true,
          issuer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["agent.commerce.escrow", "agent.commerce.swap"],
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.breakdown.issuerDiversity, 100);
    // No concentration signal
    const concentration = report.signals.find(
      (s: { code: string }) => s.code === "single-issuer-concentration",
    );
    assert.ok(
      !concentration,
      "should not have concentration signal with diverse issuers",
    );
  });

  it("includes breakdown with all component scores", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "agent.commerce.escrow",
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.ok(typeof report.breakdown.capabilityWeighted === "number");
    assert.ok(typeof report.breakdown.ttlHealth === "number");
    assert.ok(typeof report.breakdown.tenureMaturity === "number");
    assert.ok(typeof report.breakdown.issuerDiversity === "number");
  });

  it("rejects invalid requirements", async () => {
    const adapter = new MockChainAdapter(new Map());
    await assert.rejects(
      handleRisk(makeReq({ bad: "input" }), { adapter: adapter as never }),
      /must include/,
    );
  });

  it("includes pathToTrust when capabilities are missing", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({ capable: false })],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "agent.commerce.escrow",
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.ok(
      report.pathToTrust,
      "expected pathToTrust when capability missing",
    );
    assert.deepStrictEqual(report.pathToTrust.failedCapabilities, [
      "agent.commerce.escrow",
    ]);
    // The recommended route is the one-order service, not the two-order path.
    assert.strictEqual(
      report.pathToTrust.recommended.service,
      SERVICE_ID.qualify,
    );
    assert.strictEqual(
      report.pathToTrust.recommended.priceUsd,
      SERVICE_PRICE_USD[SERVICE_ID.qualify],
    );
    assert.strictEqual(report.pathToTrust.fallback.service, SERVICE_ID.issue);
    assert.strictEqual(
      report.pathToTrust.fallback.priceUsd,
      SERVICE_PRICE_USD[SERVICE_ID.issue],
    );
    // Chain is derived from the adapter that ran the check, not hardcoded.
    assert.strictEqual(report.pathToTrust.chain, adapter.chainId);
    assert.strictEqual(report.pathToTrust.chainName, adapter.chainName);
    assert.ok(
      report.pathToTrust.hint.includes("agent.commerce.escrow"),
      "hint should name the missing capability",
    );
    assert.ok(
      report.pathToTrust.hint.includes(SERVICE_ID.qualify),
      "hint should lead with the one-order route",
    );
    assert.ok(
      !/casper/i.test(report.pathToTrust.hint),
      "hint must not hardcode Casper when the adapter is not Casper",
    );
  });

  it("quotes the same prices as the provider descriptors for both routes", async () => {
    const fallbackDescriptor = defaultServices.find(
      (s) => s.id === SERVICE_ID.issue,
    );
    const recommendedDescriptor = defaultServices.find(
      (s) => s.id === SERVICE_ID.qualify,
    );
    assert.ok(fallbackDescriptor, "expected a ligis.issue descriptor");
    assert.ok(recommendedDescriptor, "expected a ligis.qualify descriptor");

    const adapter = new MockChainAdapter(
      new Map<string, VerifyResult>([
        ["kyc.basic", mockVerifyResult({ capable: false })],
      ]),
    );
    const report = parseResult(
      await handleRisk(
        makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
        {
          adapter: adapter as never,
        },
      ),
    );

    assert.strictEqual(
      report.pathToTrust.recommended.priceUsd,
      recommendedDescriptor.priceUsd,
      "the hint price and the listing price must agree — they are quoted to the same buyer",
    );
    assert.strictEqual(
      report.pathToTrust.fallback.priceUsd,
      fallbackDescriptor.priceUsd,
      "the fallback route price must match its listing too",
    );
  });

  it("emits the CROO listing UUIDs when configured", async () => {
    const QUALIFY_LISTING = "11111111-2222-4333-8444-555555555555";
    const ISSUE_LISTING = "3b5f6e3b-a22b-4b52-925b-366656ebd47c";
    process.env.CROO_SERVICE_ID_LIGIS_QUALIFY = QUALIFY_LISTING;
    process.env.CROO_SERVICE_ID_LIGIS_ISSUE = ISSUE_LISTING;
    try {
      const adapter = new MockChainAdapter(
        new Map<string, VerifyResult>([
          ["kyc.basic", mockVerifyResult({ capable: false })],
        ]),
      );
      const report = parseResult(
        await handleRisk(
          makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
          {
            adapter: adapter as never,
          },
        ),
      );
      assert.strictEqual(
        report.pathToTrust.recommended.listingId,
        QUALIFY_LISTING,
      );
      assert.strictEqual(report.pathToTrust.fallback.listingId, ISSUE_LISTING);
    } finally {
      delete process.env.CROO_SERVICE_ID_LIGIS_QUALIFY;
      delete process.env.CROO_SERVICE_ID_LIGIS_ISSUE;
    }
  });

  it("reports null listing ids rather than faking them", async () => {
    delete process.env.CROO_SERVICE_ID_LIGIS_QUALIFY;
    delete process.env.CROO_SERVICE_ID_LIGIS_ISSUE;
    const adapter = new MockChainAdapter(
      new Map<string, VerifyResult>([
        ["kyc.basic", mockVerifyResult({ capable: false })],
      ]),
    );
    const report = parseResult(
      await handleRisk(
        makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
        {
          adapter: adapter as never,
        },
      ),
    );
    assert.strictEqual(report.pathToTrust.recommended.listingId, null);
    assert.strictEqual(report.pathToTrust.fallback.listingId, null);
  });

  it("marks critical capabilities as evidence-required by default", async () => {
    delete process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES;
    delete process.env.LIGIS_QUALIFY_SELF_ISSUABLE;
    const adapter = new MockChainAdapter(
      new Map<string, VerifyResult>([
        ["kyc.basic", mockVerifyResult({ capable: false })],
      ]),
    );
    const report = parseResult(
      await handleRisk(
        makeReq({ subject: "0xtest", capabilities: "kyc.basic" }),
        {
          adapter: adapter as never,
        },
      ),
    );
    assert.deepStrictEqual(report.pathToTrust.evidenceRequiredFor, [
      "kyc.basic",
    ]);
    assert.ok(
      report.pathToTrust.hint.includes("evidence"),
      "hint should say evidence is required for a non-allowlisted capability",
    );
  });

  it("drops the evidence requirement for allowlisted capabilities", async () => {
    process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES = "data.premium";
    try {
      const adapter = new MockChainAdapter(
        new Map<string, VerifyResult>([
          ["data.premium", mockVerifyResult({ capable: false })],
        ]),
      );
      const report = parseResult(
        await handleRisk(
          makeReq({ subject: "0xtest", capabilities: "data.premium" }),
          { adapter: adapter as never },
        ),
      );
      assert.deepStrictEqual(report.pathToTrust.evidenceRequiredFor, []);
      assert.ok(
        report.pathToTrust.hint.includes("Alternatively"),
        "an allowlisted capability should offer the fallback, not demand evidence",
      );
    } finally {
      delete process.env.LIGIS_SELF_ISSUABLE_CAPABILITIES;
    }
  });

  it("omits pathToTrust when verdict is pass", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "agent.commerce.escrow",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({ subject: "0xtest", capabilities: "agent.commerce.escrow" }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "pass");
    assert.ok(
      report.pathToTrust == null,
      "expected pathToTrust to be absent on pass verdict",
    );
  });

  it("omits pathToTrust when verdict is warn (mature credential with low TTL)", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "data.premium",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, // 1 hour left, min is 1 day
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "data.premium",
        minTtlSeconds: 24 * 60 * 60,
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.overallVerdict, "warn");
    assert.ok(
      report.pathToTrust == null,
      "expected pathToTrust to be absent on warn verdict",
    );
  });

  it("includes pathToTrust with multiple failed capabilities", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({ capable: false })],
      ["kyc.basic", mockVerifyResult({ capable: false })],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: ["agent.commerce.escrow", "kyc.basic"],
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.ok(
      report.pathToTrust,
      "expected pathToTrust when multiple capabilities missing",
    );
    assert.deepStrictEqual(report.pathToTrust.failedCapabilities, [
      "agent.commerce.escrow",
      "kyc.basic",
    ]);
    assert.ok(report.pathToTrust.hint.includes(" and "));
  });

  it("handles a single capability as a string (not array)", async () => {
    const results = new Map<string, VerifyResult>([
      [
        "data.premium",
        mockVerifyResult({
          capable: true,
          issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
        }),
      ],
    ]);
    const adapter = new MockChainAdapter(results);
    const res = await handleRisk(
      makeReq({
        subject: "0xtest",
        capabilities: "data.premium", // string, not array
      }),
      { adapter: adapter as never },
    );
    const report = parseResult(res);
    assert.strictEqual(report.checks.length, 1);
    assert.strictEqual(report.checks[0].capability, "data.premium");
    assert.strictEqual(report.checks[0].criticality, "low");
    assert.strictEqual(report.checks[0].weight, 1);
  });
});
