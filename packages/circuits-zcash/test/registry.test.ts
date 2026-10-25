import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { fieldHex, identityCommitment, payeeField } from "../src/index.js";
import {
  DEMO_CAPABILITY,
  DEMO_EXPIRES,
  DEMO_HOLDER_NONCE,
  DEMO_HOLDER_SECRET,
  DEMO_ISSUER,
  DEMO_OTHER_PAYEE,
  DEMO_PAYEE,
  DEMO_REVOKED_PAYEE,
  demoRegistry,
  demoRegistryInput,
} from "../src/demo-registry.js";
import {
  REGISTRY_EVENTS_ABI,
  buildRegistryRoot,
  checkManifest,
  decodeRegistryLogs,
  fetchRegistryEvents,
  verifyRegistrations,
  witnessFromManifest,
} from "../src/registry.js";

const AS_OF = 1_761_350_400;
const holder = {
  identitySecret: DEMO_HOLDER_SECRET,
  zcashAddress: DEMO_PAYEE,
  capability: DEMO_CAPABILITY,
  issuer: DEMO_ISSUER,
  expiresAt: DEMO_EXPIRES,
  nonce: DEMO_HOLDER_NONCE,
};

describe("registry root builder", () => {
  it("admits only unrevoked, unexpired, validly-registered credentials", async () => {
    const { manifest } = await demoRegistry(AS_OF);
    // holder(escrow) + other(escrow) + other(kyc) = 3 leaves.
    assert.equal(manifest.leafCount, 3);
    assert.deepEqual(manifest.skipped, {
      revoked: 1,
      expired: 1,
      unregistered: 2, // "unregistered" + "forged" (its registration is rejected)
      badRegistration: 1,
    });
    assert.equal(await checkManifest(manifest).then((m) => typeof m), "object");
  });

  it("is deterministic and order-independent of input order", async () => {
    const a = await demoRegistry(AS_OF);
    const input = await demoRegistryInput();
    const b = await buildRegistryRoot({
      events: [...input.events].reverse(),
      registrations: input.registrations,
      asOf: AS_OF,
      source: { kind: "fixture", name: "x" },
    });
    assert.equal(a.manifest.root, b.manifest.root);
  });

  it("revocation changes the root and removes the leaf", async () => {
    const input = await demoRegistryInput();
    const holderIssued = input.events[0]!;
    const before = await demoRegistry(AS_OF);
    const after = await buildRegistryRoot({
      ...input,
      events: [
        ...input.events,
        {
          ...holderIssued,
          type: "revoked",
          revokedAt: "1761200000",
          blockNumber: "200",
          logIndex: 0,
        } as never,
      ],
      asOf: AS_OF,
      source: { kind: "fixture", name: "x" },
    });
    assert.notEqual(before.manifest.root, after.manifest.root);
    assert.equal(await witnessFromManifest(after.manifest, holder), null);
  });

  it("expiry is evaluated at asOf", async () => {
    const late = await demoRegistry(Number(DEMO_EXPIRES));
    assert.equal(late.manifest.leafCount, 0);
  });

  it("holder finds its own leaf only for the payee it registered", async () => {
    const { manifest, tree } = await demoRegistry(AS_OF);
    const w = await witnessFromManifest(manifest, holder);
    assert.ok(w);
    assert.equal(w.tree.root, tree.root);
    assert.equal(
      await witnessFromManifest(manifest, {
        ...holder,
        zcashAddress: DEMO_REVOKED_PAYEE,
      }),
      null,
    );
    assert.equal(
      await witnessFromManifest(manifest, {
        ...holder,
        zcashAddress: DEMO_OTHER_PAYEE,
      }),
      null,
    );
  });

  it("rejects registrations not signed by the subject", async () => {
    const { registrations } = await demoRegistryInput();
    const { bySubject, bad } = await verifyRegistrations(registrations);
    assert.equal(bad, 1);
    assert.equal(bySubject.size, 4);
    const tampered = { ...registrations[0]!, zcashAddress: DEMO_OTHER_PAYEE };
    assert.equal((await verifyRegistrations([tampered])).bad, 1);
    assert.equal(
      registrations[0]!.identityCommitment,
      fieldHex(await identityCommitment(DEMO_HOLDER_SECRET)),
    );
  });

  it("checkManifest rejects a manifest whose root doesn't match its leaves", async () => {
    const { manifest } = await demoRegistry(AS_OF);
    assert.match(
      String(await checkManifest({ ...manifest, root: fieldHex(1n) })),
      /does not match/,
    );
    assert.match(
      String(await checkManifest({ ...manifest, depth: 4 })),
      /depth/,
    );
  });

  it("payee hash is case/whitespace-insensitive", () => {
    assert.equal(
      payeeField(` ${DEMO_PAYEE.toUpperCase()} `),
      payeeField(DEMO_PAYEE),
    );
  });
});

describe("CredentialRegistry log decoding", () => {
  const cap = ("0x" + "ab".repeat(32)) as Hex;
  const issuer = "0x1111111111111111111111111111111111111111" as Hex;
  const subject = "0x2222222222222222222222222222222222222222" as Hex;
  const issuedLog = {
    topics: encodeEventTopics({
      abi: REGISTRY_EVENTS_ABI,
      eventName: "CredentialIssued",
      args: { issuer, subject, capabilityHash: cap },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint64" }, { type: "uint64" }],
      [3n, 100n, 200n],
    ),
    blockNumber: 7n,
    logIndex: 2,
  };
  const revokedLog = {
    topics: encodeEventTopics({
      abi: REGISTRY_EVENTS_ABI,
      eventName: "CredentialRevoked",
      args: { issuer, subject, capabilityHash: cap },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint64" }],
      [3n, 150n],
    ),
    blockNumber: 9n,
    logIndex: 0,
  };

  it("decodes issued/revoked events", () => {
    const ev = decodeRegistryLogs([issuedLog, revokedLog]);
    assert.equal(ev.length, 2);
    assert.deepEqual(ev[0], {
      type: "issued",
      issuer,
      subject,
      capabilityHash: cap,
      nonce: "3",
      issuedAt: "100",
      expiresAt: "200",
      blockNumber: "7",
      logIndex: 2,
    });
    assert.equal(ev[1]!.type, "revoked");
  });

  it("fetchRegistryEvents pages getLogs over block chunks (read-only)", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const client = {
      getBlockNumber: async () => 12n,
      getLogs: async (a: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([a.fromBlock, a.toBlock]);
        return a.fromBlock === 5n
          ? [issuedLog]
          : a.fromBlock === 10n
            ? [revokedLog]
            : [];
      },
    };
    const out = await fetchRegistryEvents(
      client as never,
      issuer,
      0n,
      undefined,
      5n,
    );
    assert.deepEqual(calls, [
      [0n, 4n],
      [5n, 9n],
      [10n, 12n],
    ]);
    assert.equal(out.events.length, 2);
    assert.equal(out.toBlock, 12n);
  });
});
