import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseLastrun } from "../src/run-demo.js";
import { createJobEscrowClient } from "../src/jobescrow-client.js";
import { GENLAYER_STUDIO_NEXT } from "@ligis/core";

describe("parseLastrun", () => {
  it("extracts explorer fields from deploy.py output", () => {
    const raw = `GenLayer Agent Tank — JobEscrow lastrun
========================================
chain: studio_devnet (id 61997)
rpc: https://studio-dev.genlayer.com/api
contract_address: 0xabc123
explorer: https://explorer-studio-dev.genlayer.com/address/0xabc123
job_id: 7
final_status: resolved_refund
verdict_summary: Missing market brief
gate_proof_ref: https://testnet.cspr.live/gate?x=1
gate_chain: casper-testnet
run_at: 2026-09-16T12:00:00Z
`;
    const parsed = parseLastrun(raw, "/tmp/lastrun.txt");
    assert.equal(parsed.chainId, GENLAYER_STUDIO_NEXT.chainId);
    assert.equal(parsed.contractAddress, "0xabc123");
    assert.equal(parsed.jobId, 7);
    assert.equal(parsed.finalStatus, "resolved_refund");
    assert.match(parsed.explorer ?? "", /explorer-studio-dev/);
  });
});

describe("createJobEscrowClient", () => {
  it("requires an address", () => {
    assert.throws(
      () => createJobEscrowClient({ jobEscrowAddress: "" }),
      /required/,
    );
  });

  it("returns a client that fails fast with judge repro hint", async () => {
    const client = createJobEscrowClient({
      jobEscrowAddress: "0xdeadbeef",
    });
    assert.equal(client.address, "0xdeadbeef");
    await assert.rejects(() => client.getJob(1), /pnpm demo:genlayer/);
  });
});
