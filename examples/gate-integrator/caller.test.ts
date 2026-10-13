import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareGatedPayment, reportAuthenticatedOutcome } from "./caller";
import { fixture, payment } from "./fixtures";

test("Valid GO executes exactly once under concurrent and repeated calls; policy is operator-owned", async () => {
  let count = 0;
  const policy = { payees: [payment.payee], maxUsd: 2 };
  const caller = prepareGatedPayment(
    payment,
    policy,
    async (exact) => {
      count++;
      assert.deepEqual(exact, payment);
      return `0x${"1".repeat(64)}`;
    },
    {
      gateUrl: "https://fixture.invalid/api/gate",
      transport: async (_, init) => {
        const input = JSON.parse(init!.body as string);
        assert.equal(input.mandate.maxUsd, 2);
        assert.equal(input.chainId, undefined); // No independent wire extension.
        return Response.json(fixture("GO"));
      },
    },
  );
  policy.maxUsd = 999;
  const results = await Promise.all([caller.run(), caller.run(), caller.run()]);
  assert.ok(results.every((r) => r.paid));
  assert.equal(count, 1);
});

test("STOP, UNKNOWN, malformed/inconsistent JSON, timeout and HTTP error never pay", async () => {
  const transports: (typeof fetch)[] = [
    async () => Response.json(fixture("STOP")),
    async () => Response.json(fixture("UNKNOWN")),
    async () => Response.json({ verdict: "GO" }),
    async () => Response.json({ ...fixture("STOP"), verdict: "GO" }),
    async () => new Response("{"),
    async () => Response.json(fixture("GO"), { status: 500 }),
    async () => {
      throw Error("network");
    },
    async () => new Promise<Response>(() => {}),
  ];
  for (const transport of transports) {
    let count = 0;
    const caller = prepareGatedPayment(
      payment,
      {},
      async () => {
        count++;
        return "fixture";
      },
      { gateUrl: "https://fixture.invalid/api/gate", timeoutMs: 5, transport },
    );
    assert.equal((await caller.run()).paid, false);
    assert.equal(count, 0);
  }
});

test("Telemetry failure does not retry payment or pretend storage succeeded", async () => {
  let count = 0;
  const caller = prepareGatedPayment(
    payment,
    {},
    async () => {
      count++;
      return "fixture";
    },
    {
      gateUrl: "https://fixture.invalid/api/gate",
      gateToken: "fixture-" + "k".repeat(32),
      transport: async () =>
        Response.json(fixture("GO"), {
          headers: {
            "X-Ligis-Decision-Id": "00000000-0000-4000-8000-000000000000",
          },
        }),
      reportOutcome: async () => {
        throw Error("storage");
      },
    },
  );
  assert.equal((await caller.run()).telemetry, "unavailable");
  await caller.run();
  assert.equal(count, 1);
});

test("Default live mode is off and absent correlation never invents a stored record", async () => {
  assert.throws(
    () =>
      prepareGatedPayment(payment, {}, async () => "fixture", {
        gateUrl: "https://fixture.invalid/api/gate",
      }),
    /live-authorization-required/,
  );
  let reports = 0;
  const caller = prepareGatedPayment(payment, {}, async () => "fixture", {
    gateUrl: "https://fixture.invalid/api/gate",
    transport: async () => Response.json(fixture("GO")),
    reportOutcome: async () => {
      reports++;
    },
  });
  assert.equal((await caller.run()).telemetry, "not-correlated");
  assert.equal(reports, 0);
});

test("Authenticated reporting requires a positive storage acknowledgement", async () => {
  await assert.rejects(
    reportAuthenticatedOutcome({
      url: "https://fixture.invalid/api/gate/outcomes",
      token: "fixture-only",
      decisionId: "fixture",
      reportId: "fixture",
      txHash: "fixture",
      logIndex: 0,
      transport: async () => Response.json({ stored: false }),
    }),
    /outcome-not-stored/,
  );
});
