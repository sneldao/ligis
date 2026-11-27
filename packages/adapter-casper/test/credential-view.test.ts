import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCredentialViewBytes } from "../src/operations.js";

const ISSUER = Buffer.from("11".repeat(20), "hex");
const SUBJECT = Buffer.from("22".repeat(32), "hex");

function clValue(payload: Buffer): { bytes: string } {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(payload.length, 0);
  return { bytes: Buffer.concat([len, payload]).toString("hex") };
}

function v1Payload(opts: {
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  valid: boolean;
}): Buffer {
  const b = Buffer.alloc(70);
  ISSUER.copy(b, 0);
  SUBJECT.copy(b, 20);
  b.writeBigUInt64LE(opts.issuedAt, 52);
  b.writeBigUInt64LE(opts.expiresAt, 60);
  b[68] = opts.revoked ? 1 : 0;
  b[69] = opts.valid ? 1 : 0;
  return b;
}

function v2Payload(
  claim: string,
  opts: {
    issuedAt: bigint;
    expiresAt: bigint;
    revoked: boolean;
    valid: boolean;
  },
): Buffer {
  const claimBytes = Buffer.from(claim, "utf8");
  const b = Buffer.alloc(74 + claimBytes.length);
  ISSUER.copy(b, 0);
  SUBJECT.copy(b, 20);
  b.writeUInt32LE(claimBytes.length, 52);
  claimBytes.copy(b, 56);
  const tail = 56 + claimBytes.length;
  b.writeBigUInt64LE(opts.issuedAt, tail);
  b.writeBigUInt64LE(opts.expiresAt, tail + 8);
  b[tail + 16] = opts.revoked ? 1 : 0;
  b[tail + 17] = opts.valid ? 1 : 0;
  return b;
}

const TIMES = {
  issuedAt: 1700000000n,
  expiresAt: 1702592000n,
  revoked: false,
  valid: true,
};

describe("parseCredentialViewBytes", () => {
  it("decodes a v1 70-byte payload (no claim field)", () => {
    const v = parseCredentialViewBytes(clValue(v1Payload(TIMES)));
    assert.equal(v.issuer, "0x" + "11".repeat(20));
    assert.equal(v.claim, "");
    assert.equal(v.issuedAt, "1700000000");
    assert.equal(v.expiresAt, "1702592000");
    assert.equal(v.revoked, false);
    assert.equal(v.valid, true);
  });

  it("decodes a v2 payload with a simple claim", () => {
    const v = parseCredentialViewBytes(clValue(v2Payload("kyc.basic", TIMES)));
    assert.equal(v.issuer, "0x" + "11".repeat(20));
    assert.equal(v.claim, "kyc.basic");
    assert.equal(v.issuedAt, "1700000000");
    assert.equal(v.expiresAt, "1702592000");
    assert.equal(v.valid, true);
  });

  it("decodes a v2 payload with a parameterised claim", () => {
    const v = parseCredentialViewBytes(
      clValue(v2Payload("spend.cap:max=100", TIMES)),
    );
    assert.equal(v.claim, "spend.cap:max=100");
    assert.equal(v.valid, true);
  });

  it("returns the empty view for 69- and 73-byte payloads", () => {
    for (const n of [69, 73]) {
      const v = parseCredentialViewBytes(clValue(Buffer.alloc(n, 1)));
      assert.equal(v.valid, false, `payload length ${n}`);
      assert.equal(v.issuer, "0x" + "00".repeat(20));
    }
  });

  it("returns the empty view when the claim length overruns the buffer", () => {
    const b = Buffer.alloc(74, 0);
    ISSUER.copy(b, 0);
    SUBJECT.copy(b, 20);
    b.writeUInt32LE(100, 52); // claims 100 bytes but only 18 remain
    const v = parseCredentialViewBytes(clValue(b));
    assert.equal(v.valid, false);
    assert.equal(v.issuer, "0x" + "00".repeat(20));
  });
});
