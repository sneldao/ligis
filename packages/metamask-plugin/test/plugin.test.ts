/**
 * Unit tests for the plugin package — no wallet, no funds, no live gate.
 *
 * The executor boundary is faked: `executorSigner` is exercised against a mock
 * `WalletExecutor`, and `createPaymentGuard` runs end-to-end with a fake
 * transport answering the gate POST. This mirrors how the command wires the
 * real `ctx.walletExecutor` in production.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPaymentGuard } from "@ligis/wallet-plugin";
import { buildAuthorizationRequest } from "../src/shared/operation.js";
import { executorSigner } from "../src/shared/executor-signer.js";
import type { WalletExecutor } from "../src/shared/executor-signer.js";
import type { Transport } from "@ligis/wallet-plugin";

const NOW = 1_700_000_000_000;
const PAYEE = "0x0000000000000000000000000000000000000aa1";
const FROM = "0x0000000000000000000000000000000000000bb2";
const ASSET = "0x0000000000000000000000000000000000000cc3";

const POLICY = {
  gateEndpoint: "https://gate.test",
  assets: [
    { address: ASSET, chainId: 10143, decimals: 6, usdPeg: 1, symbol: "USDC" },
  ],
  chains: [10143],
  payees: [],
  maxUsd: 100,
  maxValiditySeconds: 600,
  requiredCapability: null,
  gateTimeoutMs: 5000,
  minGoConfidence: 0.5,
};

function request() {
  return buildAuthorizationRequest({
    from: FROM,
    payee: PAYEE,
    value: "5000000",
    asset: ASSET,
    chainId: 10143,
    domainName: "USD Coin",
    domainVersion: "2",
    validForSeconds: 300,
    nonce: `0x${"ab".repeat(32)}`,
    now: NOW,
  });
}

function gateTransport(verdict: string, confidence = 0.9): Transport {
  return async () => ({
    status: 200,
    json: async () => ({
      verdict,
      signals: [{ id: "policy", status: verdict, confidence }],
      latencyMs: 12,
      provenance: ["test"],
    }),
  });
}

describe("buildAuthorizationRequest", () => {
  it("maps the validity window to the unix-second fields the guard binds", () => {
    const req = request();
    assert.equal(req.authorization.validAfter, String(Math.floor(NOW / 1000)));
    assert.equal(
      req.authorization.validBefore,
      String(Math.floor(NOW / 1000) + 300),
    );
    assert.equal(req.authorization.to, PAYEE);
    assert.equal(req.domain.chainId, 10143);
    assert.equal(req.primaryType, "TransferWithAuthorization");
  });
});

describe("executorSigner", () => {
  it("forwards the exact typed-data envelope to the host executor", async () => {
    let seen: unknown;
    const executor: WalletExecutor = async (req) => {
      seen = req;
      return { signature: "0xdeadbeef" };
    };
    const signer = executorSigner(executor, { intentSummary: "test" });
    const req = request();
    const sig = await signer({
      commandId: "ligis:pay",
      primaryType: "TransferWithAuthorization",
      domain: req.domain,
      types: { TransferWithAuthorization: [] },
      message: req.authorization,
    });
    assert.equal(sig, "0xdeadbeef");
    const call = seen as {
      kind: string;
      chainId: number;
      typedData: { primaryType: string };
      intent: { action: string };
    };
    assert.equal(call.kind, "typed-data");
    assert.equal(call.chainId, 10143);
    assert.equal(call.typedData.primaryType, "TransferWithAuthorization");
    assert.equal(call.intent.action, "ligis.pay");
  });

  it("throws when the executor returns no signature", async () => {
    const executor: WalletExecutor = async () => ({
      status: "DENIED",
      failureDescription: "user rejected",
    });
    const signer = executorSigner(executor);
    const req = request();
    await assert.rejects(
      () =>
        signer({
          commandId: "ligis:pay",
          primaryType: "TransferWithAuthorization",
          domain: req.domain,
          types: {},
          message: req.authorization,
        }),
      /did not return a signature.*user rejected/,
    );
  });
});

describe("guarded path end-to-end", () => {
  function guard(verdict: string, executor?: WalletExecutor) {
    const signer = executorSigner(
      executor ?? (async () => ({ signature: "0xsigned" })),
    );
    return createPaymentGuard({
      policy: POLICY,
      commandId: "ligis:pay",
      transport: gateTransport(verdict),
      signer,
      now: () => NOW,
    });
  }

  it("signs through the executor only on GO", async () => {
    let calls = 0;
    const executor: WalletExecutor = async () => {
      calls++;
      return { signature: "0xsigned" };
    };
    const outcome = await guard("GO", executor).enforce(request());
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.signature, "0xsigned");
    assert.equal(calls, 1);
  });

  it("refuses STOP without touching the executor", async () => {
    let calls = 0;
    const outcome = await guard("STOP", async () => {
      calls++;
      return { signature: "0x" };
    }).enforce(request());
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "decision-not-go");
    assert.equal(calls, 0);
  });

  it("refuses UNKNOWN without touching the executor", async () => {
    const outcome = await guard("UNKNOWN").enforce(request());
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "decision-not-go");
  });

  it("refuses a malformed decision", async () => {
    const transport: Transport = async () => ({
      status: 200,
      json: async () => ({ not: "a decision" }),
    });
    const g = createPaymentGuard({
      policy: POLICY,
      transport,
      signer: executorSigner(async () => ({ signature: "0x" })),
      now: () => NOW,
    });
    const outcome = await g.enforce(request());
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "decision-malformed");
  });

  it("refuses low-confidence GO", async () => {
    const outcome = await guard("GO").enforce(request(), {
      mandate: { maxUsd: 5 },
    });
    // confidence 0.9 >= 0.5 threshold → should sign
    assert.equal(outcome.ok, true);
  });

  it("refuses when the gate GO is below the confidence floor", async () => {
    const g = createPaymentGuard({
      policy: { ...POLICY, minGoConfidence: 0.95 },
      transport: gateTransport("GO", 0.9),
      signer: executorSigner(async () => ({ signature: "0x" })),
      now: () => NOW,
    });
    const outcome = await g.enforce(request());
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "decision-not-go");
  });
});
