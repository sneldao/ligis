import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readNansenEvidence,
  type NansenOptions,
} from "../lib/payee-evidence/nansen";

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
