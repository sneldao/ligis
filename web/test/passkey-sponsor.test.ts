import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { p256 } from "@noble/curves/p256";
import { encodeFunctionData, toHex, hexToBytes, type Hex } from "viem";
import { capabilityHash } from "@ligis/core";
import {
  assertSponsorScope,
  buildPrivySponsoredRequest,
  FixtureSponsor,
  SPONSOR_ABI,
  SPONSOR_LIMITS,
  fixtureLogin,
  fixturePrepare,
  fixtureAdmit,
  fixtureSubmit,
  authenticatePasskeyUser,
} from "../lib/passkey-sponsor";
import {
  PASSKEY_ISSUER,
  PASSKEY_REGISTRY,
  fixtureEnabled,
} from "../lib/passkey";
import { derToRs, hexToBytes as browserHexToBytes } from "../lib/webauthn";
import { POST } from "../app/api/passkey/route";

const subject = "0x000000000000000000000000000000000000cafe";
const tx = {
  chainId: 10143,
  to: PASSKEY_REGISTRY,
  value: 0n,
  data: encodeFunctionData({
    abi: SPONSOR_ABI,
    functionName: "issue",
    args: [
      PASSKEY_ISSUER,
      subject,
      capabilityHash("demo.passkey") as Hex,
      1n,
      2n,
      0n,
      "0x12",
    ],
  }),
};

test("sponsor accepts only exact chain, target, selector, zero value and canonical demo calldata", () => {
  assert.doesNotThrow(() => assertSponsorScope(tx));
  for (const bad of [
    { ...tx, chainId: 143 },
    { ...tx, to: subject },
    { ...tx, value: 1n },
    { ...tx, data: "0x12345678" },
    { ...tx, data: `${tx.data}00` },
    {
      ...tx,
      data: encodeFunctionData({
        abi: SPONSOR_ABI,
        functionName: "issue",
        args: [
          PASSKEY_ISSUER,
          subject,
          capabilityHash("kyc.basic") as Hex,
          1n,
          2n,
          0n,
          "0x12",
        ],
      }),
    },
    {
      ...tx,
      data: encodeFunctionData({
        abi: SPONSOR_ABI,
        functionName: "issue",
        args: [
          subject,
          subject,
          capabilityHash("demo.passkey") as Hex,
          1n,
          2n,
          0n,
          "0x12",
        ],
      }),
    },
  ])
    assert.throws(() => assertSponsorScope(bad as typeof tx));
});

test("typed Privy boundary pins CAIP-2, zero value, sponsorship and idempotency to the approved payload", () => {
  const request = buildPrivySponsoredRequest(tx, tx, "request-privy");
  assert.equal(request.caip2, "eip155:10143");
  assert.equal(request.sponsor, true);
  assert.equal(request.idempotency_key, "request-privy");
  assert.throws(
    () =>
      buildPrivySponsoredRequest(tx, { ...tx, data: "0x12" }, "request-privy"),
    /approved/,
  );
});

test("fixture sponsor rejects duplicate requests, rate limit, request/spend caps and unauthenticated users", async () => {
  const sponsor = new FixtureSponsor();
  const send = async (nonce: number) => nonce;
  assert.equal(
    await sponsor.submit("u", "request-0001", tx, 1n, send, undefined, 1000),
    0,
  );
  await assert.rejects(
    sponsor.submit("u", "request-0001", tx, 1n, send, undefined, 3000),
    /Duplicate/,
  );
  await assert.rejects(
    sponsor.submit("u", "request-0002", tx, 1n, send, undefined, 1001),
    /rate/,
  );
  await assert.rejects(
    sponsor.submit("", "request-0002", tx, 1n, send),
    /Authenticated/,
  );
  await assert.rejects(
    sponsor.submit(
      "u",
      "request-0002",
      tx,
      SPONSOR_LIMITS.maxRequestSpendWei + 1n,
      send,
    ),
    /caps/,
  );
  for (let i = 2; i <= 4; i++)
    await sponsor.submit(
      "u",
      `request-000${i}`,
      tx,
      1n,
      send,
      undefined,
      i * 2000,
    );
  await assert.rejects(
    sponsor.submit("u", "request-0005", tx, 1n, send, undefined, 20_000),
    /caps/,
  );
  const spend = new FixtureSponsor();
  for (let i = 0; i < 2; i++)
    await spend.submit(
      "u",
      `spend-request-${i}`,
      tx,
      SPONSOR_LIMITS.maxRequestSpendWei,
      send,
      undefined,
      i * 2000,
    );
  await assert.rejects(
    spend.submit("u", "spend-request-3", tx, 1n, send, undefined, 20_000),
    /caps/,
  );
});

test("global request and spend reservations exhaust without unbounded sponsorship", async () => {
  const sponsor = new FixtureSponsor();
  for (let i = 0; i < 40; i++) {
    await sponsor.submit(
      `user-${i}`,
      `request-${i.toString().padStart(4, "0")}`,
      tx,
      1n,
      async () => true,
    );
  }
  await assert.rejects(
    sponsor.submit("new", "request-more", tx, 1n, async () => true),
    /caps/,
  );
  const spend = new FixtureSponsor();
  for (let i = 0; i < 10; i++)
    await spend.submit(
      `user-${i}`,
      `spend-request-${i}`,
      tx,
      SPONSOR_LIMITS.maxRequestSpendWei,
      async () => true,
    );
  await assert.rejects(
    spend.submit("new", "spend-request-more", tx, 1n, async () => true),
    /caps/,
  );
});

test("concurrent operations serialize pending-nonce reads and use distinct nonces", async () => {
  const sponsor = new FixtureSponsor();
  const nonces: number[] = [];
  let active = 0;
  let maxActive = 0;
  const send = async (nonce: number) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    nonces.push(nonce);
    active--;
    return nonce;
  };
  await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      sponsor.submit(
        `user-${i}`,
        `concurrent-${i}`,
        tx,
        1n,
        send,
        async () => 7,
      ),
    ),
  );
  assert.deepEqual(nonces, [7, 8, 9, 10]);
  assert.equal(maxActive, 1);
});

test("ambiguous sponsor outage poisons the fixture queue instead of retrying a nonce or falling back", async () => {
  const sponsor = new FixtureSponsor();
  await assert.rejects(
    sponsor.submit("a", "request-outage", tx, 1n, async () => {
      throw new Error("outage");
    }),
    /no fallback/,
  );
  await assert.rejects(
    sponsor.submit("b", "request-next", tx, 1n, async () => true),
    /ambiguous/,
  );
});

test("unsafe pending nonce is refused before submission", async () => {
  const sponsor = new FixtureSponsor();
  await assert.rejects(
    sponsor.submit(
      "a",
      "request-nonce",
      tx,
      1n,
      async () => assert.fail("must not send"),
      async () => -1,
    ),
    /Unsafe/,
  );
});

const sha = (data: Uint8Array | string) =>
  new Uint8Array(createHash("sha256").update(data).digest());
function setupFixture() {
  const privateKey = p256.utils.randomPrivateKey();
  const point = p256.getPublicKey(privateKey, false);
  const { token } = fixtureLogin();
  const keyId = toHex(sha(point));
  fixtureAdmit(token, {
    keyId,
    qx: BigInt(toHex(point.slice(1, 33))),
    qy: BigInt(toHex(point.slice(33))),
  });
  return { token, privateKey };
}
function assertion(
  digest: Hex,
  privateKey: Uint8Array,
  changes: {
    rp?: string;
    origin?: string;
    type?: string;
    flags?: number;
    challenge?: string;
    sentinel?: string;
  } = {},
) {
  const auth = new Uint8Array([
    ...sha(changes.rp ?? "localhost"),
    changes.flags ?? 5,
    0,
    0,
    0,
    1,
  ]);
  const client = new TextEncoder().encode(
    JSON.stringify({
      type: changes.type ?? "webauthn.get",
      challenge:
        changes.challenge ??
        Buffer.from(hexToBytes(digest)).toString("base64url"),
      origin: changes.origin ?? "http://localhost:3001",
      crossOrigin: false,
      ...(changes.sentinel !== undefined
        ? { other_keys_can_be_added_here: changes.sentinel }
        : {}),
    }),
  );
  const signature = p256.sign(
    sha(new Uint8Array([...auth, ...sha(client)])),
    privateKey,
    { lowS: false },
  );
  return {
    authenticatorData: toHex(auth),
    clientDataJSON: toHex(client),
    r: signature.r,
    s: signature.s,
  };
}

test("public signup cannot prepare claims before simulated owner admission; duplicate key admission fails", () => {
  const { token } = fixtureLogin();
  assert.throws(() => fixturePrepare(token, "issue"), /admission/);
  const privateKey = p256.utils.randomPrivateKey();
  const point = p256.getPublicKey(privateKey, false);
  const key = {
    keyId: toHex(sha(point)),
    qx: BigInt(toHex(point.slice(1, 33))),
    qy: BigInt(toHex(point.slice(33))),
  };
  fixtureAdmit(token, key);
  assert.throws(() => fixtureAdmit(token, key), /overwrite/);
});

test("real P-256 fixture assertions reject tampered digest, RP, origin, type and flags", async () => {
  const { token, privateKey } = setupFixture();
  const op = fixturePrepare(token, "issue");
  for (const change of [
    { rp: "evil.test" },
    { origin: "https://evil.test" },
    { type: "webauthn.create" },
    { flags: 1 },
    { flags: 4 },
    { flags: 0x15 },
    { challenge: "tampered" },
  ]) {
    await assert.rejects(
      fixtureSubmit(
        token,
        op.id,
        assertion(op.digest, privateKey, change),
        "http://localhost:3001",
      ),
      /refused/,
    );
  }
  const invalid = assertion(op.digest, privateKey);
  invalid.r = 1n;
  await assert.rejects(
    fixtureSubmit(token, op.id, invalid, "http://localhost:3001"),
    /signature refused/,
  );
});

test("known Chromium serialization sentinel is accepted without accepting arbitrary extra fields", async () => {
  const { token, privateKey } = setupFixture();
  const op = fixturePrepare(token, "issue");
  await assert.rejects(
    fixtureSubmit(
      token,
      op.id,
      assertion(op.digest, privateKey, { sentinel: "unrecognized" }),
      "http://localhost:3001",
    ),
    /refused/,
  );
  const out = await fixtureSubmit(
    token,
    op.id,
    assertion(op.digest, privateKey, {
      sentinel:
        "do not compare clientDataJSON against a template. See https://goo.gl/yabPex",
    }),
    "http://localhost:3001",
  );
  assert.equal(out.receipt, "confirmed");
});

test("completed cryptographic fixture issues, reads and revokes, with replay and stale nonce refused", async () => {
  const { token, privateKey } = setupFixture();
  const issue = fixturePrepare(token, "issue");
  const stale = fixturePrepare(token, "issue");
  const signed = assertion(issue.digest, privateKey);
  const out = await fixtureSubmit(
    token,
    issue.id,
    signed,
    "http://localhost:3001",
  );
  assert.equal(out.receipt, "confirmed");
  assert.equal(out.credential?.capable, true);
  await assert.rejects(
    fixtureSubmit(token, issue.id, signed, "http://localhost:3001"),
    /used/,
  );
  await assert.rejects(
    fixtureSubmit(
      token,
      stale.id,
      assertion(stale.digest, privateKey),
      "http://localhost:3001",
    ),
    /Stale/,
  );
  await new Promise((resolve) => setTimeout(resolve, 1005));
  const revoke = fixturePrepare(token, "revoke");
  const revoked = await fixtureSubmit(
    token,
    revoke.id,
    assertion(revoke.digest, privateKey),
    "http://localhost:3001",
  );
  assert.equal(revoked.credential?.capable, false);
  assert.equal(revoked.credential?.revoked, true);
});

test("pending, reverted and failed-read fixtures never return fabricated credentials", async () => {
  for (const scenario of ["pending", "reverted", "read-failure"]) {
    const { token, privateKey } = setupFixture();
    const op = fixturePrepare(token, "issue");
    const out = await fixtureSubmit(
      token,
      op.id,
      assertion(op.digest, privateKey),
      "http://localhost:3001",
      scenario,
    );
    assert.equal(out.credential, null);
    assert.equal(
      out.receipt,
      scenario === "read-failure" ? "confirmed" : scenario,
    );
  }
});

test("DER and hex parsing reject malformed browser signature inputs", () => {
  assert.deepEqual(
    derToRs(Uint8Array.from([0x30, 6, 2, 1, 1, 2, 1, 2]).buffer),
    { r: 1n, s: 2n },
  );
  for (const bytes of [
    [0x30, 7, 2, 1, 1, 2, 1, 2],
    [0x30, 6, 2, 1, 0x80, 2, 1, 2],
    [0x30, 6, 2, 1, 0, 2, 1, 2],
  ])
    assert.throws(() => derToRs(Uint8Array.from(bytes).buffer));
  assert.throws(() => browserHexToBytes("0x1"));
});

function request(body: unknown, origin = "https://ligis.vercel.app") {
  return new NextRequest("https://ligis.vercel.app/api/passkey", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
test("API forbids public enrollment and funded fallback; malformed bodies and origin mismatches are explicit", async () => {
  assert.equal((await POST(request({ action: "enroll" }))).status, 403);
  assert.equal((await POST(request({ action: "issue" }))).status, 503);
  assert.equal(
    (await POST(request({ action: "issue" }, "https://evil.test"))).status,
    403,
  );
  assert.equal((await POST(request(null))).status, 400);
  assert.equal((await POST(request([]))).status, 400);
  assert.equal(
    (await POST(request({ action: "issue", extra: "a".repeat(16_384) })))
      .status,
    400,
  );
  assert.equal((await POST(request({ action: "fixtureLogin" }))).status, 404);
});

test("fixture cannot be enabled in production; missing Privy auth is not operator authority", async () => {
  assert.equal(
    fixtureEnabled({ NODE_ENV: "production", LIGIS_PASSKEY_FIXTURE: "1" }),
    false,
  );
  assert.equal(
    fixtureEnabled({ NODE_ENV: "development", LIGIS_PASSKEY_FIXTURE: "1" }),
    true,
  );
  await assert.rejects(authenticatePasskeyUser(null), /Authentication/);
});
