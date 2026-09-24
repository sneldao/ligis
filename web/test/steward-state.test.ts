import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY,
  apply,
  readinessOf,
  thoughtOf,
  type State,
} from "../components/steward/state.js";
import type { StewardEvent } from "../lib/steward-events.js";

function applyAll(events: StewardEvent[]): State {
  return events.reduce(apply, EMPTY);
}

const CAP_HELD: StewardEvent = {
  type: "capability",
  phase: "GATE",
  name: "kyc.basic",
  hash: "0x00",
  capable: true,
  selfIssued: false,
};

const CAP_MISSING: StewardEvent = {
  type: "capability",
  phase: "GATE",
  name: "agent.commerce.escrow",
  hash: "0x01",
  capable: false,
  selfIssued: false,
};

describe("readinessOf", () => {
  it("is 0 on the empty state", () => {
    assert.equal(readinessOf(EMPTY), 0);
  });

  it("is 5 while BOOT is running", () => {
    const s = apply(EMPTY, { type: "phase", phase: "BOOT", status: "start" });
    assert.equal(readinessOf(s), 5);
  });

  it("is 53 after GATE done with 1 of 2 capabilities held", () => {
    const s = applyAll([
      { type: "phase", phase: "BOOT", status: "done" },
      { type: "phase", phase: "REASON", status: "done" },
      { type: "phase", phase: "GATE", status: "done" },
      CAP_HELD,
      CAP_MISSING,
    ]);
    assert.equal(readinessOf(s), 53);
  });

  it("is 75 while ACT is running after GATE", () => {
    const s = applyAll([
      { type: "phase", phase: "BOOT", status: "done" },
      { type: "phase", phase: "REASON", status: "done" },
      { type: "phase", phase: "GATE", status: "done" },
      CAP_HELD,
      CAP_MISSING,
      { type: "phase", phase: "ACT", status: "start" },
    ]);
    assert.equal(readinessOf(s), 75);
  });

  it("is 100 after a full run where every phase is done", () => {
    const s = applyAll([
      { type: "phase", phase: "BOOT", status: "done" },
      { type: "phase", phase: "REASON", status: "done" },
      { type: "phase", phase: "GATE", status: "done" },
      CAP_HELD,
      { type: "phase", phase: "ACT", status: "done" },
      { type: "phase", phase: "RECORD", status: "done" },
    ]);
    assert.equal(readinessOf(s), 100);
  });
});

describe("thoughtOf", () => {
  it("returns the idle line on the empty state", () => {
    assert.equal(thoughtOf(EMPTY), "I exist, but I don't know who I am yet.");
  });

  it("reports readiness when GATE is done with nothing missing", () => {
    const s = applyAll([
      { type: "phase", phase: "BOOT", status: "done" },
      { type: "phase", phase: "REASON", status: "done" },
      { type: "phase", phase: "GATE", status: "done" },
      CAP_HELD,
    ]);
    assert.equal(thoughtOf(s), "I hold everything I need. I'm ready.");
  });
});
