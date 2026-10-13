import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { p256 } from "@noble/curves/p256";
import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  hashTypedData,
  hexToBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { verifyAccessToken, type PrivyEthereumService } from "@privy-io/node";
import { PASSKEY_ISSUER, PASSKEY_REGISTRY, prepareRevoke } from "./passkey";
import { capabilityHash } from "@ligis/core";

export const SPONSOR_ABI = parseAbi([
  "function issue(address issuer,address subject,bytes32 capabilityHash,uint64 issuedAt,uint64 expiresAt,uint256 nonce,bytes signature) returns (uint256)",
  "function revokeCredential(address registry,address subject,bytes32 capabilityHash,uint256 nonce,bytes32 keyId,bytes authenticatorData,bytes clientDataJSON,uint256 r,uint256 s)",
]);
export const SPONSOR_LIMITS = {
  chainId: 10143,
  perUserRequests: 4,
  globalRequests: 40,
  perUserSpendWei: 2_000_000_000_000_000n,
  globalSpendWei: 10_000_000_000_000_000n,
  maxRequestSpendWei: 1_000_000_000_000_000n,
  minIntervalMs: 1000,
} as const;

export type ScopedTransaction = {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
};

/** Defense in depth: callers must still bind the exact payload to a prepared
 * operation and an admitted key. A selector allowlist alone is insufficient. */
export function assertSponsorScope(tx: ScopedTransaction): void {
  if (tx.chainId !== 10143 || tx.value !== 0n)
    throw new Error("Sponsor chain/value refused.");
  const decoded = decodeFunctionData({ abi: SPONSOR_ABI, data: tx.data });
  const args = decoded.args!;
  if (decoded.functionName === "issue") {
    if (
      tx.to.toLowerCase() !== PASSKEY_REGISTRY.toLowerCase() ||
      String(args[0]).toLowerCase() !== PASSKEY_ISSUER.toLowerCase() ||
      args[2] !== capabilityHash("demo.passkey")
    )
      throw new Error("Sponsor issue scope refused.");
  } else if (decoded.functionName === "revokeCredential") {
    if (
      tx.to.toLowerCase() !== PASSKEY_ISSUER.toLowerCase() ||
      String(args[0]).toLowerCase() !== PASSKEY_REGISTRY.toLowerCase() ||
      args[2] !== capabilityHash("demo.passkey")
    )
      throw new Error("Sponsor revoke scope refused.");
  } else throw new Error("Sponsor selector refused.");
  const canonical = encodeFunctionData({
    abi: SPONSOR_ABI,
    functionName: decoded.functionName,
    args: decoded.args as never,
  });
  if (canonical.toLowerCase() !== tx.data.toLowerCase())
    throw new Error("Non-canonical or appended calldata refused.");
}

/** Type-checked provider boundary, not an enabled submission path. `approved`
 * must come from the server's authenticated operator operation, never the body.
 * Provider policy, durable quotas and wallet ownership must be enforced before
 * invoking the SDK. No fallback signer is provided. */
export function buildPrivySponsoredRequest(
  tx: ScopedTransaction,
  approved: ScopedTransaction,
  requestId: string,
): PrivyEthereumService.SendTransactionInput {
  assertSponsorScope(tx);
  if (
    tx.chainId !== approved.chainId ||
    tx.to.toLowerCase() !== approved.to.toLowerCase() ||
    tx.value !== approved.value ||
    tx.data.toLowerCase() !== approved.data.toLowerCase()
  ) {
    throw new Error(
      "Sponsor payload differs from approved operator operation.",
    );
  }
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(requestId))
    throw new Error("Sponsor idempotency key required.");
  return {
    caip2: "eip155:10143",
    sponsor: true,
    idempotency_key: requestId,
    params: {
      transaction: { to: tx.to, data: tx.data, value: "0x0", chain_id: 10143 },
    },
  };
}

/** Auth is identity only, NEVER issuer enrollment or trust. No app secret needed
 * for JWT verification; the verification key is public but kept server-side. */
export async function authenticatePasskeyUser(
  authorization: string | null,
): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const key = process.env.PRIVY_VERIFICATION_KEY;
  if (!appId || !key || !authorization?.startsWith("Bearer "))
    throw new Error("Authentication unavailable.");
  const result = await verifyAccessToken({
    app_id: appId,
    verification_key: key,
    access_token: authorization.slice(7),
  });
  return result.user_id;
}

/** Local fixture coordinator, NOT a production quota backend or funded relay.
 * Serializes pending nonce acquisition and submission. Reserves worst-case spend
 * before submission, retains ambiguous failures, and rejects duplicate requests.
 * A durable atomic quota/idempotency store is a prerequisite for any live mode. */
export class FixtureSponsor {
  private tail: Promise<unknown> = Promise.resolve();
  private poisoned = false;
  private nextNonce = 0;
  private requests = new Set<string>();
  private users = new Map<
    string,
    { count: number; spend: bigint; last: number }
  >();
  private totalCount = 0;
  private totalSpend = 0n;

  submit<T>(
    user: string,
    requestId: string,
    tx: ScopedTransaction,
    cost: bigint,
    send: (nonce: number) => Promise<T>,
    pendingNonce: () => Promise<number> = async () => 0,
    now = Date.now(),
  ): Promise<T> {
    const operation = this.tail.then(async () => {
      if (this.poisoned)
        throw new Error("Sponsor unavailable after ambiguous submission.");
      if (!user || !/^[a-zA-Z0-9-]{8,128}$/.test(requestId))
        throw new Error("Authenticated user and request ID required.");
      assertSponsorScope(tx);
      const id = `${user}:${requestId}`;
      if (this.requests.has(id)) throw new Error("Duplicate request refused.");
      const quota = this.users.get(user) ?? {
        count: 0,
        spend: 0n,
        last: -Infinity,
      };
      if (now - quota.last < SPONSOR_LIMITS.minIntervalMs)
        throw new Error("Sponsor rate limit.");
      if (
        cost <= 0n ||
        cost > SPONSOR_LIMITS.maxRequestSpendWei ||
        quota.count >= SPONSOR_LIMITS.perUserRequests ||
        this.totalCount >= SPONSOR_LIMITS.globalRequests ||
        quota.spend + cost > SPONSOR_LIMITS.perUserSpendWei ||
        this.totalSpend + cost > SPONSOR_LIMITS.globalSpendWei
      )
        throw new Error("Sponsor caps exhausted.");
      const pending = await pendingNonce();
      if (!Number.isSafeInteger(pending) || pending < 0)
        throw new Error("Unsafe pending nonce.");
      const nonce = Math.max(pending, this.nextNonce);
      this.requests.add(id);
      this.users.set(user, {
        count: quota.count + 1,
        spend: quota.spend + cost,
        last: now,
      });
      this.totalCount++;
      this.totalSpend += cost;
      this.nextNonce = nonce + 1;
      try {
        return await send(nonce);
      } catch {
        this.poisoned = true;
        throw new Error(
          "Sponsor unavailable; no fallback. Submission may be pending.",
        );
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

export const FIXTURE_WALLET =
  "0x000000000000000000000000000000000000cafe" as Address;
type FixtureKey = { keyId: Hex; qx: bigint; qy: bigint };
type Operation = {
  id: string;
  action: "issue" | "revoke";
  digest: Hex;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  capabilityHash: Hex;
  used: boolean;
  deadline: number;
};
type Session = {
  key?: FixtureKey;
  admitted: boolean;
  issuerNonce: bigint;
  credential?: { nonce: bigint; revoked: boolean; expiresAt: bigint };
  operations: Map<string, Operation>;
  sponsor: FixtureSponsor;
  expires: number;
};
const sessions = new Map<string, Session>();
const sha = (data: Uint8Array | string) =>
  new Uint8Array(createHash("sha256").update(data).digest());
const b64 = (digest: Hex) =>
  Buffer.from(hexToBytes(digest)).toString("base64url");

export function fixtureLogin() {
  for (const [id, session] of sessions)
    if (session.expires < Date.now()) sessions.delete(id);
  if (sessions.size >= 40) throw new Error("Fixture session cap reached.");
  const token = randomUUID();
  sessions.set(token, {
    admitted: false,
    issuerNonce: 0n,
    operations: new Map(),
    sponsor: fixtureSponsor,
    expires: Date.now() + 3_600_000,
  });
  return { token, wallet: FIXTURE_WALLET, fixture: true };
}
const fixtureSponsor = new FixtureSponsor();
function sessionFor(token: string | null): Session {
  const session = token ? sessions.get(token) : null;
  if (!session || session.expires < Date.now())
    throw new Error("Fixture sign-in required.");
  return session;
}

export function fixtureAdmit(token: string | null, key: FixtureKey) {
  const session = sessionFor(token);
  if (session.admitted)
    throw new Error("Fixture operator already admitted a key; no overwrite.");
  const point = new Uint8Array([
    4,
    ...hexToBytes(toHex(key.qx, { size: 32 })),
    ...hexToBytes(toHex(key.qy, { size: 32 })),
  ]);
  p256.ProjectivePoint.fromHex(point).assertValidity();
  session.key = key;
  session.admitted = true;
  return { fixture: true, admitted: true };
}

export function fixturePrepare(
  token: string | null,
  action: "issue" | "revoke",
) {
  const session = sessionFor(token);
  if (!session.admitted)
    throw new Error("Operator admission required; signup alone cannot issue.");
  if (
    action === "revoke" &&
    (!session.credential || session.credential.revoked)
  )
    throw new Error("No active fixture credential.");
  if (session.operations.size >= 20)
    throw new Error("Fixture operation cap reached.");
  const nonce =
    action === "issue" ? session.issuerNonce : session.credential!.nonce;
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = issuedAt + 3600n;
  const capHash = capabilityHash("demo.passkey") as Hex;
  const digest =
    action === "revoke"
      ? prepareRevoke(FIXTURE_WALLET, capHash, nonce)
      : hashTypedData({
          domain: {
            name: "PharosAgentCredential",
            version: "1",
            chainId: 10143,
            verifyingContract: PASSKEY_REGISTRY,
          },
          types: {
            Credential: [
              { name: "issuer", type: "address" },
              { name: "subject", type: "address" },
              { name: "capabilityHash", type: "bytes32" },
              { name: "issuedAt", type: "uint256" },
              { name: "expiresAt", type: "uint256" },
              { name: "nonce", type: "uint256" },
            ],
          },
          primaryType: "Credential",
          message: {
            issuer: PASSKEY_ISSUER,
            subject: FIXTURE_WALLET,
            capabilityHash: capHash,
            issuedAt,
            expiresAt,
            nonce,
          },
        });
  const operation: Operation = {
    id: randomUUID(),
    action,
    digest,
    nonce: String(nonce),
    issuedAt: String(issuedAt),
    expiresAt: String(expiresAt),
    capabilityHash: capHash,
    used: false,
    deadline: Date.now() + 120_000,
  };
  session.operations.set(operation.id, operation);
  return operation;
}

export async function fixtureSubmit(
  token: string | null,
  operationId: string,
  assertion: {
    authenticatorData: Hex;
    clientDataJSON: Hex;
    r: bigint;
    s: bigint;
  },
  origin: string,
  scenario: string = "confirmed",
) {
  const session = sessionFor(token);
  const op = session.operations.get(operationId);
  if (
    !session.admitted ||
    !session.key ||
    !op ||
    op.used ||
    op.deadline < Date.now()
  )
    throw new Error("Unknown, expired or used fixture operation.");
  if (op.action === "issue" && BigInt(op.nonce) !== session.issuerNonce)
    throw new Error("Stale issuer nonce.");
  const auth = hexToBytes(assertion.authenticatorData);
  const clientBytes = hexToBytes(assertion.clientDataJSON);
  const client = new TextDecoder().decode(clientBytes);
  const expected = `{"type":"webauthn.get","challenge":"${b64(op.digest)}","origin":"${origin}"`;
  const rpId = new URL(origin).hostname;
  const sentinel =
    ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"';
  if (
    auth.length < 37 ||
    (auth[32] & 5) !== 5 ||
    ((auth[32] & 16) !== 0 && (auth[32] & 8) === 0) ||
    toHex(auth.slice(0, 32)) !== toHex(sha(rpId)) ||
    ![
      `${expected}}`,
      `${expected},"crossOrigin":false}`,
      `${expected}${sentinel}}`,
      `${expected},"crossOrigin":false${sentinel}}`,
    ].includes(client)
  ) {
    throw new Error(
      "Fixture assertion origin/RP/type/challenge/flags refused.",
    );
  }
  const point = new Uint8Array([
    4,
    ...hexToBytes(toHex(session.key.qx, { size: 32 })),
    ...hexToBytes(toHex(session.key.qy, { size: 32 })),
  ]);
  const hash = sha(new Uint8Array([...auth, ...sha(clientBytes)]));
  const signature = new Uint8Array([
    ...hexToBytes(toHex(assertion.r, { size: 32 })),
    ...hexToBytes(toHex(assertion.s, { size: 32 })),
  ]);
  if (!p256.verify(signature, hash, point, { lowS: false }))
    throw new Error("Fixture P-256 signature refused.");
  // Exact canonical calldata is generated server-side, never supplied by the caller.
  const { encodeAbiParameters } = await import("viem");
  const erc1271 = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes" },
      { type: "bytes" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      session.key.keyId,
      assertion.authenticatorData,
      assertion.clientDataJSON,
      assertion.r,
      assertion.s,
    ],
  );
  const tx: ScopedTransaction = {
    chainId: 10143,
    value: 0n,
    to: op.action === "issue" ? PASSKEY_REGISTRY : PASSKEY_ISSUER,
    data:
      op.action === "issue"
        ? encodeFunctionData({
            abi: SPONSOR_ABI,
            functionName: "issue",
            args: [
              PASSKEY_ISSUER,
              FIXTURE_WALLET,
              op.capabilityHash,
              BigInt(op.issuedAt),
              BigInt(op.expiresAt),
              BigInt(op.nonce),
              erc1271,
            ],
          })
        : encodeFunctionData({
            abi: SPONSOR_ABI,
            functionName: "revokeCredential",
            args: [
              PASSKEY_REGISTRY,
              FIXTURE_WALLET,
              op.capabilityHash,
              BigInt(op.nonce),
              session.key.keyId,
              assertion.authenticatorData,
              assertion.clientDataJSON,
              assertion.r,
              assertion.s,
            ],
          }),
  };
  op.used = true;
  return session.sponsor.submit(
    token!,
    op.id,
    tx,
    1_000_000_000_000n,
    async (nonce) => {
      if (scenario === "outage") throw new Error("Fixture sponsor outage");
      if (scenario === "pending" || scenario === "reverted")
        return {
          fixture: true,
          receipt: scenario,
          relayNonce: nonce,
          credential: null,
        };
      if (op.action === "issue") {
        // Recheck inside the serial submission queue, after earlier operations settle.
        if (BigInt(op.nonce) !== session.issuerNonce)
          throw new Error("Stale issuer nonce.");
        session.issuerNonce++;
        session.credential = {
          nonce: BigInt(op.nonce),
          revoked: false,
          expiresAt: BigInt(op.expiresAt),
        };
      } else {
        if (
          !session.credential ||
          session.credential.revoked ||
          session.credential.nonce !== BigInt(op.nonce)
        )
          throw new Error("No active credential.");
        session.credential.revoked = true;
      }
      return {
        fixture: true,
        receipt: "confirmed",
        relayNonce: nonce,
        credential:
          scenario === "read-failure"
            ? null
            : {
                subject: FIXTURE_WALLET,
                capability: "demo.passkey",
                issuer: PASSKEY_ISSUER,
                revoked: session.credential!.revoked,
                nonce: String(session.credential!.nonce),
                capable: !session.credential!.revoked,
                expiresAt: String(session.credential!.expiresAt),
              },
        readState: scenario === "read-failure" ? "unavailable" : "read",
      };
    },
  );
}
