import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERSONA_ESSENTIAL_PRICING,
  buildCostComparison,
  buildTrustReceipt,
  hashManifest,
  signalCostUsd,
  type TrustDecision,
} from "../src/trust.js";
import type { EvidenceManifest } from "../src/evidence.js";

function manifest(overrides: Partial<EvidenceManifest> = {}): EvidenceManifest {
  return {
    version: 1,
    agentId: "1",
    did: "did:ligis:mock:1",
    controller: "0xcontroller",
    chainId: "mock",
    chainName: "Mock Chain",
    goal: "pay for premium RWA data",
    counterparty: "0xcounterparty",
    reasoning: { text: "", verified: false, model: "", provider: "" },
    capabilities: [],
    signals: [],
    decision: { verdict: "go", intent: "pay for premium RWA data", expiresAt: 100 },
    action: { type: "self-issue-gate-record", gated: true, txHashes: [] },
    anchoredTokenUri: "",
    recordedAt: 1000,
    ...overrides,
  };
}

function decision(overrides: Partial<TrustDecision> = {}): TrustDecision {
  return {
    counterparty: "0xcounterparty",
    intent: "pay for premium RWA data",
    amount: "10 USD",
    signals: [],
    verdict: "go",
    receipt: manifest(),
    expiresAt: 4600,
    ...overrides,
  };
}

describe("signalCostUsd", () => {
  it("reads USD costs and ignores other currencies", () => {
    assert.equal(signalCostUsd({ kind: "risk", source: "monid", verdict: "go", confidence: 90, cost: { amount: 0.0025, currency: "USD" } }), 0.0025);
    assert.equal(signalCostUsd({ kind: "risk", source: "monid", verdict: "go", confidence: 90, cost: { amount: 2, currency: "EUR" } }), undefined);
    assert.equal(signalCostUsd({ kind: "risk", source: "monid", verdict: "go", confidence: 90 }), undefined);
  });
});

describe("buildCostComparison", () => {
  it("computes savings against the Persona per-check price", () => {
    const comparison = buildCostComparison("monid", 0.0025);
    assert.equal(comparison.incumbent.name, PERSONA_ESSENTIAL_PRICING.name);
    assert.equal(comparison.incumbent.perCheckUsd, 1.5);
    assert.equal(comparison.provider.perCheckUsd, 0.0025);
    assert.equal(comparison.savingsPct, 99.8);
  });

  it("leaves savings undefined when the provider cost is unmeasured", () => {
    const comparison = buildCostComparison("monid");
    assert.equal(comparison.provider.perCheckUsd, undefined);
    assert.equal(comparison.savingsPct, undefined);
  });

  it("reports negative savings honestly when the provider costs more", () => {
    assert.equal(buildCostComparison("monid", 3).savingsPct, -100);
  });
});

describe("hashManifest", () => {
  it("is stable across key order and changes when content changes", () => {
    const a = manifest();
    const reordered = {
      action: a.action,
      recordedAt: a.recordedAt,
      anchoredTokenUri: a.anchoredTokenUri,
      decision: a.decision,
      signals: a.signals,
      capabilities: a.capabilities,
      reasoning: a.reasoning,
      counterparty: a.counterparty,
      goal: a.goal,
      chainName: a.chainName,
      chainId: a.chainId,
      controller: a.controller,
      did: a.did,
      agentId: a.agentId,
      version: 1 as const,
    };
    assert.equal(hashManifest(a), hashManifest(reordered));
    assert.match(hashManifest(a), /^0x[0-9a-f]{64}$/);
    // dropped undefined properties still distinguish manifests (text "" vs absent)
    const missingText = manifest({
      reasoning: { verified: false, model: "", provider: "" } as unknown as EvidenceManifest["reasoning"],
    });
    assert.notEqual(hashManifest(a), hashManifest(missingText));
    assert.notEqual(hashManifest(a), hashManifest(manifest({ recordedAt: 2000 })));
  });
});

describe("buildTrustReceipt", () => {
  it("sums measured risk-signal costs into the per-check comparison", () => {
    const receipt = buildTrustReceipt(
      decision({
        signals: [
          { kind: "identity", source: "mock", verdict: "go", confidence: 100 },
          { kind: "risk", source: "monid", verdict: "go", confidence: 90, cost: { amount: 0.002, currency: "USD" } },
          { kind: "risk", source: "other", verdict: "unknown", confidence: 30, cost: { amount: 0.003, currency: "USD" } },
          { kind: "capability", source: "mock", verdict: "go", confidence: 100, cost: { amount: 99, currency: "USD" } },
        ],
      }),
    );
    assert.equal(receipt.cost.provider.name, "monid+other");
    assert.equal(receipt.cost.provider.perCheckUsd, 0.005);
    assert.equal(receipt.verdict, "go");
    assert.equal(receipt.expiresAt, 4600);
    assert.match(receipt.manifestHash, /^0x[0-9a-f]{64}$/);
  });

  it("labels the provider 'none' and leaves cost unmeasured without risk signals", () => {
    const receipt = buildTrustReceipt(decision());
    assert.equal(receipt.cost.provider.name, "none");
    assert.equal(receipt.cost.provider.perCheckUsd, undefined);
  });

  it("carries storage and anchor provenance when present", () => {
    const receipt = buildTrustReceipt(decision(), {
      storage: { rootHash: "0xroot", txHash: "0xtx" },
      anchoredTokenUri: "0g://0xroot",
    });
    assert.deepEqual(receipt.storage, { rootHash: "0xroot", txHash: "0xtx" });
    assert.equal(receipt.anchoredTokenUri, "0g://0xroot");
  });
});
