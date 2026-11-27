import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeClaim,
  claimHash,
  isCanonicalClaim,
  namespaceHash,
  namespaceHashOf,
  namespaceOf,
  parseClaim,
  tryParseClaim,
} from "../src/claim.js";
import { capabilityHash } from "../src/hash.js";

describe("claim grammar", () => {
  it("parses a parameter-free claim", () => {
    const c = parseClaim("kyc.basic");
    assert.equal(c.canonical, "kyc.basic");
    assert.equal(c.capability, "kyc.basic");
    assert.equal(c.namespace, "kyc");
    assert.deepEqual(c.params, []);
  });

  it("parses params", () => {
    const c = parseClaim("rwa.accredited:jurisdiction=us");
    assert.equal(c.namespace, "rwa");
    assert.deepEqual(c.params, [{ key: "jurisdiction", value: "us" }]);
  });

  it("canonicalize sorts params ascending", () => {
    assert.equal(
      canonicalizeClaim("agent.spend:max=1000:currency=cspr"),
      "agent.spend:currency=cspr:max=1000",
    );
  });

  it("canonicalize lowercases capability and param keys", () => {
    assert.equal(
      canonicalizeClaim("RWA.Accredited:Jurisdiction=us"),
      "rwa.accredited:jurisdiction=us",
    );
  });

  it("two orderings hash identically after canonicalization", () => {
    const a = claimHash(canonicalizeClaim("x.y:b=2:a=1"));
    const b = claimHash(canonicalizeClaim("x.y:a=1:b=2"));
    assert.equal(a, b);
  });

  it("rejects non-canonical input in strict parse", () => {
    assert.equal(isCanonicalClaim("x.y:b=2:a=1"), false);
    assert.equal(isCanonicalClaim("x.y:a=1:b=2"), true);
    assert.throws(() => parseClaim("x.y:b=2:a=1"), /canonical/);
  });

  it("rejects duplicate params", () => {
    assert.throws(() => canonicalizeClaim("x.y:a=1:a=2"), /duplicate/);
  });

  it("rejects capability without a dot", () => {
    assert.throws(() => parseClaim("nodots"), /namespace and a name/);
    assert.equal(tryParseClaim("nodots"), null);
  });

  it("rejects invalid characters and whitespace", () => {
    for (const bad of [
      "x .y",
      "x.y:a b=1",
      "x.y:a=",
      "x.y:=1",
      "x.y:a=1:2=3",
      "x.y:",
      ".y",
      "x.",
      "x.y:a==1",
    ]) {
      assert.equal(tryParseClaim(bad), null, `expected null for '${bad}'`);
    }
  });

  it("rejects more than 8 params", () => {
    const s = "x.y" + ":p".repeat(9).replace(/:p/g, (m, i) => m);
    const nine = "x.y:a1=1:a2=2:a3=3:a4=4:a5=5:a6=6:a7=7:a8=8:a9=9";
    assert.throws(() => canonicalizeClaim(nine), /too many/);
    assert.ok(s.length > 0); // sanity
  });

  it("rejects over-length claims", () => {
    const long = "x." + "a".repeat(200);
    assert.throws(() => canonicalizeClaim(long), /too long/);
  });
});

describe("hash semantics", () => {
  it("claimHash equals v1 capabilityHash for param-free claims", () => {
    assert.equal(claimHash("kyc.basic"), capabilityHash("kyc.basic"));
    assert.equal(
      claimHash("agent.commerce.escrow"),
      capabilityHash("agent.commerce.escrow"),
    );
  });

  it("namespaceOf returns first segment", () => {
    assert.equal(namespaceOf("rwa.accredited:jurisdiction=us"), "rwa");
  });

  it("namespaceHash hashes the namespace not the claim", () => {
    assert.equal(namespaceHash("rwa.accredited"), namespaceHashOf("rwa"));
    assert.notEqual(
      namespaceHash("rwa.accredited"),
      claimHash("rwa.accredited"),
    );
  });

  it("same namespace across different claims", () => {
    assert.equal(
      namespaceHash("rwa.accredited"),
      namespaceHash("rwa.investor:tier=2"),
    );
  });
});
