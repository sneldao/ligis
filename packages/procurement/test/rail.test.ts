import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AirwallexSandboxRail,
  mapTransferStatus,
  RailError,
} from "../src/rail.js";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function stubFetch() {
  const calls: RecordedCall[] = [];
  const f = async (
    url: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const u = String(url);
    calls.push({
      url: u,
      method: init.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([k, v]) => [k, String(v)]),
      ),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (u.endsWith("/authentication/login")) {
      return Response.json({
        token: "tok-123",
        expires_at: "2026-01-01T01:00:00Z",
      });
    }
    if (u.endsWith("/transfers/create")) {
      return Response.json({ id: "tr_1", status: "RECEIVED" });
    }
    if (u.includes("/transfers?request_id=")) {
      return Response.json({
        items: [{ id: "tr_9", status: "SENT", request_id: "req-1" }],
      });
    }
    if (u.endsWith("/transfers/tr_1")) {
      return Response.json({ id: "tr_1", status: "PAID" });
    }
    if (u.endsWith("/balances")) {
      return Response.json({
        items: [{ currency: "USD", available_amount: 1234.56 }],
      });
    }
    if (u.includes("/simulation/transfers/")) {
      return Response.json({ id: "tr_1", status: "SENT" });
    }
    throw new Error(`unstubbed: ${u}`);
  };
  return { calls, f: f as typeof fetch };
}

describe("AirwallexSandboxRail with stubbed fetch", () => {
  it("logs in with client headers and reuses the bearer token", async () => {
    const { calls, f } = stubFetch();
    const rail = new AirwallexSandboxRail({
      clientId: "cid",
      apiKey: "key",
      baseUrl: "https://api.sandbox.airwallex.com/api/v1",
      fetch: f,
    });
    await rail.createTransfer({
      requestId: "8f3a9e2c-1111-4222-8333-444455556666",
      beneficiaryId: "ben-1",
      amount: { amount: 500, currency: "USD" },
      reference: "INV-1",
      reason: "PO-1",
    });
    await rail.getTransfer("tr_1");

    const login = calls[0];
    assert.equal(login.method, "POST");
    assert.equal(login.headers["x-client-id"], "cid");
    assert.equal(login.headers["x-api-key"], "key");
    assert.equal(login.body, undefined);

    // Bearer reused — only one login call across two API calls.
    assert.equal(
      calls.filter((c) => c.url.endsWith("/authentication/login")).length,
      1,
    );
    assert.equal(calls[1].headers["Authorization"], "Bearer tok-123");
    assert.equal(calls[2].headers["Authorization"], "Bearer tok-123");

    const create = calls[1].body as Record<string, unknown>;
    assert.equal(create.transfer_currency, "USD");
    assert.equal(create.transfer_amount, "500");
    assert.equal(create.request_id, "8f3a9e2c-1111-4222-8333-444455556666");
    assert.equal(String(create.request_id).length, 36);
    assert.equal(create.beneficiary_id, "ben-1");
    assert.equal(create.transfer_method, "LOCAL");
    assert.equal(create.payment_currency, undefined);
  });

  it("findByRequestId queries GET /transfers?request_id=", async () => {
    const { calls, f } = stubFetch();
    const rail = new AirwallexSandboxRail({
      clientId: "cid",
      apiKey: "key",
      fetch: f,
    });
    const found = await rail.findByRequestId("req-1");
    assert.equal(found!.transferId, "tr_9");
    assert.equal(found!.status, "SENT");
    assert.match(calls.at(-1)!.url, /request_id=req-1/);
  });

  it("simulation transition posts next_status", async () => {
    const { calls, f } = stubFetch();
    const rail = new AirwallexSandboxRail({
      clientId: "c",
      apiKey: "k",
      fetch: f,
    });
    await rail.transition("tr_1", "FAILED", "INSUFFICIENT_FUNDS");
    const body = calls.at(-1)!.body as Record<string, unknown>;
    assert.equal(body.next_status, "FAILED");
    assert.equal(body.failure_type, "INSUFFICIENT_FUNDS");
  });

  it("getBalance reads available_amount", async () => {
    const { f } = stubFetch();
    const rail = new AirwallexSandboxRail({
      clientId: "c",
      apiKey: "k",
      fetch: f,
    });
    assert.equal(await rail.getBalance("USD"), 1234.56);
    assert.equal(await rail.getBalance("EUR"), 0);
  });
});

describe("status mapping", () => {
  it("maps Airwallex statuses to attempt states", () => {
    assert.equal(mapTransferStatus("PAID"), "PAID");
    assert.equal(mapTransferStatus("CANCELLED"), "CANCELLED");
    for (const s of ["RECEIVED", "SENT", "SCHEDULED", "PROCESSING", "FAILED"]) {
      // FAILED is also terminal in our mapping.
      const expected = s === "FAILED" ? "CANCELLED" : "IN_FLIGHT";
      assert.equal(mapTransferStatus(s), expected, s);
    }
  });
});

describe("FixtureRail semantics", () => {
  it("rejects request_id reuse for a different operation", async () => {
    const { FixtureRail, RailError: RE } = await import("../src/rail.js");
    const rail = new FixtureRail({ USD: 100 });
    const input = {
      requestId: "r1",
      beneficiaryId: "b1",
      amount: { amount: 10, currency: "USD" },
      reference: "x",
      reason: "y",
    };
    await rail.createTransfer(input);
    // Same op — idempotent.
    await rail.createTransfer(input);
    // Different op — duplicate_request_id.
    await assert.rejects(
      () => rail.createTransfer({ ...input, beneficiaryId: "b2" }),
      (e) =>
        e instanceof RE && (e as RailError).code === "duplicate_request_id",
    );
  });
});
