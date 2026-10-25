import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactAddresses,
  explainDecision,
  explainZk,
  shortHash,
} from "@/lib/decision-copy";
import type { Signal, ZkCredentialResult } from "@/lib/decide";

const sig = (id: Signal["id"], status: Signal["status"]): Signal =>
  ({ id, status, confidence: 1 }) as Signal;
const zk = (
  status: ZkCredentialResult["status"],
  reason: string,
): ZkCredentialResult => ({
  status,
  verification:
    status === "GO"
      ? "verified"
      : status === "STOP"
        ? "rejected"
        : "unverified",
  reason,
});

describe("plain-language decision copy", () => {
  it("GO names skipped checks; STOP names failures; UNKNOWN is never approval", () => {
    const go = explainDecision({
      verdict: "GO",
      signals: [sig("right-payee", "GO"), sig("in-scope", "SKIPPED")],
    });
    assert.equal(go.headline, "Safe to pay");
    assert.match(go.meaning, /Not checked: in scope/);
    const stop = explainDecision({
      verdict: "STOP",
      signals: [sig("verified-payee", "STOP"), sig("right-amount", "GO")],
    });
    assert.match(stop.meaning, /Failed: verified payee\.$/);
    assert.match(stop.next, /Do not send funds/);
    const unk = explainDecision({
      verdict: "UNKNOWN",
      signals: [sig("verified-payee", "UNKNOWN")],
    });
    assert.match(unk.meaning, /never approval/);
  });

  it("maps every gate zk reason to a human title", () => {
    const cases: Array<[ZkCredentialResult["status"], string, RegExp]> = [
      [
        "GO",
        "credential membership proven against a trusted registry root",
        /accepted/,
      ],
      [
        "STOP",
        "nullifier already used for this context (replay)",
        /Replay blocked/,
      ],
      [
        "STOP",
        "registry_root is not a trusted CredentialRegistry root",
        /Revoked/,
      ],
      [
        "STOP",
        "proof credential is bound to a different payee",
        /someone else/,
      ],
      ["STOP", "proof is for a different capability than x", /Wrong kind/],
      ["STOP", "proof is older than 600s", /expired/],
      ["STOP", "proof failed verification (bad)", /invalid/],
      ["UNKNOWN", "proof not verified: bb not runnable at /x", /not checked/],
      ["UNKNOWN", "published registry root is stale (asOf 1)", /out of date/],
      ["UNKNOWN", "no trusted registry roots configured (X)", /can't check/],
    ];
    for (const [s, reason, re] of cases) {
      assert.match(explainZk(zk(s, reason)).title, re, reason);
    }
  });

  it("shortHash uses the ·· mid-glyph", () => {
    assert.equal(shortHash("0x" + "a".repeat(64)), "0xaaaaaa··aaaaaa");
    assert.equal(shortHash(undefined), "—");
  });

  it("compactAddresses shortens shielded and EVM addresses in reasons", () => {
    const z = "utest1" + "jh85uls2r66r05ps5aww5c23qhh4yzj5".repeat(2);
    assert.equal(
      compactAddresses(`payee ${z} is on mandate allowlist`),
      `payee ${z.slice(0, 12)}··${z.slice(-6)} is on mandate allowlist`,
    );
    assert.match(
      compactAddresses("issuer 0x" + "ab".repeat(20)),
      /0xababababab··/,
    );
    assert.equal(compactAddresses("amount $25 is fine"), "amount $25 is fine");
  });
});
