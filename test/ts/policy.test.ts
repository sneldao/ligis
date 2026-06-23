import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_CAPABILITIES,
  buildReasoningPrompt,
  parseReasoning,
  findCapability,
} from "../../src/agent/policy.js";

describe("policy — findCapability", () => {
  it("looks up a capability by name", () => {
    const cap = findCapability("agent.commerce.escrow");
    assert.equal(cap?.name, "agent.commerce.escrow");
    assert.match(cap!.hash, /^0x[0-9a-f]{64}$/);
  });

  it("looks up a capability by hash", () => {
    const escrow = findCapability("agent.commerce.escrow");
    const cap = findCapability(escrow!.hash);
    assert.equal(cap?.name, "agent.commerce.escrow");
  });

  it("returns undefined for unknown capabilities", () => {
    assert.equal(findCapability("nonexistent.cap"), undefined);
  });
});

describe("policy — buildReasoningPrompt", () => {
  it("includes the goal", () => {
    const prompt = buildReasoningPrompt("open an escrow");
    assert.ok(prompt.includes("open an escrow"));
  });

  it("includes all known capability names", () => {
    const prompt = buildReasoningPrompt("test");
    for (const cap of KNOWN_CAPABILITIES) {
      assert.ok(prompt.includes(cap.name), `prompt should include ${cap.name}`);
    }
  });

  it("instructs the LLM to return JSON", () => {
    const prompt = buildReasoningPrompt("test");
    assert.ok(prompt.includes("JSON"));
  });
});

describe("policy — parseReasoning", () => {
  it("parses a clean JSON response", () => {
    const text = JSON.stringify({
      capabilities: ["agent.commerce.escrow", "kyc.basic"],
      reasoning: "escrow requires KYC and escrow capability",
    });
    const result = parseReasoning(text);
    assert.equal(result.capabilities.length, 2);
    assert.equal(result.capabilities[0].name, "agent.commerce.escrow");
    assert.equal(result.capabilities[1].name, "kyc.basic");
    assert.equal(result.reasoning, "escrow requires KYC and escrow capability");
    assert.equal(result.unknown.length, 0);
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const text = '```json\n{"capabilities": ["agent.commerce.swap"], "reasoning": "swap"}\n```';
    const result = parseReasoning(text);
    assert.equal(result.capabilities.length, 1);
    assert.equal(result.capabilities[0].name, "agent.commerce.swap");
  });

  it("parses JSON embedded in prose", () => {
    const text = 'Here is my analysis:\n{"capabilities": ["rwa.accredited"], "reasoning": "RWA"}\nDone.';
    const result = parseReasoning(text);
    assert.equal(result.capabilities.length, 1);
    assert.equal(result.capabilities[0].name, "rwa.accredited");
  });

  it("flags unknown capabilities", () => {
    const text = JSON.stringify({
      capabilities: ["agent.commerce.escrow", "unknown.capability"],
      reasoning: "test",
    });
    const result = parseReasoning(text);
    assert.equal(result.capabilities.length, 1);
    assert.equal(result.unknown.length, 1);
    assert.equal(result.unknown[0], "unknown.capability");
  });

  it("handles empty capabilities array", () => {
    const text = JSON.stringify({ capabilities: [], reasoning: "nothing needed" });
    const result = parseReasoning(text);
    assert.equal(result.capabilities.length, 0);
    assert.equal(result.unknown.length, 0);
  });

  it("returns empty result for non-JSON text", () => {
    const result = parseReasoning("this is not JSON at all");
    assert.equal(result.capabilities.length, 0);
    assert.equal(result.unknown.length, 0);
    assert.equal(result.reasoning, "this is not JSON at all");
  });
});
