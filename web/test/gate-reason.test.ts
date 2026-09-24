import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateReason } from "../lib/gate-reason.js";

const NOW = 1_800_000_000n;

describe("gateReason", () => {
  it("returns go when capable", () => {
    const r = gateReason({ capable: true, revoked: true, expiresAt: 1n }, NOW);
    assert.equal(r.kind, "go");
    assert.match(r.text, /may proceed/);
  });

  it("revoked beats expired", () => {
    const r = gateReason(
      { capable: false, revoked: true, expiresAt: NOW - 1n },
      NOW,
    );
    assert.equal(r.kind, "revoked");
    assert.match(r.text, /revoked by its issuer/);
  });

  it("returns expired when expiresAt is in the past", () => {
    const r = gateReason(
      { capable: false, revoked: false, expiresAt: NOW - 60n },
      NOW,
    );
    assert.equal(r.kind, "expired");
    assert.match(r.text, /expired/);
  });

  it("treats expiresAt of 0 as no expiry → none", () => {
    const r = gateReason(
      { capable: false, revoked: false, expiresAt: 0n },
      NOW,
    );
    assert.equal(r.kind, "none");
  });

  it("null expiresAt and not revoked → none", () => {
    const r = gateReason(
      { capable: false, revoked: false, expiresAt: null },
      NOW,
    );
    assert.equal(r.kind, "none");
    assert.match(r.text, /No verifiable authorization/);
  });

  it("future expiry but not capable → none (not yet expired)", () => {
    const r = gateReason(
      { capable: false, revoked: false, expiresAt: NOW + 3600n },
      NOW,
    );
    assert.equal(r.kind, "none");
  });
});
