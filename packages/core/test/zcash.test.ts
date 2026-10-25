import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityHash,
  encodeZcashMemoAttestation,
  isZcashShieldedAddress,
  isZcashViewingKey,
  parseZcashMemoAttestation,
  ZCASH_DEMO_REPLAYED_SUBJECT,
  ZCASH_DEMO_SPENT_NULLIFIER,
  ZCASH_DEMO_STEWARD_ISSUER,
  ZCASH_DEMO_UNVERIFIED_SUBJECT,
  ZCASH_DEMO_VERIFIED_SUBJECT,
  ZCASH_ZK_ROOT_VERIFIER_ISSUER,
  ZcashChainAdapter,
} from "../src/index.js";

describe("Zcash shielded address & viewing-key validation", () => {
  it("recognizes valid Unified and Sapling shielded addresses", () => {
    assert.equal(isZcashShieldedAddress(ZCASH_DEMO_VERIFIED_SUBJECT), true);
    assert.equal(isZcashShieldedAddress(ZCASH_DEMO_REPLAYED_SUBJECT), true);
    assert.equal(isZcashShieldedAddress(ZCASH_DEMO_UNVERIFIED_SUBJECT), true);
    assert.equal(
      isZcashShieldedAddress(
        "u1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw8qpzry9x8gf2tvdw0s3jn54khce6mua7",
      ),
      true,
    );
    assert.equal(
      isZcashShieldedAddress(
        "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly",
      ),
      true,
    );
    assert.equal(
      isZcashShieldedAddress(
        "ztestsapling1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly",
      ),
      true,
    );
  });

  it("rejects transparent t-addresses, EVM addresses, Casper hashes, and invalid chars", () => {
    assert.equal(
      isZcashShieldedAddress("t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs"),
      false,
    );
    assert.equal(
      isZcashShieldedAddress("0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec"),
      false,
    );
    assert.equal(
      isZcashShieldedAddress(
        "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326",
      ),
      false,
    );
    assert.equal(isZcashShieldedAddress("utest1short"), false);
    // 'b', 'i', 'o', '1' are excluded from bech32 data part
    assert.equal(
      isZcashShieldedAddress(
        "utest1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
      false,
    );
  });

  it("validates Zcash incoming viewing keys", () => {
    assert.equal(
      isZcashViewingKey(
        "uivktest1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l8k9m",
      ),
      true,
    );
    assert.equal(isZcashViewingKey("not-a-viewing-key"), false);
  });
});

describe("Zcash 512-byte memo attestation codec", () => {
  it("round-trips a selective-disclosure memo attestation in 512 bytes", () => {
    const nullifier = capabilityHash("memo-test-nullifier");
    const memoHex = encodeZcashMemoAttestation({
      capability: "agent.commerce.escrow",
      issuer: ZCASH_DEMO_STEWARD_ISSUER,
      issuedAt: "1761350400",
      expiresAt: "1824422400",
      nullifier,
    });
    assert.equal(memoHex.length, 1024); // 512 bytes = 1024 hex chars
    const decoded = parseZcashMemoAttestation(memoHex);
    assert.deepEqual(decoded, {
      capability: "agent.commerce.escrow",
      issuer: ZCASH_DEMO_STEWARD_ISSUER,
      issuedAt: "1761350400",
      expiresAt: "1824422400",
      nullifier,
    });
  });

  it("returns null for non-Ligis memos", () => {
    assert.equal(parseZcashMemoAttestation("f6000000"), null);
    assert.equal(parseZcashMemoAttestation("hello world"), null);
  });
});

describe("ZcashChainAdapter — Week 1 viewing-key & nullifier replay gate", () => {
  it("verifies the Zecathon verified shielded agent fixture (GO)", async () => {
    const adapter = new ZcashChainAdapter({
      nowSeconds: () => 1762000000,
    });
    const res = await adapter.verifyCapability({
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      capability: "agent.commerce.escrow",
    });
    assert.equal(res.capable, true);
    assert.equal(res.latest.valid, true);
    assert.equal(res.latest.revoked, false);
    assert.equal(res.latest.issuer, ZCASH_DEMO_STEWARD_ISSUER);
    assert.equal(res.capabilityHash, capabilityHash("agent.commerce.escrow"));
  });

  it("rejects the Zecathon replayed nullifier fixture as revoked (STOP)", async () => {
    const adapter = new ZcashChainAdapter({
      nowSeconds: () => 1762000000,
    });
    const res = await adapter.verifyCapability({
      subject: ZCASH_DEMO_REPLAYED_SUBJECT,
      capability: "agent.commerce.escrow",
    });
    assert.equal(res.capable, false);
    assert.equal(res.latest.valid, false);
    assert.equal(res.latest.revoked, true);
    assert.equal(adapter.isNullifierSpent(ZCASH_DEMO_SPENT_NULLIFIER), true);
  });

  it("returns capable=false, revoked=false for an unverified shielded wallet", async () => {
    const adapter = new ZcashChainAdapter({
      nowSeconds: () => 1762000000,
    });
    const res = await adapter.verifyCapability({
      subject: ZCASH_DEMO_UNVERIFIED_SUBJECT,
      capability: "kyc.basic",
    });
    assert.equal(res.capable, false);
    assert.equal(res.latest.revoked, false);
    assert.equal(
      res.latest.issuer,
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("reads shielded notes from Zebra/zcashd RPC and enforces nullifier replay", async () => {
    const subject =
      "utest1gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x82x8q9w0";
    const nullifier = capabilityHash("rpc-note-nullifier");
    const memo = encodeZcashMemoAttestation({
      capability: "kyc.basic",
      issuer: ZCASH_DEMO_STEWARD_ISSUER,
      issuedAt: "1761350400",
      expiresAt: "1824422400",
      nullifier,
    });

    let rpcCalls = 0;
    const adapter = new ZcashChainAdapter({
      includeDemoFixtures: false,
      nowSeconds: () => 1762000000,
      rpcTransport: {
        async call<T>(method: string): Promise<T> {
          assert.equal(method, "z_listreceivedbyaddress");
          rpcCalls += 1;
          return [
            {
              txid: "abcd1234",
              amount: 0.5,
              amountZat: 50_000_000,
              memo,
              confirmations: 6,
            },
          ] as unknown as T;
        },
      },
    });

    // First verification succeeds via RPC memo
    const first = await adapter.verifyCapability({
      subject,
      capability: "kyc.basic",
    });
    assert.equal(first.capable, true);
    assert.equal(first.latest.revoked, false);
    assert.equal(rpcCalls, 1);

    // Spend the nullifier (simulating shielded transfer release)
    adapter.spendNullifier(nullifier);

    // Replay attempt with the same nullifier must STOP (revoked=true, capable=false)
    const replay = await adapter.verifyCapability({
      subject,
      capability: "kyc.basic",
    });
    assert.equal(replay.capable, false);
    assert.equal(replay.latest.revoked, true);
  });

  it("supports Week 2 ZK proof presentations and nullifier spending", async () => {
    const adapter = new ZcashChainAdapter({
      includeDemoFixtures: false,
      nowSeconds: () => 1762000000,
    });
    const capHash = capabilityHash("agent.commerce.escrow");
    const nullifier = capabilityHash("zk-proof-nullifier-1");
    const root = capabilityHash("merkle-root-1");

    adapter.registerPresentation({
      mode: "zk-proof",
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      provingSystem: "halo2-orchard",
      proof: `0x${"ab".repeat(64)}`,
      publicInputs: {
        capabilityHash: capHash,
        registryRoot: root,
        nullifier,
      },
      issuedAt: "1761350400",
      expiresAt: "1824422400",
    });

    const verified = await adapter.verifyCapability({
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      capability: "agent.commerce.escrow",
    });
    assert.equal(verified.capable, true);
    assert.equal(verified.latest.issuer, ZCASH_ZK_ROOT_VERIFIER_ISSUER);

    adapter.spendNullifier(nullifier);
    const afterSpend = await adapter.verifyCapability({
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      capability: "agent.commerce.escrow",
    });
    assert.equal(afterSpend.capable, false);
    assert.equal(afterSpend.latest.revoked, true);
  });
});
