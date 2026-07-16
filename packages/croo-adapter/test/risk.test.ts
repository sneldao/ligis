import assert from "node:assert";
import { describe, it } from "node:test";
import { handleRisk } from "../src/risk.js";
import { MockChainAdapter, mockVerifyResult } from "./mock-adapter.js";
import type { VerifyResult } from "@ligis/core";

function makeReq(requirements: object) {
  return {
    serviceId: "ligis.risk",
    requirements: JSON.stringify(requirements),
  };
}

function parseResult(res: { deliverableText: string }) {
  return JSON.parse(res.deliverableText);
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
    const signal = report.signals.find((s: { code: string }) => s.code === "critical-capability-missing");
    assert.ok(signal, "expected critical-capability-missing signal");
  });

  it("scores high and verdict=pass when all credentials are mature with comfortable TTL", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // 30 days ago
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60, // 180 days
      })],
      ["kyc.basic", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60, // 60 days ago
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 365 days
      })],
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
    assert.ok(report.riskScore >= 95, `expected score >= 95, got ${report.riskScore}`);
    // Each check should have pass verdict
    for (const check of report.checks) {
      assert.strictEqual(check.verdict, "pass");
      assert.ok(check.subScore >= 95, `expected subScore >= 95, got ${check.subScore}`);
    }
  });

  it("scores warn when credential is capable but immature (just issued)", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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
    assert.ok(report.riskScore < 80, `expected score < 80 for immature credential, got ${report.riskScore}`);
    const immatureSignal = report.checks[0].signals.find((s: { code: string }) => s.code === "credential-immature");
    assert.ok(immatureSignal, "expected credential-immature signal");
  });

  it("scores warn when TTL is below minimum", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // mature
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, // 1 hour left
      })],
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
    const ttlSignal = report.checks[0].signals.find((s: { code: string }) => s.code === "ttl-below-minimum");
    assert.ok(ttlSignal, "expected ttl-below-minimum signal");
  });

  it("downgrades to fail when critical capability has TTL below half minimum", async () => {
    const results = new Map<string, VerifyResult>([
      ["kyc.basic", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, // 1 hour left, min is 1 day
      })],
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
      ["data.premium", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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
    assert.ok(report.riskScore <= 25, `expected score <= 25 when critical fails, got ${report.riskScore}`);
  });

  it("detects single-issuer concentration when multiple credentials share one issuer", async () => {
    const sameIssuer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuer: sameIssuer,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
      ["agent.commerce.swap", mockVerifyResult({
        capable: true,
        issuer: sameIssuer,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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
    const concentration = report.signals.find((s: { code: string }) => s.code === "single-issuer-concentration");
    assert.ok(concentration, "expected single-issuer-concentration signal");
    assert.ok(report.breakdown.issuerDiversity <= 50, "expected low issuer diversity");
  });

  it("reports high issuer diversity when credentials come from different issuers", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
      ["agent.commerce.swap", mockVerifyResult({
        capable: true,
        issuer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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
    const concentration = report.signals.find((s: { code: string }) => s.code === "single-issuer-concentration");
    assert.ok(!concentration, "should not have concentration signal with diverse issuers");
  });

  it("includes breakdown with all component scores", async () => {
    const results = new Map<string, VerifyResult>([
      ["agent.commerce.escrow", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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

  it("handles a single capability as a string (not array)", async () => {
    const results = new Map<string, VerifyResult>([
      ["data.premium", mockVerifyResult({
        capable: true,
        issuedAtSeconds: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60,
      })],
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
