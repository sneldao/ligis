import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MonidClient,
  MonidRiskProvider,
  type MonidDiscoverResult,
  type MonidEndpointDetail,
  type MonidRun,
} from "../src/monid.js";
import type { RiskProviderInput } from "@ligis/core";

const COUNTERPARTY = "0x3f9c12ab34cd56ef7890abcd1234ef567890abcd";

const INPUT: RiskProviderInput = {
  counterparty: COUNTERPARTY,
  intent: "pay for premium RWA data",
  amount: "10 USD",
  capability: "data.premium",
};

function endpoint(): MonidDiscoverResult["results"][number] {
  return {
    provider: "riskco",
    providerName: "Risk Co",
    endpoint: "wallet-risk",
    description: "Wallet risk history",
    price: { type: "PER_CALL", amount: 0.0025, currency: "USD" },
  };
}

function detail(
  overrides: Partial<MonidEndpointDetail> = {},
): MonidEndpointDetail {
  return {
    id: "1",
    provider: "riskco",
    endpoint: "wallet-risk",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string" } },
    },
    ...overrides,
  };
}

class MockMonidClient extends MonidClient {
  discoverResult: MonidDiscoverResult = {
    query: "counterparty risk",
    count: 1,
    results: [endpoint()],
  };
  inspectResult: MonidEndpointDetail = detail();
  runResult: MonidRun = {
    id: "run-1",
    status: "completed",
    result: { riskScore: 12, riskLevel: "low" },
    cost: { amount: 0.0025, currency: "USD" },
  };
  discoverError: Error | null = null;
  lastInput: unknown = null;

  constructor() {
    super({ apiKey: "test-key" });
  }

  override async discover(): Promise<MonidDiscoverResult> {
    if (this.discoverError) throw this.discoverError;
    return this.discoverResult;
  }

  override async inspect(): Promise<MonidEndpointDetail> {
    return this.inspectResult;
  }

  override async runAndWait(
    _provider: string,
    _endpoint: string,
    input: unknown,
  ): Promise<MonidRun> {
    this.lastInput = input;
    return this.runResult;
  }
}

describe("MonidRiskProvider", () => {
  it("returns a go signal with cost for a completed low-score run", async () => {
    const client = new MockMonidClient();
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.kind, "risk");
    assert.equal(signal.source, "monid");
    assert.equal(signal.verdict, "go");
    assert.equal(signal.confidence, 90);
    assert.deepEqual(signal.cost, { amount: 0.0025, currency: "USD" });
    assert.equal(signal.metadata?.runId, "run-1");
    assert.equal(signal.metadata?.score, 12);
    assert.equal(signal.metadata?.level, "low");
    assert.equal(signal.metadata?.provider, "riskco");
    assert.equal(signal.metadata?.endpoint, "wallet-risk");
  });

  it("sends the counterparty in the inferred input field", async () => {
    const client = new MockMonidClient();
    const provider = new MonidRiskProvider(client);

    await provider.resolve(INPUT);

    assert.deepEqual(client.lastInput, { address: COUNTERPARTY });
  });

  it("adds a chain field when the endpoint schema asks for one", async () => {
    const client = new MockMonidClient();
    client.inspectResult = detail({
      inputSchema: {
        type: "object",
        properties: { address: { type: "string" }, chain: { type: "string" } },
      },
    });
    const provider = new MonidRiskProvider(client);

    await provider.resolve(INPUT);

    assert.deepEqual(client.lastInput, {
      address: COUNTERPARTY,
      chain: "ethereum",
    });
  });

  it("stops when the score meets the threshold", async () => {
    const client = new MockMonidClient();
    client.runResult = {
      ...client.runResult,
      result: { riskScore: 75, riskLevel: "medium" },
    };
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "stop");
  });

  it("stops on risky levels even with a low score", async () => {
    const client = new MockMonidClient();
    client.runResult = {
      ...client.runResult,
      result: { riskScore: 10, riskLevel: "severe" },
    };
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "stop");
    assert.equal(signal.confidence, 90);
  });

  it("honors a custom threshold", async () => {
    const client = new MockMonidClient();
    client.runResult = {
      ...client.runResult,
      result: { riskScore: 25, riskLevel: "medium" },
    };
    const strict = new MonidRiskProvider(client, { threshold: 20 });
    const loose = new MonidRiskProvider(client, { threshold: 30 });

    assert.equal((await strict.resolve(INPUT)).verdict, "stop");
    assert.equal((await loose.resolve(INPUT)).verdict, "go");
  });

  it("is unknown when a completed run carries no readable score", async () => {
    const client = new MockMonidClient();
    client.runResult = {
      ...client.runResult,
      result: { notes: "nothing readable" },
    };
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "unknown");
    assert.equal(signal.confidence, 30);
    assert.deepEqual(signal.cost, { amount: 0.0025, currency: "USD" });
  });

  it("stops with the error when the run fails", async () => {
    const client = new MockMonidClient();
    client.runResult = {
      id: "run-2",
      status: "failed",
      error: "upstream timeout",
    };
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "stop");
    assert.equal(signal.confidence, 0);
    assert.equal(signal.metadata?.error, "upstream timeout");
  });

  it("stops when discovery throws", async () => {
    const client = new MockMonidClient();
    client.discoverError = new Error("Monid 500");
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "stop");
    assert.equal(signal.confidence, 0);
    assert.equal(signal.metadata?.error, "Monid 500");
  });

  it("stops when no endpoints are discovered", async () => {
    const client = new MockMonidClient();
    client.discoverResult = { query: "counterparty risk", count: 0, results: [] };
    const provider = new MonidRiskProvider(client);

    const signal = await provider.resolve(INPUT);

    assert.equal(signal.verdict, "stop");
    assert.match(String(signal.metadata?.error), /No Monid endpoints discovered/);
  });
});
