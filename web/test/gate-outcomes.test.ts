import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { OutcomeRecorder } from "../lib/gate-outcomes/recorder";
import {
  MemoryOutcomeBackend,
  UpstashOutcomeBackend,
  RECORD_TTL_SECONDS,
  PROOF_TTL_SECONDS,
  MAX_WRITES_PER_HOUR,
  MAX_ATTEMPTS_PER_HOUR,
  OUTCOME_ATOMIC_LUA,
} from "../lib/gate-outcomes/backend";
import { parseCallerGrants, type CallerGrant } from "../lib/gate-outcomes/auth";
import { loadOutcomeRuntime } from "../lib/gate-outcomes/runtime";
import { handleOutcomePost } from "../lib/gate-outcomes/http";
import type {
  DecisionInput,
  DecisionRecord,
} from "../lib/gate-outcomes/schema";
import type {
  ProofObservation,
  ProofVerifier,
} from "../lib/gate-outcomes/proof";
import { createRpcProofVerifier } from "../lib/gate-outcomes/proof";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";

const tokenA = "fixture_A_" + "a".repeat(32);
const tokenB = "fixture_B_" + "b".repeat(32);
const grants: CallerGrant[] = [
  {
    tenant: "team-a",
    tokenSha256: createHash("sha256").update(tokenA).digest("hex"),
    optIn: true,
  },
  {
    tenant: "team-b",
    tokenSha256: createHash("sha256").update(tokenB).digest("hex"),
    optIn: true,
  },
];
const headersA = new Headers({
  Authorization: `Bearer ${tokenA}`,
  "Content-Type": "application/json",
});
const headersB = new Headers({
  Authorization: `Bearer ${tokenB}`,
  "Content-Type": "application/json",
});
const input: DecisionInput = {
  verdict: "GO",
  policyVersion: "operator-v1",
  evidenceVersion: "evidence-v1",
  sources: { nansen: "unknown", "ligis-credential": "positive" },
  context: {
    payee: `0x${"c".repeat(40)}`,
    amountUsd: 1,
    capability: "data.premium",
  },
  settlement: {
    chainId: 10143,
    asset: `0x${"a".repeat(40)}`,
    payer: `0x${"b".repeat(40)}`,
    payee: `0x${"c".repeat(40)}`,
    amountBaseUnits: "1000000",
  },
};
const txHash = `0x${"d".repeat(64)}`;
function setup(overrides: Partial<ProofObservation> = {}, enabled = true) {
  let time = Date.parse("2026-10-13T00:00:00Z");
  const now = () => time;
  let calls = 0;
  const backend = new MemoryOutcomeBackend(now);
  const verifier: ProofVerifier = async (hash) => {
    calls++;
    return {
      txHash: hash,
      status: "success",
      finalized: true,
      blockTime: Math.floor(time / 1000),
      ...input.settlement!,
      logIndex: 0,
      ...overrides,
    };
  };
  const recorder = new OutcomeRecorder({
    enabled,
    backend,
    grants,
    hashKey: "fixture-HMAC-key-" + "k".repeat(32),
    now,
    verifier,
  });
  return {
    recorder,
    backend,
    verifierCalls: () => calls,
    now,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
async function create(
  recorder: OutcomeRecorder,
  data: unknown = input,
  headers = headersA,
) {
  const result = await recorder.recordDecision(data, {
    method: "POST",
    headers,
  });
  assert.equal(result.stored, true);
  if (!result.stored) throw Error("fixture create failed");
  return result.decisionId;
}
const submission = (
  decisionId: string,
  override: Record<string, unknown> = {},
) => ({
  decisionId,
  reportId: randomUUID(),
  kind: "transaction",
  txHash,
  logIndex: 0,
  ...override,
});

test("Default off/missing config, public GET/embed and flag-off decisions create no records", async () => {
  assert.equal(loadOutcomeRuntime({}), null);
  assert.equal(loadOutcomeRuntime({ LIGIS_OUTCOMES_ENABLED: "1" }), null);
  const off = setup({}, false);
  assert.equal(
    (
      await off.recorder.recordDecision(input, {
        method: "POST",
        headers: headersA,
      })
    ).stored,
    false,
  );
  assert.equal(off.backend.records.size, 0);
  const on = setup();
  for (const method of ["GET", "HEAD"]) {
    assert.equal(
      (await on.recorder.recordDecision(input, { method, headers: headersA }))
        .stored,
      false,
    );
  }
  assert.equal(on.backend.records.size, 0);
});

test("Authentication is server configured; unauthorized and cross-tenant reads/writes are refused", async () => {
  const { recorder, backend } = setup();
  for (const headers of [
    new Headers(),
    new Headers({ Authorization: "Bearer wrong", "x-tenant": "team-a" }),
  ]) {
    assert.equal(
      (await recorder.recordDecision(input, { method: "POST", headers }))
        .stored,
      false,
    );
    assert.equal(
      (await recorder.ingest(submission(randomUUID()), headers)).stored,
      false,
    );
  }
  assert.equal(backend.records.size, 0);
  const id = await create(recorder);
  assert.equal(await recorder.readDecision(id, headersB), null);
  const result = await recorder.ingest(submission(id), headersB);
  assert.equal(result.stored, false);
  if (!result.stored) assert.equal(result.status, 404);
  assert.equal(await recorder.readDecision(id, new Headers()), null);
  assert.equal(
    parseCallerGrants(JSON.stringify([{ ...grants[0], optIn: false }])),
    null,
  );
  assert.equal(parseCallerGrants(JSON.stringify([grants[0], grants[0]])), null);
});

test("Strict projection rejects raw purpose/page text/request secrets and stores only protected identifiers", async () => {
  const { recorder, backend } = setup();
  for (const raw of [
    { ...input, purpose: "sensitive purpose" },
    { ...input, pageText: "raw page content" },
    { ...input, sources: { providerSecret: tokenA } },
    { ...input, sources: {} },
    { ...input, context: { ...input.context, prompt: "raw prompt" } },
    { ...input, settlement: { ...input.settlement, amountBaseUnits: "1.5" } },
    {
      ...input,
      settlement: { ...input.settlement, payee: `0x${"0".repeat(40)}` },
    },
  ])
    assert.equal(
      (
        await recorder.recordDecision(raw, {
          method: "POST",
          headers: headersA,
        })
      ).stored,
      false,
    );
  assert.equal(backend.records.size, 0);
  await create(recorder);
  const serialized = [...backend.records.values()].join("");
  for (const forbidden of [
    tokenA,
    tokenB,
    input.context.payee,
    input.settlement!.asset,
    input.settlement!.payer,
    "team-a",
    "Authorization",
    "purpose",
    "pageText",
    "prompt",
    "session",
    "IP",
  ])
    assert.ok(!serialized.includes(forbidden), forbidden);
});

test("All adversarial proofs remain distinct from verified matching settlement", async () => {
  const cases: [Partial<ProofObservation>, string][] = [
    [{ chainId: 143 }, "unverified-transaction"],
    [{ txHash: `0x${"e".repeat(64)}` }, "unverified-transaction"],
    [{ asset: `0x${"e".repeat(40)}` }, "unverified-transaction"],
    [{ payer: `0x${"e".repeat(40)}` }, "unverified-transaction"],
    [{ payee: `0x${"e".repeat(40)}` }, "unverified-transaction"],
    [{ amountBaseUnits: "999999" }, "unverified-transaction"],
    [
      { asset: undefined, payer: undefined, payee: undefined },
      "unverified-transaction",
    ],
    [{ logIndex: 1 }, "unverified-transaction"],
    [{ status: "pending" }, "pending-transaction"],
    [{ finalized: false }, "pending-transaction"],
    [{ blockTime: 1 }, "unverified-transaction"],
    [{ blockTime: 9999999999 }, "unverified-transaction"],
    [{ status: "reverted" }, "verified-reverted"],
  ];
  for (const [proof, expected] of cases) {
    const { recorder } = setup(proof);
    const id = await create(recorder);
    const result = await recorder.ingest(submission(id), headersA);
    assert.equal(result.stored, true);
    if (result.stored)
      assert.equal(result.outcome?.status, expected, JSON.stringify(proof));
  }
  const { recorder, verifierCalls } = setup();
  const id = await create(recorder, { ...input, settlement: undefined });
  const result = await recorder.ingest(submission(id), headersA);
  assert.equal(verifierCalls(), 0);
  if (result.stored)
    assert.equal(result.outcome?.reason, "missing-complete-binding");
});

test("Identical reports are idempotent, report-ID replay and conflicting verified proofs cannot overwrite", async () => {
  const { recorder, backend } = setup();
  const id = await create(recorder);
  const report = submission(id);
  const results = await Promise.all([
    recorder.ingest(report, headersA),
    recorder.ingest(report, headersA),
  ]);
  assert.ok(results.every((result) => result.stored));
  const before = backend.records.get(id);
  const duplicate = await recorder.ingest(report, headersA);
  assert.ok(duplicate.stored && duplicate.duplicate);
  assert.equal(backend.records.get(id), before);
  const replay = await recorder.ingest(
    { ...report, kind: "feedback", txHash: undefined, logIndex: undefined },
    headersA,
  );
  assert.equal(replay.stored, false); // Schema refuses unknown fields even if undefined.
  const conflict = await recorder.ingest(
    submission(id, { txHash: `0x${"e".repeat(64)}` }),
    headersA,
  );
  assert.equal(conflict.stored, false);
  const feedback = await recorder.ingest(
    { decisionId: id, reportId: randomUUID(), kind: "feedback" },
    headersA,
  );
  assert.equal(feedback.stored, false);
  const disputeReport = {
    decisionId: id,
    reportId: randomUUID(),
    kind: "dispute",
  };
  const dispute = await recorder.ingest(disputeReport, headersA);
  assert.equal(dispute.stored, true);
  const disputeDuplicate = await recorder.ingest(disputeReport, headersA);
  assert.ok(
    disputeDuplicate.stored &&
      disputeDuplicate.duplicate &&
      disputeDuplicate.outcome?.status === "unverified-service-dispute",
  );
  const record = await recorder.readDecision(id, headersA);
  assert.equal(record?.outcome?.status, "verified-matching-settlement");
  assert.equal(record?.dispute?.status, "unverified-service-dispute");
  assert.ok(!JSON.stringify(record).includes(txHash));
});

test("One transaction cannot count across decision IDs, logs or tenants; proof claims are atomic", async () => {
  const { recorder } = setup();
  const first = await create(recorder);
  const second = await create(recorder);
  const otherTenant = await create(recorder, input, headersB);
  const results = await Promise.all([
    recorder.ingest(submission(first), headersA),
    recorder.ingest(submission(second), headersA),
  ]);
  assert.equal(results.filter((r) => r.stored).length, 1);
  const other = await recorder.ingest(submission(otherTenant), headersB);
  assert.equal(other.stored, false);
  if (!other.stored) assert.equal(other.reason, "proof-used");
});

test("Unverified caller feedback, pending transaction and dispute remain separate; same ID cannot change content", async () => {
  const { recorder } = setup({ status: "pending" });
  const id = await create(recorder);
  const feedback = { decisionId: id, reportId: randomUUID(), kind: "feedback" };
  let result = await recorder.ingest(feedback, headersA);
  if (result.stored)
    assert.equal(result.outcome?.status, "unverified-caller-feedback");
  result = await recorder.ingest({ ...feedback, kind: "dispute" }, headersA);
  assert.equal(result.stored, false);
  if (!result.stored) assert.equal(result.reason, "report-id-replay");
  result = await recorder.ingest(submission(id), headersA);
  if (result.stored)
    assert.equal(result.outcome?.status, "pending-transaction");
});

test("Bounded TTL is not extended by updates; expired IDs and historical proofs cannot replay", async () => {
  const { recorder, backend, advance, now } = setup();
  const id = await create(recorder);
  const expiry = (await recorder.readDecision(id, headersA))!.expiresAt;
  advance(1000);
  assert.equal((await recorder.ingest(submission(id), headersA)).stored, true);
  assert.equal((await recorder.readDecision(id, headersA))!.expiresAt, expiry);
  assert.equal(backend.proofs.size, 1);
  assert.equal(
    [...backend.proofs.values()][0].until,
    now() + PROOF_TTL_SECONDS * 1000,
  );
  advance(RECORD_TTL_SECONDS * 1000);
  assert.equal(await recorder.readDecision(id, headersA), null);
  assert.equal((await recorder.ingest(submission(id), headersA)).stored, false);
});

test("Storage loss never mutates a risk decision or reports successful storage", async () => {
  const snapshot = JSON.stringify(input);
  const fail = new OutcomeRecorder({
    enabled: true,
    grants,
    hashKey: "fixture-" + "k".repeat(32),
    backend: {
      admit: async () => {
        throw Error("raw secret upstream");
      },
      read: async () => {
        throw Error("raw secret upstream");
      },
      atomic: async () => {
        throw Error("raw secret upstream");
      },
    },
  });
  const result = await fail.recordDecision(input, {
    method: "POST",
    headers: headersA,
  });
  assert.equal(result.stored, false);
  if (!result.stored) assert.equal(result.reason, "storage-unavailable");
  assert.equal(JSON.stringify(input), snapshot);
  assert.ok(!JSON.stringify(result).includes("raw secret"));
  assert.equal(
    (await fail.ingest(submission(randomUUID()), headersA)).stored,
    false,
  );
});

test("Write quotas and per-record report bounds refuse runaway authenticated callers", async () => {
  const { recorder, backend } = setup();
  const id = await create(recorder);
  for (let i = 0; i < 8; i++) {
    assert.equal(
      (
        await recorder.ingest(
          { decisionId: id, reportId: randomUUID(), kind: "feedback" },
          headersA,
        )
      ).stored,
      true,
    );
  }
  assert.equal(
    (
      await recorder.ingest(
        { decisionId: id, reportId: randomUUID(), kind: "feedback" },
        headersA,
      )
    ).stored,
    false,
  );
  for (let i = 9; i < MAX_WRITES_PER_HOUR; i++) await create(recorder);
  const result = await recorder.recordDecision(input, {
    method: "POST",
    headers: headersA,
  });
  assert.equal(result.stored, false);
  if (!result.stored) assert.equal(result.status, 429);
  assert.equal(backend.records.size, MAX_WRITES_PER_HOUR - 8);
});

test("Admission quota bounds reads and proof verification, including valid-ID spam", async () => {
  const { recorder, verifierCalls } = setup();
  const id = await create(recorder);
  const report = submission(id);
  assert.equal((await recorder.ingest(report, headersA)).stored, true);
  for (let i = 2; i < MAX_ATTEMPTS_PER_HOUR; i++)
    assert.equal((await recorder.ingest(report, headersA)).stored, true);
  const refused = await recorder.ingest(submission(id), headersA);
  assert.equal(refused.stored, false);
  if (!refused.stored) assert.equal(refused.reason, "attempt-limit");
  assert.equal(verifierCalls(), 1);
});

test("HTTP refuses unauthorized, oversized streaming/declaration, malformed and extra-field bodies", async () => {
  const { recorder } = setup();
  const runtime = { recorder, grants };
  const id = await create(recorder);
  for (const [body, expected] of [
    ["{", 400],
    [
      JSON.stringify({ ...submission(id), tenant: "team-a", prompt: "raw" }),
      400,
    ],
    ["x".repeat(2049), 413],
    [
      JSON.stringify({ decisionId: id, reportId: "bad", kind: "feedback" }),
      400,
    ],
  ] as const) {
    const res = await handleOutcomePost(
      new Request("https://fixture.invalid/api/gate/outcomes", {
        method: "POST",
        headers: headersA,
        body,
      }),
      runtime,
    );
    assert.equal(res.status, expected);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(
    (
      await handleOutcomePost(
        new Request("https://fixture.invalid", {
          method: "POST",
          body: "raw-secret",
        }),
        runtime,
      )
    ).status,
    401,
  );
  assert.equal(
    (await handleOutcomePost(new Request("https://fixture.invalid"), runtime))
      .status,
    405,
  );
  const oversized = new Headers(headersA);
  oversized.set("Content-Length", "9999");
  assert.equal(
    (
      await handleOutcomePost(
        new Request("https://fixture.invalid", {
          method: "POST",
          headers: oversized,
          body: "{}",
        }),
        runtime,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await handleOutcomePost(
        new Request("https://fixture.invalid", {
          method: "POST",
          headers: headersA,
          body: JSON.stringify(submission(id)),
        }),
        runtime,
      )
    ).status,
    200,
  );
});

test("Upstash backend awaits bounded atomic EVAL, uses separate namespace/TTL and handles durable errors", async () => {
  const { recorder, backend, now } = setup();
  const id = await create(recorder);
  const record = JSON.parse(backend.records.get(id)!) as DecisionRecord;
  const commands: unknown[][] = [];
  const upstash = new UpstashOutcomeBackend(
    "https://fixture.invalid",
    "fixture-kv-secret",
    async (_, init) => {
      assert.equal(init!.redirect, "error");
      const command = JSON.parse(init!.body as string);
      commands.push(command);
      return Response.json({ result: command[0] === "GET" ? null : "stored" });
    },
    now,
  );
  assert.equal(await upstash.read(id), null);
  assert.equal(
    await upstash.atomic({
      record,
      expected: null,
      proofKey: "protected-proof",
    }),
    "stored",
  );
  const command = commands[1];
  assert.deepEqual(command.slice(0, 3), ["EVAL", OUTCOME_ATOMIC_LUA, 3]);
  assert.ok(
    String(command[3]).startsWith("ligis:{gate-outcomes-v1}:decision:"),
  );
  assert.equal(command[8], RECORD_TTL_SECONDS);
  assert.equal(command[11], PROOF_TTL_SECONDS);
  assert.ok(!JSON.stringify(commands).includes("fixture-kv-secret"));
  const failure = new UpstashOutcomeBackend(
    "https://fixture.invalid",
    "fixture",
    async () => Response.json({ error: "upstream details" }),
  );
  await assert.rejects(failure.read(id), /backend-unavailable/);
});

test("Real RPC verifier decodes matching Transfer, canonical finalized blocks, and reverted direct-transfer intent", async () => {
  const abi = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function transfer(address to, uint256 value) returns (bool)",
  ]);
  const blockHash = `0x${"f".repeat(64)}`;
  const settlement = input.settlement!;
  const log = {
    address: settlement.asset,
    blockHash,
    blockNumber: "0x1",
    transactionHash: txHash,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
    data: encodeAbiParameters([{ type: "uint256" }], [1000000n]),
    topics: encodeEventTopics({
      abi,
      eventName: "Transfer",
      args: { from: settlement.payer as Hex, to: settlement.payee as Hex },
    }),
  };
  const receipt = {
    transactionHash: txHash,
    blockHash,
    blockNumber: "0x1",
    status: "0x1",
    transactionIndex: "0x0",
    cumulativeGasUsed: "0x1",
    gasUsed: "0x1",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs: [log],
    from: settlement.payer,
    to: settlement.asset,
  };
  const make = (
    options: {
      chain?: string;
      canonical?: string;
      finalizedNumber?: string;
      receipt?: unknown;
      pending?: boolean;
    } = {},
  ) =>
    createRpcProofVerifier({
      url: "https://fixture.invalid",
      chainId: 10143,
      assets: [settlement.asset],
      transport: async (_, init) => {
        const body = JSON.parse(init!.body as string);
        let result: unknown;
        switch (body.method) {
          case "eth_chainId":
            result = options.chain ?? "0x279f";
            break;
          case "eth_getTransactionReceipt":
            result = options.pending ? null : (options.receipt ?? receipt);
            break;
          case "eth_getBlockByNumber":
            result = {
              hash:
                body.params[0] === "finalized"
                  ? blockHash
                  : (options.canonical ?? blockHash),
              number:
                body.params[0] === "finalized"
                  ? (options.finalizedNumber ?? "0x1")
                  : "0x1",
              timestamp: "0x6acc3800",
              transactions: [],
            };
            break;
          case "eth_getTransactionByHash":
            result = {
              hash: txHash,
              blockHash,
              blockNumber: "0x1",
              transactionIndex: "0x0",
              from: settlement.payer,
              to: settlement.asset,
              value: "0x0",
              gas: "0x100",
              gasPrice: "0x1",
              nonce: "0x0",
              type: "0x0",
              input: encodeFunctionData({
                abi,
                functionName: "transfer",
                args: [settlement.payee as Hex, 1000000n],
              }),
            };
            break;
          default:
            throw Error("unexpected fixture method: " + body.method);
        }
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });
  const matched = await make()(txHash, 0);
  assert.equal(matched.finalized, true);
  assert.equal(matched.amountBaseUnits, settlement.amountBaseUnits);
  assert.equal(matched.payer?.toLowerCase(), settlement.payer);
  assert.equal(matched.payee?.toLowerCase(), settlement.payee);
  assert.equal((await make({ pending: true })(txHash, 0)).status, "pending");
  assert.equal(
    (await make({ finalizedNumber: "0x0" })(txHash, 0)).finalized,
    false,
  );
  assert.equal((await make()(txHash, 1)).asset, undefined);
  assert.equal(
    (
      await make({
        receipt: {
          ...receipt,
          logs: [{ ...log, address: `0x${"e".repeat(40)}` }],
        },
      })(txHash, 0)
    ).asset,
    undefined,
  );
  assert.equal(
    (
      await make({
        receipt: { ...receipt, logs: [{ ...log, removed: true }] },
      })(txHash, 0)
    ).asset,
    undefined,
  );
  await assert.rejects(make({ chain: "0x8f" })(txHash, 0), /rpc-wrong-chain/);
  await assert.rejects(
    make({ canonical: `0x${"e".repeat(64)}` })(txHash, 0),
    /noncanonical-proof/,
  );
  const reverted = await make({
    receipt: { ...receipt, status: "0x0", logs: [] },
  })(txHash, 0);
  assert.equal(reverted.status, "reverted");
  assert.equal(reverted.amountBaseUnits, "1000000");
});

test("STOP, absent verifier and provider failure never become verified settlement", async () => {
  const { recorder } = setup();
  const stopped = await create(recorder, { ...input, verdict: "STOP" });
  const stoppedResult = await recorder.ingest(submission(stopped), headersA);
  assert.ok(
    stoppedResult.stored && stoppedResult.outcome?.reason === "decision-not-go",
  );
  for (const verifier of [
    undefined,
    async () => {
      throw Error("provider secret body");
    },
  ]) {
    const backend = new MemoryOutcomeBackend();
    const service = new OutcomeRecorder({
      enabled: true,
      grants,
      hashKey: "fixture-" + "k".repeat(32),
      backend,
      verifier,
    });
    const id = await create(service);
    const result = await service.ingest(submission(id), headersA);
    assert.ok(result.stored && result.outcome?.verification === "unverified");
    assert.ok(!JSON.stringify(result).includes("provider secret"));
  }
});
