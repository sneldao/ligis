import assert from "node:assert/strict";
import { it } from "node:test";
import {
  evaluatePaymentIntent,
  jevHeaders,
  loadJevConfig,
  type JevConfig,
  type JevIntentInput,
} from "../src/jev-intent.js";

const SUBJECT =
  "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1";
const PAYEE =
  "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37";

const BASE_INPUT: JevIntentInput = {
  subject: SUBJECT,
  capability: "data.premium",
  capabilityDescription: "Premium RWA oracle feed",
  gatePriceSmallestUnit: "1000000000",
  tokenSymbol: "CSPR",
  tokenDecimals: "9",
  advertisedPayTo: PAYEE,
  payment: { scheme: "exact", amountSmallestUnit: "1000000000", payTo: PAYEE },
};

const CONFIG: JevConfig = {
  enabled: true,
  transport: "direct",
  apiKey: "sk-test",
  apiUrl: "https://jev.test/v1/systemone",
  model: "jev-latest",
  minConfidence: 0.6,
  timeoutMs: 1000,
  enforce: false,
};

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

/** Stub fetch that answers with canned Jev answers and records the request. */
function stubFetch(
  answers: Record<string, unknown>,
  opts: {
    status?: number;
    fail?: boolean;
    model?: string;
    inputTokens?: number;
  } = {},
) {
  const calls: CapturedCall[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (opts.fail) throw new Error("connection refused");
    if (opts.status && opts.status !== 200) {
      return new Response("nope", { status: opts.status });
    }
    return new Response(
      JSON.stringify({
        model: opts.model ?? "jev-1.13.0",
        answers,
        usage: { input_tokens: opts.inputTokens ?? 210, output_tokens: 0 },
      }),
      { status: 200 },
    );
  };
  return { impl, calls };
}

const GO_ANSWERS = {
  scope: {
    type: "choice",
    choice: "consistent",
    probabilities: {},
    confidence: 0.95,
  },
  amount_plausibility: {
    type: "score",
    score: 2,
    legend: {},
    probabilities: {},
    confidence: 0.88,
  },
  payee_consistency: { type: "noul", noul: 0.97 },
  request_normality: { type: "noul", noul: 0.93 },
};

it("composes GO when all answers are consistent", async () => {
  const { impl, calls } = stubFetch(GO_ANSWERS);
  const result = await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl);
  assert.equal(result.verdict, "GO");
  assert.deepEqual(result.flags, []);
  assert.ok(Math.abs(result.confidence - 0.915) < 1e-9);
  // 210 input tokens at $0.042/MTok; output is free.
  assert.ok(Math.abs((result.costUsd ?? 0) - (210 * 0.042) / 1e6) < 1e-12);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(calls.length, 1);
});

it("sends state, questions, and auth in a single call", async () => {
  const { impl, calls } = stubFetch(GO_ANSWERS);
  await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl);
  const init = calls[0]!.init!;
  assert.equal(calls[0]!.url, CONFIG.apiUrl);
  assert.equal(init.method, "POST");
  assert.equal(
    (init.headers as Record<string, string>).authorization,
    "Bearer sk-test",
  );
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state.subject, SUBJECT);
  // Wire state uses snake_case paths, matching the question instructions.
  assert.equal(body.state.gate_price.amount_smallest_unit, "1000000000");
  assert.equal(body.state.gate_price.human_readable, "1.000000000 CSPR");
  assert.equal(body.state.payment.amount_smallest_unit, "1000000000");
  assert.equal(body.state.payment.human_readable, "1.000000000 CSPR");
  assert.equal(body.state.advertised_pay_to, PAYEE);
  // Enrichment: computable facts are stated as facts.
  assert.equal(body.state.code_checks.amount_matches_requested_price, true);
  assert.equal(body.state.code_checks.payee_matches_advertised, true);
  assert.deepEqual(Object.keys(body.questions).sort(), [
    "amount_plausibility",
    "payee_consistency",
    "request_normality",
    "scope",
  ]);
});

it("flags overpayment as STOP with a direction-aware label", async () => {
  const { impl } = stubFetch({
    ...GO_ANSWERS,
    amount_plausibility: {
      type: "score",
      score: 0,
      legend: {},
      probabilities: {},
      confidence: 0.92,
    },
  });
  const result = await evaluatePaymentIntent(
    {
      ...BASE_INPUT,
      payment: { ...BASE_INPUT.payment, amountSmallestUnit: "500000000000" },
    },
    CONFIG,
    impl,
  );
  assert.equal(result.verdict, "STOP");
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0]!.id, "amount-mismatch");
  assert.match(result.flags[0]!.label, /overpayment/);
  assert.equal(result.confidence, 0.92);
});

it("flags underpayment as STOP", async () => {
  const { impl } = stubFetch({
    ...GO_ANSWERS,
    amount_plausibility: {
      type: "score",
      score: 0,
      legend: {},
      probabilities: {},
      confidence: 0.9,
    },
  });
  const result = await evaluatePaymentIntent(
    {
      ...BASE_INPUT,
      payment: { ...BASE_INPUT.payment, amountSmallestUnit: "1" },
    },
    CONFIG,
    impl,
  );
  assert.equal(result.verdict, "STOP");
  assert.match(result.flags[0]!.label, /underpayment/);
});

it("ignores inconsistency below the confidence floor", async () => {
  const { impl } = stubFetch({
    ...GO_ANSWERS,
    scope: {
      type: "choice",
      choice: "inconsistent",
      probabilities: {},
      confidence: 0.3,
    },
  });
  const result = await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl);
  assert.equal(result.verdict, "GO");
  assert.deepEqual(result.flags, []);
});

it("flags payee mismatch from a low noul", async () => {
  const { impl } = stubFetch({
    ...GO_ANSWERS,
    payee_consistency: { type: "noul", noul: 0.05 },
  });
  const result = await evaluatePaymentIntent(
    {
      ...BASE_INPUT,
      payment: { ...BASE_INPUT.payment, payTo: "account-hash-<fresh>" },
    },
    CONFIG,
    impl,
  );
  assert.equal(result.verdict, "STOP");
  assert.equal(result.flags[0]!.id, "payee-mismatch");
  assert.ok(Math.abs(result.flags[0]!.confidence - 0.95) < 1e-9);
});

it("skips without a fetch when the layer is disabled or the key is missing", async () => {
  const { impl, calls } = stubFetch(GO_ANSWERS);
  const disabled = await evaluatePaymentIntent(
    BASE_INPUT,
    { ...CONFIG, enabled: false },
    impl,
  );
  assert.equal(disabled.verdict, "SKIPPED");
  assert.equal(disabled.skippedReason, "layer disabled");

  const noKey = await evaluatePaymentIntent(
    BASE_INPUT,
    { ...CONFIG, apiKey: "" },
    impl,
  );
  assert.equal(noKey.verdict, "SKIPPED");
  assert.equal(noKey.skippedReason, "missing TYPESAFE_API_KEY");
  assert.equal(calls.length, 0);
});

it("fails open on network errors and HTTP failures", async () => {
  const { impl } = stubFetch(GO_ANSWERS, { fail: true });
  const net = await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl);
  assert.equal(net.verdict, "SKIPPED");
  assert.match(net.skippedReason ?? "", /unreachable/);

  const { impl: impl500 } = stubFetch(GO_ANSWERS, { status: 500 });
  const http = await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl500);
  assert.equal(http.verdict, "SKIPPED");
  assert.equal(http.skippedReason, "jev HTTP 500");
});

it("maps results onto X-Jev-* response headers", async () => {
  const { impl } = stubFetch({
    ...GO_ANSWERS,
    amount_plausibility: {
      type: "score",
      score: 0,
      legend: {},
      probabilities: {},
      confidence: 0.92,
    },
  });
  const result = await evaluatePaymentIntent(
    {
      ...BASE_INPUT,
      payment: { ...BASE_INPUT.payment, amountSmallestUnit: "500000000000" },
    },
    CONFIG,
    impl,
  );
  const headers = jevHeaders(result);
  assert.equal(headers["x-jev-verdict"], "STOP");
  assert.equal(headers["x-jev-confidence"], "0.920");
  assert.equal(headers["x-jev-flags"], "amount-mismatch");
  assert.equal(headers["x-jev-model"], "jev-1.13.0");
  assert.match(headers["x-jev-latency-ms"], /^\d+$/);
  assert.match(headers["x-jev-cost-usd"], /^\d+\.\d{8}$/);
});

it("loads config from the environment with safe defaults", () => {
  const off = loadJevConfig({});
  assert.equal(off.enabled, false);
  // auto with no keys resolves to the gateway (the free route) so the skip
  // reason names AI_GATEWAY_API_KEY.
  assert.equal(off.transport, "gateway");
  assert.equal(
    off.apiUrl,
    "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
  );
  assert.equal(off.model, "typesafe-ai/jev");
  assert.equal(off.minConfidence, 0.6);
  assert.equal(off.enforce, false);

  const on = loadJevConfig({
    LIGIS_JEV_ENABLED: "1",
    TYPESAFE_API_KEY: "sk-...",
    LIGIS_JEV_ENFORCE: "1",
    LIGIS_JEV_MIN_CONFIDENCE: "0.75",
  });
  assert.equal(on.enabled, true);
  assert.equal(on.transport, "direct");
  assert.equal(on.apiKey, "sk-...");
  assert.equal(on.enforce, true);
  assert.equal(on.minConfidence, 0.75);
});

it("resolves transport auto/overrides per route", () => {
  // auto: gateway key wins (free promo route).
  const viaGateway = loadJevConfig({ AI_GATEWAY_API_KEY: "gsk" });
  assert.equal(viaGateway.transport, "gateway");
  assert.equal(viaGateway.model, "typesafe-ai/jev");
  assert.equal(viaGateway.apiKey, "gsk");

  // auto: falls back to direct when only a native key exists.
  const viaDirect = loadJevConfig({ TYPESAFE_API_KEY: "sk" });
  assert.equal(viaDirect.transport, "direct");
  assert.equal(viaDirect.model, "jev-latest");
  assert.equal(viaDirect.apiUrl, "https://api.typesafe.ai/v1/systemone");

  // Explicit transport does not silently borrow the other route's credential.
  const forced = loadJevConfig({
    LIGIS_JEV_TRANSPORT: "direct",
    AI_GATEWAY_API_KEY: "gsk",
  });
  assert.equal(forced.transport, "direct");
  assert.equal(forced.apiKey, "");

  // LIGIS_JEV_API_KEY overrides whichever route is active.
  const overridden = loadJevConfig({
    LIGIS_JEV_API_KEY: "k",
    AI_GATEWAY_API_KEY: "gsk",
  });
  assert.equal(overridden.apiKey, "k");
});

it("states code_checks facts when the payment deviates from the ask", async () => {
  const { impl, calls } = stubFetch(GO_ANSWERS);
  await evaluatePaymentIntent(
    {
      ...BASE_INPUT,
      payment: {
        scheme: "exact",
        amountSmallestUnit: "500000000000",
        payTo: "account-hash-<fresh>",
      },
    },
    CONFIG,
    impl,
  );
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.state.code_checks.amount_matches_requested_price, false);
  assert.equal(body.state.code_checks.payee_matches_advertised, false);
  assert.equal(body.state.payment.human_readable, "500.000000000 CSPR");
  assert.equal(body.state.gate_price.human_readable, "1.000000000 CSPR");
});

it("prefers the gateway-reported cost when present", async () => {
  const { impl, calls } = stubFetch(GO_ANSWERS);
  const originalImpl = impl;
  const withCost = async (url: string, init?: RequestInit) => {
    const res = await originalImpl(url, init);
    const body = await res.json();
    body.provider_metadata = { gateway: { cost: "0" } }; // free promo
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await evaluatePaymentIntent(BASE_INPUT, CONFIG, withCost);
  assert.equal(result.costUsd, 0);
  assert.equal(calls.length, 1);
});
