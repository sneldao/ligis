/**
 * Unit tests for the Stream 2 gate helper.
 *
 * Asserts the pure helpers (buildProofRef, gateFromVerifyResult) and the
 * STOP refusal contract that the orchestrator relies on. Does NOT touch
 * the Casper/Pharos adapters — those need a live testnet and live keys.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DEFAULT_GATE_CAPABILITY,
  DEFAULT_GATE_CHAIN,
  GateRefusedError,
  gateFromVerifyResult,
} from "../src/check-gate.js";
import {
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_DEFAULT_LIGIS_CHAIN,
  type GateReceipt,
  type VerifyResult,
} from "@ligis/core";

function fakeVerify(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    capable: false,
    capabilityHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    subject: "account-hash-deadbeef",
    capability: "agent.commerce.escrow",
    latest: {
      issuer: "0x" + "11".repeat(20),
      issuedAt: "1700000000",
      expiresAt: "1702592000",
      revoked: false,
      valid: true,
    },
    ...overrides,
  };
}

describe("DEFAULT_GATE_CHAIN + DEFAULT_GATE_CAPABILITY", () => {
  it("match the frozen GenLayer defaults", () => {
    // Same constants live in @ligis/core/src/genlayer.ts. Asserting here so a
    // drift in either side breaks loudly.
    assert.equal(DEFAULT_GATE_CHAIN, GENLAYER_DEFAULT_LIGIS_CHAIN);
    assert.equal(DEFAULT_GATE_CAPABILITY, GENLAYER_DEFAULT_CAPABILITY);
  });
});

describe("gateFromVerifyResult", () => {
  it("maps a GO VerifyResult onto a GO GateReceipt", () => {
    const verify = fakeVerify({ capable: true });
    const receipt = gateFromVerifyResult(
      verify,
      "casper-testnet",
      "account-hash-deadbeef",
      "agent.commerce.escrow",
    );
    assert.equal(receipt.capable, true);
    assert.equal(receipt.ligisChain, "casper-testnet");
    assert.equal(receipt.capability, "agent.commerce.escrow");
    assert.match(receipt.proofRef, /^https:\/\/testnet\.cspr\.live\//);
    assert.equal(receipt.subject, "account-hash-deadbeef");
    assert.equal(receipt.checkedAt, Math.floor(Date.now() / 1000));
  });

  it("maps a STOP VerifyResult onto a STOP GateReceipt (no throw)", () => {
    const verify = fakeVerify({ capable: false });
    const receipt = gateFromVerifyResult(
      verify,
      "pharos-atlantic",
      "0xabc",
      "agent.commerce.escrow",
    );
    assert.equal(receipt.capable, false);
    assert.equal(receipt.ligisChain, "pharos-atlantic");
    assert.match(receipt.proofRef, /^https:\/\/atlantic\.pharosscan\.xyz\//);
  });

  it("accepts an explicit proofRef override", () => {
    const verify = fakeVerify({ capable: true });
    const receipt = gateFromVerifyResult(
      verify,
      "casper-testnet",
      "x",
      "agent.commerce.escrow",
      "0xdeadbeef",
    );
    assert.equal(receipt.proofRef, "0xdeadbeef");
  });

  it("falls back to capabilityHash() when verify.capabilityHash is missing", () => {
    const verify: VerifyResult = {
      ...fakeVerify({ capable: true }),
      capabilityHash: undefined as unknown as `0x${string}`,
    };
    const receipt = gateFromVerifyResult(
      verify,
      "casper-testnet",
      "x",
      "agent.commerce.escrow",
    );
    assert.match(
      receipt.capabilityHash ?? "",
      /^0x[0-9a-f]{64}$/,
      "capabilityHash should be a 32-byte hex string",
    );
  });
});

describe("GateRefusedError", () => {
  function stopReceipt(): GateReceipt {
    return {
      subject: "account-hash-stop",
      capability: "agent.commerce.escrow",
      capable: false,
      ligisChain: "casper-testnet",
      proofRef: "verify:casper-testnet:0xabc:account-hash-stop",
      checkedAt: 1700000000,
      capabilityHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    };
  }

  it("is an Error subclass with the Ligis gate name", () => {
    const err = new GateRefusedError(stopReceipt());
    assert.ok(err instanceof Error);
    assert.equal(err.name, "GateRefusedError");
  });

  it("attaches the GateReceipt that triggered the refusal", () => {
    const receipt = stopReceipt();
    const err = new GateRefusedError(receipt);
    assert.equal(err.receipt, receipt);
    assert.equal(err.receipt.capable, false);
  });

  it("includes subject + capability + chain + proof_ref in the message", () => {
    const err = new GateRefusedError(stopReceipt());
    assert.match(err.message, /subject=account-hash-stop/);
    assert.match(err.message, /capability=agent\.commerce\.escrow/);
    assert.match(err.message, /chain=casper-testnet/);
    assert.match(err.message, /proof_ref=verify:/);
  });

  it("documents that a GO receipt never constructs GateRefusedError", () => {
    // The orchestrator must inspect receipt.capable before calling the
    // wrapper. Constructing with a GO receipt is fine for inspection, but
    // should never happen in production flow.
    const go = { ...stopReceipt(), capable: true };
    const err = new GateRefusedError(go);
    assert.equal(err.receipt.capable, true);
  });
});
