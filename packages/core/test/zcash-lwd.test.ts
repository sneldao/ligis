import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LightwalletdClient,
  decryptNotesWithViewingKey,
  orchardReceiverOf,
  parseShieldedActions,
  type ZcashLightClient,
} from "../src/zcash-lwd.js";
import { ZcashChainAdapter } from "../src/index.js";

/** Real shielded tx confirmed on Zcash Testnet at height 4,540,356. */
const TXID = "d2b389c8fd108561f3cdc45cfcb373e7474dbb8804368fcd560135f9cb443f90";
const UA =
  "utest1e35c2ayfrjk6zjzrqsl8nsrpnqfcxl6t0njmu4gmxw78379mqwth3szguwwteltya2my8t9795stpdpsxccxl00xhzea9wmtzx4rwj9ddavysydxpk300a67vsutjfqwjm36w4a4gama7kldyvu3r9929pcxkt5r3etrwfjpfvqryfgr";
const UIVK =
  "uivktest1eedd60g75nttawzcu0gqwkgqh7069qkeddf78kn5ymqaufls27jdrpklqrxtkvpn3d65quzr2e7h726ca0xjtzcmple2l4d58k2xv5y8j55a77tqdelca3h29vxext5ek7q9uc3u2yyr3snwa0lpegr0yjdpwtxt395td8r9wq3nupsdufynzh7c7c3jp757rlyyepg8rp9mkc684fjpextgr52zm5hmd5ap6d8v8a2uwyu4puk";
// Different account's viewing key: must not decrypt the note.
const OTHER_UIVK =
  "uivktest1k003rkffp5rpmmvdluf8d978xnnf9h5uxl9u66clc3gvzdcm8kvmzzhj3h7zzuszwa5p5avyzlqslzj2z5pw3f9dztz9q2vk6085dzcul84fl3s30t4hxde6z7glx8ketty3hlxyxkpkt6un0qu39uhr9y92pgdahddlvwxusdpshedwnxgpat7x8y7g4u7lpymy8q8au4vhdcfpy427kaajjfglm90tv2acxmg8zl95gnmtgwc";

const raw = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL("./fixtures/zcash-testnet-d2b389c8.tx.hex", import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  ),
);

const fakeClient: ZcashLightClient = {
  async getTransaction(txid) {
    assert.equal(txid, TXID);
    return { raw, height: 4_540_356 };
  },
  async getLatestHeight() {
    return 4_540_400;
  },
};

test("parses the v6 tx: two Orchard actions + one Ironwood action", () => {
  assert.deepEqual(
    parseShieldedActions(raw).map((a) => a.pool),
    ["orchard", "orchard", "ironwood"],
  );
});

test("viewing key decrypts the on-chain note and its LIGIS:v1 memo", () => {
  const notes = decryptNotesWithViewingKey(raw, UIVK);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.pool, "ironwood");
  assert.equal(notes[0]!.valueZat, 100_000_000n);
  assert.equal(
    notes[0]!.nullifier,
    "0x6743c460f674cdb17cb8abd425fc9063b68dd75a709d8e3a8c46350980540a00",
  );
  assert.match(
    notes[0]!.memo,
    /^LIGIS:v1:\{"capability":"agent\.commerce\.escrow"/,
  );
});

test("a different account's viewing key decrypts nothing", () => {
  assert.deepEqual(decryptNotesWithViewingKey(raw, OTHER_UIVK), []);
});

test("the note's diversifier matches the payee's Unified Address", () => {
  const recv = orchardReceiverOf(UA)!;
  const [n] = decryptNotesWithViewingKey(raw, UIVK);
  assert.equal(
    Buffer.from(recv.subarray(0, 11)).toString("hex"),
    n!.diversifier,
  );
});

test("adapter: unsigned live memo grants no trust; explicit fixture tests local replay", async () => {
  const adapter = new ZcashChainAdapter({
    network: "zcash-testnet",
    lightClient: fakeClient,
    includeDemoFixtures: false,
  });
  const got = await adapter.readLiveAttestation({
    subject: UA,
    viewingKey: UIVK,
    txid: TXID,
  });
  assert.equal(got.height, 4_540_356);
  assert.equal(await adapter.latestHeight(), 4_540_400);

  const ok = await adapter.verifyCapability({
    subject: UA,
    capability: "agent.commerce.escrow",
  });
  assert.equal(ok.capable, false, "unsigned memo must not grant a capability");
  // Explicitly trusted local fixtures exercise replay bookkeeping only.
  adapter.registerPresentation(got.presentation);

  adapter.spendNullifier(got.presentation.nullifier);
  const replay = await adapter.verifyCapability({
    subject: UA,
    capability: "agent.commerce.escrow",
  });
  assert.equal(replay.capable, false);
  assert.equal(replay.latest.revoked, true);

  await assert.rejects(
    adapter.readLiveAttestation({
      subject: UA,
      viewingKey: OTHER_UIVK,
      txid: TXID,
    }),
    /no note addressed to subject/,
  );
});

test("rejects checksum corruption, mixed case and truncated transaction data", () => {
  assert.throws(() => orchardReceiverOf(UA.slice(0, -1) + "q"), /checksum/);
  assert.throws(() => orchardReceiverOf("U" + UA.slice(1)), /mixed-case/);
  for (const length of [0, 19, 30, 500, raw.length - 1]) {
    assert.throws(() => parseShieldedActions(raw.subarray(0, length)));
  }
});

// Opt-in: hits the public testnet lightwalletd (LIGIS_ZCASH_LIVE=1).
test(
  "live lightwalletd serves the confirmed attestation",
  { skip: process.env.LIGIS_ZCASH_LIVE !== "1" },
  async () => {
    const client = new LightwalletdClient("https://testnet.zec.rocks:443");
    try {
      const adapter = new ZcashChainAdapter({
        lightClient: client,
        includeDemoFixtures: false,
      });
      const got = await adapter.readLiveAttestation({
        subject: UA,
        viewingKey: UIVK,
        txid: TXID,
      });
      assert.equal(got.height, 4_540_356);
      assert.ok((await adapter.latestHeight())! > 4_540_356);
    } finally {
      client.close();
    }
  },
);
