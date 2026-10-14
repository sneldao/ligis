import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import {
  readErc8004,
  MONAD_ERC8004,
  type Erc8004Rpc,
  type Erc8004Options,
  type Erc8004Graphql,
  type ReputationPolicy,
} from "@/lib/payee-evidence/erc8004";
import { readPayeeEvidence } from "@/lib/payee-evidence";

// Reproducible non-demo identity. These are doubles, not a claimed live registration.
const PAYEE: Address = "0x1111111111111111111111111111111111111111";
const OWNER: Address = "0x2222222222222222222222222222222222222222";
const CLIENT1: Address = "0x3333333333333333333333333333333333333333";
const CLIENT2: Address = "0x4444444444444444444444444444444444444444";
const ID = 424242n;
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const chain = { ...MONAD_ERC8004, seedAgentIds: [] };
const policy: ReputationPolicy = {
  trustedClients: [CLIENT1, CLIENT2],
  tag1: "delivery",
  tag2: "quality",
  minimumValueWad: 80n * 10n ** 18n,
  minimumClients: 2,
};
function rpc(extra: Partial<Erc8004Rpc> = {}): Erc8004Rpc {
  return {
    getChainId: async () => 10143,
    getBlockNumber: async () => 5n,
    getLogs: async (r) =>
      r.event.name === "Registered"
        ? [{ args: { agentId: ID, owner: PAYEE } }]
        : [],
    readContract: async (r) => {
      assert.equal(r.blockNumber, 5n, "all reads share one finalized snapshot");
      switch (r.functionName) {
        case "getIdentityRegistry":
          return chain.identity;
        case "getAgentWallet":
          return PAYEE;
        case "ownerOf":
          return OWNER;
        case "tokenURI":
          return "ipfs://test-unfamiliar";
        case "getClients":
          return [CLIENT1, CLIENT2];
        case "getLastIndex":
          return 1n;
        case "isAuthorizedOrOwner":
          return false;
        case "readFeedback":
          return r.args?.[1] === CLIENT1
            ? [8500n, 2, "delivery", "quality", false]
            : [90n, 0, "delivery", "quality", false];
        default:
          throw new Error("unexpected read");
      }
    },
    ...extra,
  };
}
const opts = (extra: Erc8004Options = {}): Erc8004Options => ({
  chain,
  rpc: rpc(),
  env: { NODE_ENV: "test" },
  reputationPolicy: policy,
  ...extra,
});

test("discovers non-demo agent from Registered and confirms wallet != NFT owner", async () => {
  const read = await readErc8004(PAYEE, opts());
  assert.equal(read.profiles[0].agentId, ID);
  assert.equal(read.profiles[0].owner, OWNER);
  assert.equal(read.profiles[0].wallet, PAYEE);
  assert.equal(read.evidence.status, "positive");
  assert.equal(read.profiles[0].feedback[0].valueDecimals, 2);
  assert.match(read.evidence.reference!, /eip155:10143:.*:424242@5/);
});

test("MetadataSet discovery supports a wallet other than registration owner", async () => {
  const read = await readErc8004(
    PAYEE,
    opts({
      rpc: rpc({
        getLogs: async (r) =>
          r.event.name === "MetadataSet"
            ? [
                {
                  args: {
                    agentId: ID,
                    metadataKey: "agentWallet",
                    metadataValue: PAYEE,
                  },
                },
              ]
            : [],
      }),
    }),
  );
  assert.equal(read.profiles[0].agentId, ID);
});

test("paginated indexer discovers multiple scoped IDs and retains event references", async () => {
  let pages = 0;
  const graphql: Erc8004Graphql = async (query, v) => {
    if (query.includes("query Erc8004Coverage"))
      return {
        chain_metadata: [
          {
            chain_id: 10143,
            start_block: 10391600,
            latest_processed_block: 5,
          },
        ],
      };
    if (query.includes("query Erc8004References"))
      return {
        Erc8004Feedback: v.cursor
          ? []
          : [
              {
                id: "ref1",
                client: CLIENT1,
                feedbackIndex: "1",
                endpoint: "https://example.invalid",
                feedbackURI: "ipfs://delivery-proof",
                feedbackHash: `0x${"ab".repeat(32)}`,
              },
            ],
      };
    pages++;
    const id = !v.cursor ? "row1" : v.cursor === "row1" ? "row2" : null;
    return {
      Erc8004WalletBinding: id
        ? [
            {
              id,
              chainId: 10143,
              registry: chain.identity,
              wallet: PAYEE,
              agentId: id === "row1" ? ID.toString() : "424243",
            },
          ]
        : [],
    };
  };
  const read = await readErc8004(
    PAYEE,
    opts({ graphql, pageSize: 1, maxPages: 3 }),
  );
  assert.equal(pages, 3);
  assert.equal(read.profiles.length, 2);
  assert.equal(read.evidence.status, "positive");
  assert.equal(
    read.profiles[0].feedback[0].feedbackURI,
    "ipfs://delivery-proof",
  );
});

test("stale indexed bindings and NFT ownership are not accepted as current agent wallets", async () => {
  for (const wallet of [OWNER, ZERO]) {
    const base = rpc();
    const read = await readErc8004(
      PAYEE,
      opts({
        rpc: rpc({
          readContract: (r) =>
            r.functionName === "getAgentWallet"
              ? Promise.resolve(wallet)
              : base.readContract(r),
        }),
      }),
    );
    assert.equal(read.profiles.length, 0);
    assert.equal(read.evidence.status, "unknown");
  }
});

test("wrong chain RPC or reputation registry binding returns unavailable", async () => {
  const wrongChain = await readErc8004(
    PAYEE,
    opts({ rpc: rpc({ getChainId: async () => 143 }) }),
  );
  assert.equal(wrongChain.evidence.status, "unavailable");
  const base = rpc();
  const wrongRegistry = await readErc8004(
    PAYEE,
    opts({
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "getIdentityRegistry"
            ? Promise.resolve(OWNER)
            : base.readContract(r),
      }),
    }),
  );
  assert.equal(wrongRegistry.evidence.status, "unavailable");
});

test("registration only, untrusted spam, and prior Ligis gate scores cannot establish trust", async () => {
  const base = rpc();
  for (const extra of [
    { reputationPolicy: { ...policy, trustedClients: [] } },
    {
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "getClients"
            ? Promise.resolve([])
            : base.readContract(r),
      }),
    },
    {
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "readFeedback"
            ? Promise.resolve([100n, 0, "ligis.gate", "GO", false])
            : base.readContract(r),
      }),
    },
  ]) {
    assert.equal(
      (await readErc8004(PAYEE, opts(extra))).evidence.status,
      "unknown",
    );
  }
});

test("subject, owner, controller, authorized operator, and scoring writer are excluded", async () => {
  const base = rpc();
  for (const extra of [
    { reputationPolicy: { ...policy, knownControllers: [CLIENT1] } },
    { reputationPolicy: { ...policy, scoringWriters: [CLIENT1] } },
    {
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "ownerOf"
            ? Promise.resolve(CLIENT1)
            : base.readContract(r),
      }),
    },
    {
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "isAuthorizedOrOwner"
            ? Promise.resolve(r.args?.[0] === CLIENT1)
            : base.readContract(r),
      }),
    },
    {
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "getClients"
            ? Promise.resolve([PAYEE, CLIENT2])
            : base.readContract(r),
      }),
      reputationPolicy: { ...policy, trustedClients: [PAYEE, CLIENT2] },
    },
  ]) {
    const read = await readErc8004(PAYEE, opts(extra));
    assert.equal(read.evidence.status, "unknown");
  }
});

test("revoked reputation does not count; low trusted delivery score wins over positives", async () => {
  const base = rpc();
  const revoked = await readErc8004(
    PAYEE,
    opts({
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "readFeedback" && r.args?.[1] === CLIENT1
            ? Promise.resolve([100n, 0, "delivery", "quality", true])
            : base.readContract(r),
      }),
    }),
  );
  assert.equal(revoked.evidence.status, "unknown");
  const negative = await readErc8004(
    PAYEE,
    opts({
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "readFeedback" && r.args?.[1] === CLIENT1
            ? Promise.resolve([100n, 2, "delivery", "quality", false])
            : base.readContract(r),
      }),
    }),
  );
  assert.equal(
    negative.evidence.status,
    "negative",
    "1.00 is not 100 and cannot be masked by a 90 score",
  );
});

test("bounded feedback/client/RPC coverage cannot establish positive trust", async () => {
  const base = rpc();
  for (const extra of [
    { maxClients: 1 },
    {
      maxFeedbackPerClient: 1,
      rpc: rpc({
        readContract: (r) =>
          r.functionName === "getLastIndex"
            ? Promise.resolve(2n)
            : base.readContract(r),
      }),
    },
    {
      rpc: rpc({
        getBlockNumber: async () => 10000n,
        readContract: (r) => base.readContract({ ...r, blockNumber: 5n }),
      }),
    },
  ]) {
    const read = await readErc8004(PAYEE, opts(extra));
    assert.notEqual(read.evidence.status, "positive");
    assert(read.evidence.limitations.some((l) => /coverage|bounded/.test(l)));
  }
});

test("a source outage cannot erase already observed trusted negative evidence", async () => {
  const base = rpc();
  const read = await readErc8004(
    PAYEE,
    opts({
      rpc: rpc({
        readContract: (r) => {
          if (r.functionName === "readFeedback") {
            if (r.args?.[1] === CLIENT1)
              return Promise.resolve([-1n, 0, "delivery", "quality", false]);
            return Promise.reject(new Error("outage"));
          }
          return base.readContract(r);
        },
      }),
    }),
  );
  assert.equal(read.evidence.status, "negative");
  assert(read.evidence.limitations.some((l) => /unavailable/.test(l)));
});

test("bounded source orchestration exposes D seam and default unavailable settlement", async () => {
  const read = await readPayeeEvidence(PAYEE, {
    erc8004: opts(),
    readNansenEvidence: async () => ({
      source: "nansen",
      status: "unknown",
      reason: "injected Nansen gap",
      observedAt: "2026-10-13T00:00:00Z",
      limitations: ["test"],
    }),
  });
  assert.equal(read.length, 3);
  assert.equal(read[0].status, "positive");
  assert.equal(read[1].status, "unavailable");
  assert.equal(read[2].source, "nansen");
});
