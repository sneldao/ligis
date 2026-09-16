import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENLAYER_DEFAULT_CAPABILITY,
  GENLAYER_STUDIO_NEXT,
  buildGateReceipt,
  createJobCallArgs,
  gateReceiptFromJson,
  gateReceiptToJsonString,
  jobViewFromContract,
} from "../src/genlayer.js";
import { capabilityHash } from "../src/hash.js";

describe("genlayer interface freeze v1", () => {
  it("locks Studio Next chain id 61997", () => {
    assert.equal(GENLAYER_STUDIO_NEXT.chainId, 61997);
    assert.match(
      GENLAYER_STUDIO_NEXT.explorerAddressUrl("0xabc"),
      /explorer-studio-dev\.genlayer\.com\/address\/0xabc/,
    );
  });

  it("builds GateReceipt with capabilityHash parity", () => {
    const receipt = buildGateReceipt({
      subject: "account-hash-deadbeef",
      capability: GENLAYER_DEFAULT_CAPABILITY,
      capable: true,
      ligisChain: "casper-testnet",
      proofRef: "https://ligis.vercel.app/gate?chain=casper-testnet",
      checkedAt: 1_700_000_000,
    });
    assert.equal(
      receipt.capabilityHash,
      capabilityHash(GENLAYER_DEFAULT_CAPABILITY),
    );
    const json = gateReceiptToJsonString(receipt);
    assert.match(json, /"capable":true/);
    assert.match(json, /"ligis_chain":"casper-testnet"/);
    const roundTrip = gateReceiptFromJson(JSON.parse(json));
    assert.equal(roundTrip.subject, receipt.subject);
    assert.equal(roundTrip.capable, true);
  });

  it("flattens create_job call args for genlayer-js", () => {
    const gate = buildGateReceipt({
      subject: "0xseller",
      capability: "agent.commerce.escrow",
      capable: true,
      ligisChain: "casper-testnet",
      proofRef: "tx:0x1",
      checkedAt: 42,
    });
    const args = createJobCallArgs({
      seller: "0xgenlayerSeller",
      brief: "Must include LIGIS_GATE_OK",
      requiredCapability: "agent.commerce.escrow",
      gate,
      valueWei: 10n ** 18n,
    });
    assert.equal(args.length, 4);
    assert.equal(args[0], "0xgenlayerSeller");
    assert.equal(args[2], "agent.commerce.escrow");
    assert.equal(typeof args[3], "string");
  });

  it("parses get_job JSON into JobView", () => {
    const view = jobViewFromContract({
      id: 1,
      buyer: "0xb",
      seller: "0xs",
      brief: "brief",
      stake: 100,
      status: "disputed",
      evidence_uri: "https://example.com/d",
      dispute_reason: "incomplete",
      verdict_summary: "",
      required_capability: "agent.commerce.escrow",
      subject: "account-hash-x",
      created_at: 1,
      delivered_at: 2,
      disputed_at: 3,
      resolved_at: 0,
      claimed: false,
    });
    assert.equal(view.status, "disputed");
    assert.equal(view.evidenceUri, "https://example.com/d");
  });
});
