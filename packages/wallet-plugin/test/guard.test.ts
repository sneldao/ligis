import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPaymentGuard,
  parseOperatorPolicy,
  type AuthorizationRequest,
  type GateDecision,
  type Transport,
} from "../src/index.js";

const NOW = 1_760_000_000_000;
const PAYEE = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const USDC = "0x3333333333333333333333333333333333333333";
const CHAIN = 10143;

const NONCE = `0x${"ab".repeat(32)}`;

const policy = {
  gateEndpoint: "https://gate.example",
  assets: [
    { address: USDC, chainId: CHAIN, decimals: 6, usdPeg: 1, symbol: "USDC" },
  ],
  chains: [CHAIN],
  payees: [PAYEE],
  maxUsd: 25,
  maxValiditySeconds: 300,
  requiredCapability: null,
  gateTimeoutMs: 1000,
  minGoConfidence: 0.6,
};

function operation(
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  const base: AuthorizationRequest = {
    authorization: {
      from: PAYER,
      to: PAYEE,
      value: "5000000",
      validAfter: String(NOW - 60_000),
      validBefore: String(NOW + 120_000),
      nonce: NONCE,
    },
    domain: {
      name: "USDCToken",
      version: "2",
      chainId: CHAIN,
      verifyingContract: USDC,
    },
  };
  return {
    ...base,
    ...overrides,
    authorization: {
      ...base.authorization,
      ...(overrides.authorization ?? {}),
    },
    domain: { ...base.domain, ...(overrides.domain ?? {}) },
  };
}

function decisionBody(verdict: GateDecision["verdict"], confidence = 0.9) {
  return {
    verdict,
    signals: [
      { id: "verified-payee", status: verdict, confidence, reason: "fixture" },
    ],
    latencyMs: 12,
    provenance: ["fixture"],
  };
}

type Harness = {
  guard: ReturnType<typeof createPaymentGuard>;
  calls: number;
  signCalls: number;
};

function harness(
  options: {
    respond?: (url: string) => { status: number; json: () => Promise<unknown> };
    throwError?: boolean;
    hang?: boolean;
    signerThrows?: boolean;
    policyOverride?: unknown;
    agentPolicy?: boolean;
  } = {},
): Harness {
  const state = { calls: 0, signCalls: 0 };
  const transport: Transport = async (url, init) => {
    state.calls += 1;
    if (options.hang) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      init.signal.throwIfAborted();
    }
    if (options.throwError) throw new Error("ECONNREFUSED");
    if (options.respond) return options.respond(url);
    return { status: 200, json: async () => decisionBody("GO") };
  };
  const guard = createPaymentGuard({
    policy: options.policyOverride ?? policy,
    transport,
    now: () => NOW,
    signer: async () => {
      state.signCalls += 1;
      if (options.signerThrows) throw new Error("user rejected");
      return `0xsignature${state.signCalls}`;
    },
  });
  void options.agentPolicy;
  return {
    guard,
    get calls() {
      return state.calls;
    },
    get signCalls() {
      return state.signCalls;
    },
  };
}

describe("guarded payment: GO signs exactly once", () => {
  it("a permitted GO reaches the signer exactly once for one operation", async () => {
    const h = harness();
    const result = await h.guard.enforce(operation());
    assert.equal(result.ok, true);
    assert.ok(result.ok && !result.idempotentReplay);
    assert.equal(h.signCalls, 1);
    assert.equal(h.calls, 1);
  });

  it("a replayed identical operation is idempotent, not re-signed", async () => {
    const h = harness();
    await h.guard.enforce(operation());
    const replay = await h.guard.enforce(operation());
    assert.ok(replay.ok && replay.idempotentReplay);
    assert.equal(h.signCalls, 1);
    assert.equal(h.calls, 1);
  });
});

describe("guarded payment: every non-GO answer refuses", () => {
  it("HTTP 200 with STOP invokes no signature", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => decisionBody("STOP", 1),
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.code === "decision-not-go");
    assert.equal(h.signCalls, 0);
  });

  it("HTTP 200 with UNKNOWN invokes no signature", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => decisionBody("UNKNOWN", 0.2),
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-not-go");
    assert.equal(h.signCalls, 0);
  });

  it("an HTTP error status refuses even when the body is a schema-valid GO", async () => {
    const h = harness({
      respond: () => ({ status: 500, json: async () => decisionBody("GO") }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-unavailable");
    assert.equal(h.signCalls, 0);
  });

  it("a redirect status is not a decision", async () => {
    const h = harness({
      respond: () => ({ status: 302, json: async () => decisionBody("GO") }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-unavailable");
    assert.equal(h.signCalls, 0);
  });

  it("invalid JSON refuses", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => {
          throw new Error("Unexpected token");
        },
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-malformed");
    assert.equal(h.signCalls, 0);
  });

  it("an unknown future verdict string fails closed", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => ({ ...decisionBody("GO"), verdict: "MAYBE" }),
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-malformed");
    assert.equal(h.signCalls, 0);
  });

  it("a non-finite or out-of-range confidence fails closed", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => ({
          verdict: "GO",
          signals: [{ id: "verified-payee", status: "GO", confidence: 7 }],
          latencyMs: 1,
        }),
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-malformed");
    assert.equal(h.signCalls, 0);
  });

  it("a GO below the operator confidence floor refuses", async () => {
    const h = harness({
      respond: () => ({
        status: 200,
        json: async () => decisionBody("GO", 0.2),
      }),
    });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-not-go");
    assert.equal(h.signCalls, 0);
  });

  it("an unreachable gate refuses", async () => {
    const h = harness({ throwError: true });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-unavailable");
    assert.equal(h.signCalls, 0);
  });

  it("a gate that exceeds the timeout refuses rather than waiting", async () => {
    const h = harness({ hang: true });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "decision-timeout");
    assert.equal(h.signCalls, 0);
  });

  it("a signer failure is reported, not treated as a decision", async () => {
    const h = harness({ signerThrows: true });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "signer-failed");
    assert.equal(h.signCalls, 1);
  });
});

describe("guarded payment: policy is protected", () => {
  it("refuses to sign when the operator policy itself is unusable", async () => {
    const h = harness({ policyOverride: { ...policy, maxUsd: -1 } });
    const result = await h.guard.enforce(operation());
    assert.ok(!result.ok && result.code === "policy-missing");
    assert.equal(h.signCalls, 0);
    assert.equal(h.calls, 0);
  });

  it("rejects a non-https gate endpoint", () => {
    assert.throws(
      () =>
        parseOperatorPolicy({ ...policy, gateEndpoint: "http://gate.example" }),
      /https/,
    );
  });

  it("rejects a non-pegged asset instead of guessing a dollar value", () => {
    assert.throws(
      () =>
        parseOperatorPolicy({
          ...policy,
          assets: [
            {
              address: USDC,
              chainId: CHAIN,
              decimals: 18,
              usdPeg: 0.0003,
              symbol: "WETH",
            },
          ],
        }),
      /usdPeg/,
    );
  });

  it("an agent mandate cannot raise the cap", async () => {
    const h = harness();
    const result = await h.guard.enforce(operation(), {
      mandate: { maxUsd: 10_000 },
    });
    assert.ok(!result.ok && result.code === "agent-policy-loosening");
    assert.equal(h.signCalls, 0);
  });

  it("an agent mandate cannot widen the validity window", async () => {
    const h = harness();
    const result = await h.guard.enforce(operation(), {
      mandate: { maxValiditySeconds: 86_400 },
    });
    assert.ok(!result.ok && result.code === "agent-policy-loosening");
    assert.equal(h.signCalls, 0);
  });

  it("an agent mandate cannot drop an operator-required capability", async () => {
    const h = harness({
      policyOverride: { ...policy, requiredCapability: "kyc.basic" },
    });
    const result = await h.guard.enforce(operation(), {
      mandate: { requiredCapability: "data.premium" },
    });
    assert.ok(!result.ok && result.code === "agent-policy-loosening");
    assert.equal(h.signCalls, 0);
  });

  it("an agent mandate may tighten the cap", async () => {
    const h = harness();
    const result = await h.guard.enforce(operation(), {
      mandate: { maxUsd: 5 },
    });
    assert.equal(result.ok, true);
    assert.equal(h.signCalls, 1);
  });
});

describe("guarded payment: the decision is bound to the operation", () => {
  it("refuses a payee outside the operator allowlist without calling the gate", async () => {
    const h = harness();
    const result = await h.guard.enforce(
      operation({
        authorization: {
          to: "0x9999999999999999999999999999999999999999",
        } as never,
      }),
    );
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
    assert.equal(h.signCalls, 0);
  });

  it("refuses a chain the operator does not permit", async () => {
    const h = harness();
    const result = await h.guard.enforce(
      operation({ domain: { ...operation().domain, chainId: 1 } }),
    );
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
  });

  it("refuses a verifying contract that is not the approved asset", async () => {
    const h = harness();
    const result = await h.guard.enforce(
      operation({
        domain: {
          ...operation().domain,
          verifyingContract: "0x4444444444444444444444444444444444444444",
        },
      }),
    );
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
  });

  it("refuses a payment above the operator cap", async () => {
    const h = harness();
    const result = await h.guard.enforce(
      operation({ authorization: { value: "99900000" } as never }),
    );
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
  });

  it("refuses a validity window longer than the operator allows", async () => {
    const h = harness();
    const result = await h.guard.enforce(
      operation({
        authorization: { validBefore: String(NOW + 3_600_000) } as never,
      }),
    );
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
  });

  it("refuses an expired or not-yet-valid authorization", async () => {
    const h = harness();
    const expired = await h.guard.enforce(
      operation({
        authorization: {
          validAfter: String(NOW - 600_000),
          validBefore: String(NOW - 1),
        } as never,
      }),
    );
    assert.ok(!expired.ok && expired.code === "unsupported-operation");
    const future = await h.guard.enforce(
      operation({
        authorization: {
          validAfter: String(NOW + 1000),
          validBefore: String(NOW + 60_000),
        } as never,
      }),
    );
    assert.ok(!future.ok && future.code === "unsupported-operation");
    assert.equal(h.calls, 0);
  });

  it("refuses a batched or opaque primaryType rather than bypassing the guard", async () => {
    const h = harness();
    const result = await h.guard.enforce({
      ...operation(),
      primaryType: "Batch" as never,
    });
    assert.ok(!result.ok && result.code === "unsupported-operation");
    assert.equal(h.calls, 0);
    assert.equal(h.signCalls, 0);
  });

  it("a mutated amount after a GO requires a fresh decision", async () => {
    const h = harness();
    const first = await h.guard.enforce(operation());
    assert.equal(first.ok, true);
    // Base units must be a whole number of the dollar-pegged asset, so the
    // mutation is $6 rather than $5.000001.
    const mutated = await h.guard.enforce(
      operation({ authorization: { value: "6000000" } as never }),
    );
    assert.equal(mutated.ok, true);
    assert.ok(mutated.ok && !mutated.idempotentReplay);
    assert.equal(h.calls, 2);
    assert.equal(h.signCalls, 2);
    assert.notEqual(
      first.ok && first.operation.fingerprint,
      mutated.ok && mutated.operation.fingerprint,
    );
  });

  it("a mutated nonce, recipient, or domain each require a fresh decision", async () => {
    const variants: AuthorizationRequest[] = [
      operation({ authorization: { nonce: `0x${"cd".repeat(32)}` } as never }),
      operation({
        authorization: {
          to: "0x5555555555555555555555555555555555555555",
        } as never,
      }),
      operation({ domain: { ...operation().domain, name: "OtherToken" } }),
    ];
    for (const variant of variants) {
      const h = harness({
        policyOverride: {
          ...policy,
          payees: [PAYEE, "0x5555555555555555555555555555555555555555"],
        },
      });
      await h.guard.enforce(operation());
      await h.guard.enforce(variant);
      assert.equal(h.calls, 2, "each mutation must re-consult the gate");
      assert.equal(h.signCalls, 2);
    }
  });
});

describe("policy parsing is strict", () => {
  it("rejects a missing asset list, chain list, or endpoint", () => {
    assert.throws(
      () => parseOperatorPolicy({ ...policy, assets: [] }),
      /assets/,
    );
    assert.throws(
      () => parseOperatorPolicy({ ...policy, chains: [] }),
      /chains/,
    );
    assert.throws(
      () => parseOperatorPolicy({ ...policy, gateEndpoint: undefined }),
      /gateEndpoint/,
    );
  });

  it("rejects an endpoint with embedded credentials", () => {
    assert.throws(
      () =>
        parseOperatorPolicy({
          ...policy,
          gateEndpoint: "https://user:pass@gate.example",
        }),
      /credentials/,
    );
  });

  it("rejects a malformed payee address", () => {
    assert.throws(
      () => parseOperatorPolicy({ ...policy, payees: ["not-an-address"] }),
      /payees/,
    );
  });
});
