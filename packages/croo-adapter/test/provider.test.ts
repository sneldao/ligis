import assert from "node:assert";
import { describe, it, before } from "node:test";
import { EventType } from "@croo-network/sdk";
import { LigisCrooProvider } from "../src/provider.js";
import { MockCrooClient } from "./mock-client.js";

// Set a dummy Casper config so provider tests don't hit env-loader errors.
before(() => {
  process.env.CROO_API_URL = "https://api.croo.network";
  process.env.CROO_WS_URL = "wss://api.croo.network/ws";
  process.env.CROO_SDK_KEY = "croo_sk_test";
  process.env.LIGIS_CHAIN = "casper";
  process.env.LIGIS_CASPER_RPC_URL = "https://rpc.testnet.casperlabs.io/rpc";
  process.env.LIGIS_CASPER_NETWORK = "casper-testnet";
  process.env.LIGIS_CASPER_AGENT_ID = "contract-package-test";
  process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY = "contract-package-test";
});

describe("LigisCrooProvider", () => {
  it("starts and connects websocket", async () => {
    const mock = new MockCrooClient();
    const provider = new LigisCrooProvider({ client: mock });
    const stream = await provider.start();
    assert.strictEqual(mock.calls[0]?.method, "connectWebSocket");
    assert.ok(stream);
  });

  it("rejects unsupported service", async () => {
    const mock = new MockCrooClient();
    const provider = new LigisCrooProvider({ client: mock });
    await provider.start();

    mock.emitEvent(EventType.NegotiationCreated, {
      negotiation_id: "neg-1",
      service_id: "unknown.service",
      requirements: "{}",
    });

    await new Promise((r) => setTimeout(r, 50));

    const rejectCall = mock.calls.find((c) => c.method === "rejectNegotiation");
    assert.ok(rejectCall, "expected rejectNegotiation call");
    assert.ok(String(rejectCall.args[1]).includes("unknown.service"));
  });

  it("accepts ligis.verify negotiation", async () => {
    const mock = new MockCrooClient();
    const provider = new LigisCrooProvider({ client: mock });
    await provider.start();

    mock.emitEvent(EventType.NegotiationCreated, {
      negotiation_id: "neg-2",
      service_id: "ligis.verify",
      requirements: JSON.stringify({ subject: "0xabc", capability: "agent.commerce.escrow" }),
    });

    await new Promise((r) => setTimeout(r, 50));

    const acceptCall = mock.calls.find((c) => c.method === "acceptNegotiation");
    assert.ok(acceptCall, "expected acceptNegotiation call");
    assert.strictEqual(acceptCall.args[0], "neg-2");
  });

  it("delivers error payload when order paid but handler fails", async () => {
    const mock = new MockCrooClient();
    const provider = new LigisCrooProvider({ client: mock });
    await provider.start();

    mock.emitEvent(EventType.OrderPaid, {
      order_id: "order-3",
      service_id: "ligis.verify",
      requirements: JSON.stringify({ bad: "input" }),
    });

    await new Promise((r) => setTimeout(r, 100));

    const deliverCall = mock.calls.find((c) => c.method === "deliverOrder");
    assert.ok(deliverCall, "expected deliverOrder call");
    const payload = JSON.parse(String((deliverCall.args[1] as Record<string, string>).deliverableText));
    assert.strictEqual(payload.error, true);
  });
});
