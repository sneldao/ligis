/**
 * Typed payment assets: token decimals, CAIP-2 chain ids, rails, and the
 * PaymentIntent token leg as it flows through parsing and `decide()`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JevIntentInput } from "@ligis/core";
import { ZCASH_DEMO_VERIFIED_SUBJECT } from "@ligis/core";
import { decide, type PaymentIntent } from "@/lib/decide";
import { bodyToIntent, fromBadRequest, queryToIntent } from "@/lib/gate-intent";
import {
  DEFAULT_CHAIN_ID,
  formatBaseUnits,
  networkIdForChain,
  parsePaymentAmount,
  railFor,
  scaleBaseUnitsByUsd,
  toBaseUnits,
  tokenDecimals,
  usdcAmount,
  zecAmount,
} from "@/lib/payment-asset";

const EVM_PAYEE = "0x1111111111111111111111111111111111111111";

describe("payment-asset helpers", () => {
  it("knows token decimals and rails", () => {
    assert.equal(tokenDecimals("ZEC"), 8);
    assert.equal(tokenDecimals("USDC"), 6);
    assert.equal(railFor({ tokenSymbol: "ZEC" }), "zcash-shielded");
    assert.equal(railFor({ tokenSymbol: "USDC" }), "evm-erc20");
    assert.equal(DEFAULT_CHAIN_ID.ZEC, "zcash:testnet");
    assert.equal(DEFAULT_CHAIN_ID.USDC, "eip155:10143");
    assert.equal(networkIdForChain("zcash:testnet"), "zcash-testnet");
    assert.equal(networkIdForChain("eip155:688689"), "pharos-atlantic");
  });

  it("converts decimals to base units without float drift", () => {
    assert.equal(toBaseUnits("ZEC", "0.25"), "25000000");
    assert.equal(toBaseUnits("ZEC", "1"), "100000000");
    assert.equal(toBaseUnits("USDC", 0.1), "100000");
    assert.equal(toBaseUnits("USDC", "1200.000000"), "1200000000");
    assert.throws(() => toBaseUnits("USDC", "0.0000001"));
    assert.throws(() => toBaseUnits("ZEC", "-1"));
    assert.equal(formatBaseUnits("ZEC", "25000000"), "0.25 ZEC");
    assert.equal(formatBaseUnits("USDC", "1200000000"), "1200 USDC");
    assert.deepEqual(zecAmount({ zatoshis: 1n }), {
      tokenSymbol: "ZEC",
      chainId: "zcash:testnet",
      amountBaseUnits: "1",
    });
  });

  it("scales a USD reference price into token base units", () => {
    // 0.25 ZEC quoted at $25 → a $10 contract price is 0.1 ZEC.
    assert.equal(scaleBaseUnitsByUsd("25000000", 10, 25), "10000000");
    assert.equal(scaleBaseUnitsByUsd("1200000000", 1200, 1200), "1200000000");
  });

  it("parses and validates the token triple", () => {
    assert.deepEqual(parsePaymentAmount({}, 12.5), usdcAmount(12.5));
    assert.deepEqual(
      parsePaymentAmount(
        { tokenSymbol: "ZEC", amountBaseUnits: "25000000" },
        25,
      ),
      zecAmount("0.25"),
    );
    assert.match(
      String(parsePaymentAmount({ tokenSymbol: "ZEC" }, 25)),
      /required for ZEC/,
    );
    assert.match(
      String(
        parsePaymentAmount(
          { tokenSymbol: "ZEC", chainId: "eip155:1", amountBaseUnits: "1" },
          1,
        ),
      ),
      /chainId for ZEC/,
    );
    assert.match(
      String(
        parsePaymentAmount(
          { tokenSymbol: "USDC", chainId: "zcash:testnet" },
          1,
        ),
      ),
      /chainId for USDC/,
    );
    assert.match(
      String(
        parsePaymentAmount({ tokenSymbol: "USDC", amountBaseUnits: "5" }, 1),
      ),
      /does not match amountUsd/,
    );
    assert.match(
      String(parsePaymentAmount({ tokenSymbol: "DOGE" }, 1)),
      /tokenSymbol must be one of/,
    );
    assert.match(
      String(
        parsePaymentAmount({ tokenSymbol: "ZEC", amountBaseUnits: "0.5" }, 1),
      ),
      /positive integer string/,
    );
  });
});

describe("gate intent parsing carries the token leg", () => {
  it("defaults legacy bodies to USDC on the default EVM chain", () => {
    const out = bodyToIntent({
      payee: EVM_PAYEE,
      amountUsd: 100,
      purpose: "x",
    });
    assert.ok(typeof out !== "string");
    assert.equal(out.tokenSymbol, "USDC");
    assert.equal(out.chainId, "eip155:10143");
    assert.equal(out.amountBaseUnits, "100000000");
  });

  it("accepts an explicit ZEC body for a shielded payee", () => {
    const out = bodyToIntent({
      payee: ZCASH_DEMO_VERIFIED_SUBJECT,
      amountUsd: 25,
      purpose: "escrow release",
      tokenSymbol: "ZEC",
      chainId: "zcash:testnet",
      amountBaseUnits: "25000000",
    });
    assert.ok(typeof out !== "string", String(out));
    assert.equal(out.tokenSymbol, "ZEC");
    assert.equal(out.amountBaseUnits, "25000000");
  });

  it("rejects rail/payee mismatches", () => {
    const zecToEvm = bodyToIntent({
      payee: EVM_PAYEE,
      amountUsd: 25,
      purpose: "x",
      tokenSymbol: "ZEC",
      amountBaseUnits: "25000000",
    });
    assert.equal(typeof zecToEvm, "string");
    assert.match(fromBadRequest(zecToEvm as string), /Zcash shielded payee/);
    const usdcToZcash = queryToIntent(
      ZCASH_DEMO_VERIFIED_SUBJECT,
      "25",
      "x",
      null,
      undefined,
      { tokenSymbol: "USDC" },
    );
    assert.equal(typeof usdcToZcash, "string");
  });

  it("GET query accepts tokenSymbol/chainId/amountBaseUnits", () => {
    const out = queryToIntent(
      ZCASH_DEMO_VERIFIED_SUBJECT,
      "25",
      "x",
      null,
      undefined,
      {
        tokenSymbol: "ZEC",
        chainId: "zcash:testnet",
        amountBaseUnits: "25000000",
      },
    );
    assert.ok(typeof out !== "string", String(out));
    assert.equal(out.tokenSymbol, "ZEC");
  });
});

describe("decide() forwards the typed token leg to Jev", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    LIGIS_JEV_ENABLED: "1",
    AI_GATEWAY_API_KEY: "test-double",
  };

  async function capture(intent: PaymentIntent) {
    let seen: JevIntentInput | undefined;
    const decision = await decide(intent, {
      env,
      evaluateIntent: async (input) => {
        seen = input;
        return { verdict: "GO", confidence: 0.9, flags: [], latencyMs: 1 };
      },
      resolveSubject: async () => ({ ok: false as const, error: "stub" }),
    });
    assert.ok(seen, "jev was not called");
    return { decision, seen };
  }

  it("ZEC: zatoshis, 8 decimals, reference price scaled by implied rate", async () => {
    const { decision, seen } = await capture({
      payee: ZCASH_DEMO_VERIFIED_SUBJECT,
      amountUsd: 25,
      ...zecAmount("0.25"),
      purpose: "escrow release",
      mandate: { expectedUsd: 10 },
    });
    assert.equal(seen.tokenSymbol, "ZEC");
    assert.equal(seen.tokenDecimals, "8");
    assert.equal(seen.payment?.amountSmallestUnit, "25000000");
    assert.equal(seen.gatePriceSmallestUnit, "10000000");
    assert.ok(
      decision.provenance.some((p) =>
        p.includes(
          "payment 0.25 ZEC (25000000 base units) on zcash:testnet via zcash-shielded",
        ),
      ),
      decision.provenance.join("\n"),
    );
  });

  it("USDC: micro-USDC, 6 decimals", async () => {
    const { seen } = await capture({
      payee: EVM_PAYEE,
      amountUsd: 12.5,
      ...usdcAmount(12.5, "eip155:688689"),
      purpose: "data",
    });
    assert.equal(seen.tokenSymbol, "USDC");
    assert.equal(seen.tokenDecimals, "6");
    assert.equal(seen.payment?.amountSmallestUnit, "12500000");
    assert.equal(seen.gatePriceSmallestUnit, "12500000");
  });
});
