import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectSubjectKind,
  subjectChainMismatch,
  chainSwitchHref,
} from "../lib/subject-format";
import { CASPER_TESTNET, MONAD_TESTNET, PHAROS_ATLANTIC } from "../lib/network";

describe("detectSubjectKind", () => {
  it("recognises Casper account-hash", () => {
    assert.equal(
      detectSubjectKind(
        "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326",
      ),
      "casper",
    );
  });

  it("recognises EVM address", () => {
    assert.equal(
      detectSubjectKind("0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"),
      "evm",
    );
  });

  it("returns unknown for garbage", () => {
    assert.equal(detectSubjectKind("not-an-address"), "unknown");
  });
});

describe("subjectChainMismatch", () => {
  const casperHash =
    "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326";
  const evm = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

  it("suggests Casper when an account-hash is pasted on Pharos", () => {
    const m = subjectChainMismatch(PHAROS_ATLANTIC, casperHash);
    assert.ok(m);
    assert.equal(m!.suggestedChainId, CASPER_TESTNET.id);
  });

  it("suggests Casper when an account-hash is pasted on Monad", () => {
    const m = subjectChainMismatch(MONAD_TESTNET, casperHash);
    assert.ok(m);
    assert.equal(m!.suggestedChainId, CASPER_TESTNET.id);
  });

  it("suggests Pharos when an EVM address is pasted on Casper", () => {
    const m = subjectChainMismatch(CASPER_TESTNET, evm);
    assert.ok(m);
    assert.equal(m!.suggestedChainId, PHAROS_ATLANTIC.id);
  });

  it("returns null when formats match", () => {
    assert.equal(subjectChainMismatch(PHAROS_ATLANTIC, evm), null);
    assert.equal(subjectChainMismatch(CASPER_TESTNET, casperHash), null);
  });
});

describe("chainSwitchHref", () => {
  it("preserves subject and capability", () => {
    assert.equal(
      chainSwitchHref({
        path: "/gate",
        chainId: "casper-testnet",
        subject: "account-hash-abc",
        capability: "kyc.basic",
      }),
      "/gate?chain=casper-testnet&subject=account-hash-abc&capability=kyc.basic",
    );
  });
});
