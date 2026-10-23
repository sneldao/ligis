import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readNansenEvidence,
  type NansenOptions,
} from "../lib/payee-evidence/nansen";
import { nansenConfigFromEnv, readPayeeEvidence } from "../lib/payee-evidence";

const payee = `0x${"1".repeat(40)}`;
const options: NansenOptions = {
  enabled: true,
  apiKey: "fixture-key-not-live",
  chainId: 143,
  confirmedMonadChainId: 143,
  now: () => new Date("2026-10-13T00:00:00Z"),
};
const transport =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    Response.json(body, { status });

test("Nansen default off, missing key, invalid and unconfirmed/wrong chain never call provider", async () => {
  const base = {
    ...options,
    transport: async () => {
      throw Error("must not call");
    },
  };
  for (const [override, reason] of [
    [{ enabled: false }, "nansen-disabled"],
    [{ apiKey: "" }, "nansen-missing-key"],
    [{ confirmedMonadChainId: undefined }, "nansen-chain-unconfirmed"],
    [{ chainId: 10143 }, "nansen-wrong-chain"],
    [{ chainId: 1, confirmedMonadChainId: 1 }, "nansen-wrong-chain"],
  ] as const) {
    assert.equal(
      (await readNansenEvidence(payee, { ...base, ...override })).reason,
      reason,
    );
  }
  assert.equal(
    (await readNansenEvidence("vendor", base)).reason,
    "nansen-invalid-payee",
  );
});

test("Nansen failures are named, bounded and do not echo errors or keys", async () => {
  for (const [status, reason] of [
    [429, "nansen-rate-limit"],
    [401, "nansen-access-denied"],
    [403, "nansen-access-denied"],
    [404, "nansen-no-coverage"],
    [500, "nansen-provider-error"],
  ] as const) {
    const result = await readNansenEvidence(payee, {
      ...options,
      transport: transport({ error: options.apiKey }, status),
    });
    assert.equal(result.reason, reason);
    assert.ok(!JSON.stringify(result).includes(options.apiKey!));
  }
  for (const body of [
    null,
    {},
    { data: [{}] },
    { data: [{ label: "x", category: "x", kind: "x" }] },
  ])
    assert.equal(
      (
        await readNansenEvidence(payee, {
          ...options,
          transport: transport(body),
        })
      ).reason,
      "nansen-malformed-data",
    );
  assert.equal(
    (
      await readNansenEvidence(payee, {
        ...options,
        transport: transport({ data: [] }),
      })
    ).reason,
    "nansen-no-coverage",
  );
  assert.equal(
    (
      await readNansenEvidence(payee, {
        ...options,
        timeoutMs: 5,
        transport: async () => new Promise(() => {}),
      })
    ).reason,
    "nansen-timeout",
  );
  assert.equal(
    (
      await readNansenEvidence(payee, {
        ...options,
        transport: async () => {
          throw Error("secret input");
        },
      })
    ).reason,
    "nansen-provider-error",
  );
});

test("Taxonomy is preserved but exchange, smart money and alleged risk names never grant trust", async () => {
  const data = ["Exchange", "Smart Money", "Scammer"].map((label) => ({
    label,
    category: "behavioral",
    kind: ["entity"],
  }));
  const result = await readNansenEvidence(payee, {
    ...options,
    transport: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.nansen.ai/api/v1/profiler/address/labels",
      );
      assert.deepEqual(JSON.parse(init!.body as string), {
        address: payee,
        chain: "monad",
        pagination: { page: 1, per_page: 100 },
      });
      return Response.json({ data });
    },
  });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.taxonomy, data);
  assert.equal(result.observedAt, "2026-10-13T00:00:00.000Z");
});

const liveEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LIGIS_NANSEN_ENABLED: "1",
  NANSEN_API_KEY: "fixture-key-not-live",
  LIGIS_NANSEN_MONAD_CHAIN_ID: "10143",
  LIGIS_PAYEE_EVIDENCE_CHAIN_ID: "10143",
};

test("env wiring defaults off and only a positive chain id counts as confirmed", () => {
  const off = nansenConfigFromEnv({ NODE_ENV: "test" });
  assert.equal(off.enabled, false);
  assert.equal(off.apiKey, "");
  assert.equal(off.confirmedMonadChainId, undefined);

  const on = nansenConfigFromEnv(liveEnv);
  assert.equal(on.enabled, true);
  assert.equal(on.confirmedMonadChainId, 10143);
  assert.equal(on.chainId, 10143);

  for (const value of ["0", "-1", "abc", ""]) {
    assert.equal(
      nansenConfigFromEnv({
        ...liveEnv,
        LIGIS_NANSEN_MONAD_CHAIN_ID: value,
      }).confirmedMonadChainId,
      undefined,
    );
  }
});

test("an intended network is never inferred from the confirmed mapping", () => {
  const noContext = nansenConfigFromEnv({
    ...liveEnv,
    LIGIS_PAYEE_EVIDENCE_CHAIN_ID: undefined,
  });
  assert.equal(noContext.chainId, undefined);
  assert.equal(noContext.confirmedMonadChainId, 10143);
  // A caller-declared context wins over the operator default.
  assert.equal(nansenConfigFromEnv(liveEnv, {}, 143).chainId, 143);
});

test("the live gate wiring calls the provider once and still grants no trust", async () => {
  let calls = 0;
  const read = await readPayeeEvidence(payee, {
    env: liveEnv,
    // Off-scope chain id keeps the ERC-8004 leg inert: this test proves the
    // Nansen leg, not a live indexer read.
    erc8004: { chainId: 1 },
    nansen: {
      transport: async () => {
        calls += 1;
        return Response.json({
          data: [{ label: "Smart Money", category: "entity", kind: ["fund"] }],
        });
      },
      now: () => new Date("2026-10-14T00:00:00Z"),
    },
  });
  const nansen = read.find((e) => e.source === "nansen");
  assert.equal(calls, 1);
  assert.equal(nansen?.status, "unknown");
  assert.equal(nansen?.reason, "nansen-labels-not-risk-verdict");
  assert.equal(nansen?.chainId, 10143);
});

test("an unconfirmed chain mapping never reaches the provider", async () => {
  let calls = 0;
  const read = await readPayeeEvidence(payee, {
    env: {
      NODE_ENV: "test",
      LIGIS_NANSEN_ENABLED: "1",
      NANSEN_API_KEY: "fixture-key-not-live",
    },
    erc8004: { chainId: 1 },
    nansen: {
      transport: async () => {
        calls += 1;
        return Response.json({ data: [] });
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(
    read.find((e) => e.source === "nansen")?.reason,
    "nansen-chain-unconfirmed",
  );
});

test("mainnet labels are never served as evidence about a testnet payee", async () => {
  let calls = 0;
  const read = await readPayeeEvidence(payee, {
    env: { ...liveEnv, LIGIS_NANSEN_MONAD_CHAIN_ID: "143" },
    erc8004: { chainId: 1 },
    nansen: {
      transport: async () => {
        calls += 1;
        return Response.json({ data: [] });
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(
    read.find((e) => e.source === "nansen")?.reason,
    "nansen-wrong-chain",
  );
});
