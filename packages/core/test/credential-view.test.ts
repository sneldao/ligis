import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCredentialViewHex } from "../src/credential-view.js";

const ISSUER = "11".repeat(20);
const SUBJECT = "22".repeat(32);

function u32le(n: number): string {
  return n.toString(16).padStart(8, "0").match(/../g)!.reverse().join("");
}

function u64le(n: bigint): string {
  return n.toString(16).padStart(16, "0").match(/../g)!.reverse().join("");
}

function toHex(utf8: string): string {
  return Array.from(new TextEncoder().encode(utf8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function wrap(payloadHex: string): string {
  return u32le(payloadHex.length / 2) + payloadHex;
}

function v1Payload(): string {
  return (
    ISSUER +
    SUBJECT +
    u64le(1700000000n) +
    u64le(1702592000n) +
    "00" + // revoked
    "01" // valid
  );
}

function v2Payload(claim: string): string {
  const claimHex = toHex(claim);
  return (
    ISSUER +
    SUBJECT +
    u32le(claimHex.length / 2) +
    claimHex +
    u64le(1700000000n) +
    u64le(1702592000n) +
    "00" +
    "01"
  );
}

describe("parseCredentialViewHex", () => {
  it("decodes a v1 70-byte payload (no claim field)", () => {
    const v = parseCredentialViewHex(wrap(v1Payload()));
    assert.ok(v);
    assert.equal(v.issuer, "0x" + ISSUER);
    assert.equal(v.claim, "");
    assert.equal(v.issuedAt, "1700000000");
    assert.equal(v.expiresAt, "1702592000");
    assert.equal(v.revoked, false);
    assert.equal(v.valid, true);
  });

  it("decodes a v2 payload with a simple claim", () => {
    const v = parseCredentialViewHex(wrap(v2Payload("kyc.basic")));
    assert.ok(v);
    assert.equal(v.claim, "kyc.basic");
    assert.equal(v.valid, true);
  });

  it("decodes a v2 payload with a parameterised claim", () => {
    const v = parseCredentialViewHex(wrap(v2Payload("spend.cap:max=100")));
    assert.ok(v);
    assert.equal(v.claim, "spend.cap:max=100");
  });

  it("decodes a v2 payload with a multi-byte utf8 claim", () => {
    // 'é' is 2 bytes in utf8 — claimLen counts bytes, not chars.
    const v = parseCredentialViewHex(wrap(v2Payload("kyc.café")));
    assert.ok(v);
    assert.equal(v.claim, "kyc.café");
  });

  it("decodes a v2 payload with an empty claim (74 bytes minimum)", () => {
    const v = parseCredentialViewHex(wrap(v2Payload("")));
    assert.ok(v);
    assert.equal(v.claim, "");
    assert.equal(v.valid, true);
    assert.equal(v.issuedAt, "1700000000");
  });

  it("decodes the real v2 testnet fixture (kyc.basic, issued 2026-11-27)", () => {
    // Bytes as stored on-chain in the v2 registry package
    // contract-package-8ae86730…629f12 for subject c76927ed…8326.
    const v = parseCredentialViewHex(
      "5300000047e9b13e467e2db34b1aa145758b253bbd9ffa40c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326090000006b79632e6261736963bbc7096b000000003bfbea6c000000000001",
    );
    assert.ok(v);
    assert.equal(v.issuer, "0x47e9b13e467e2db34b1aa145758b253bbd9ffa40");
    assert.equal(v.claim, "kyc.basic");
    assert.equal(v.issuedAt, "1795803067");
    assert.equal(v.expiresAt, "1827339067");
    assert.equal(v.revoked, false);
    assert.equal(v.valid, true);
  });

  it("returns null for neither-v1-nor-v2 payload lengths", () => {
    for (const bytes of [69, 71, 72, 73]) {
      const v = parseCredentialViewHex(wrap("ab".repeat(bytes)));
      assert.equal(v, null, `payload length ${bytes}`);
    }
  });

  it("returns null when the claim length overruns the payload", () => {
    // 74-byte payload claiming a 100-byte claim string.
    const payload = ISSUER + SUBJECT + u32le(100) + "00".repeat(18);
    assert.equal(parseCredentialViewHex(wrap(payload)), null);
  });

  it("returns null when the length prefix overruns the buffer", () => {
    const payload = v1Payload();
    // Claim more bytes than are actually present.
    const truncated = u32le(payload.length / 2 + 10) + payload;
    assert.equal(parseCredentialViewHex(truncated), null);
  });

  it("returns null for empty, odd-length, and non-hex input", () => {
    assert.equal(parseCredentialViewHex(""), null);
    assert.equal(parseCredentialViewHex("abc"), null);
    assert.equal(parseCredentialViewHex("zz".repeat(40)), null);
  });

  it("ignores trailing bytes beyond the length prefix", () => {
    const payload = v2Payload("kyc.basic");
    const v = parseCredentialViewHex(wrap(payload) + "deadbeef");
    assert.ok(v);
    assert.equal(v.claim, "kyc.basic");
  });
});
