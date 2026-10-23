import assert from "node:assert/strict";
import { it } from "node:test";
import {
  evaluatePaymentIntent,
  jevHeaders,
  jevSummary,
  loadJevConfig,
  resetJevCooldowns,
  type JevConfig,
  type JevIntentInput,
} from "@ligis/core";

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

// ── Route chains + novita-vl (AutoTrust JEV-27B-VL via Novita) ───────────────

const NOVITA_URL = "https://novita.test/v3/autotrust/v1/decide";

const NOVITA_CONFIG: JevConfig = {
  ...CONFIG,
  transport: "novita-vl",
  apiKey: "nv-test",
  apiUrl: NOVITA_URL,
  model: "autotrust/jev-27b-vl",
};

/** Decide payloads in call order: scope, amount, payee, normality. */
interface NovitaPayload {
  options?: string[];
  probabilities?: number[];
  status?: number;
}

const NOVITA_GO: NovitaPayload[] = [
  {
    options: ["consistent", "inconsistent", "unclear"],
    probabilities: [0.9, 0.07, 0.03],
  },
  {
    options: ["implausible", "questionable", "plausible"],
    probabilities: [0.05, 0.15, 0.8],
  },
  { options: ["false", "true"], probabilities: [0.1, 0.9] },
  { options: ["false", "true"], probabilities: [0.1, 0.9] },
];

/**
 * Stub fetch for the decide endpoint. `responses[i]` answers the i-th call —
 * the adapter fans out in plan order (scope, amount, payee, normality), and
 * stub fetch calls record in invocation order.
 */
function stubNovitaFetch(
  responses: NovitaPayload[],
  opts: { promptTokens?: number; fail?: boolean } = {},
) {
  const calls: { url: string; init?: RequestInit; body: any }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, init, body });
    if (opts.fail) throw new Error("connection refused");
    const spec = responses[calls.length - 1] ?? {};
    const status = spec.status ?? 200;
    if (status !== 200) {
      return new Response(
        JSON.stringify({
          code: "NOT_ENOUGH_BALANCE",
          reason: "billing",
          message: "promo over",
        }),
        { status },
      );
    }
    return new Response(
      JSON.stringify({
        kind: body.kind,
        model: "autotrust/JEV-27B-VL",
        options: spec.options,
        probabilities: spec.probabilities,
        usage: {
          prompt_tokens: opts.promptTokens ?? 50,
          completion_tokens: 1,
          total_tokens: (opts.promptTokens ?? 50) + 1,
        },
      }),
      { status: 200 },
    );
  };
  return { impl, calls };
}

it("parses LIGIS_JEV_FALLBACK, dropping keyless/unknown/dup/primary entries", () => {
  const cfg = loadJevConfig({
    TYPESAFE_API_KEY: "sk",
    LIGIS_JEV_TRANSPORT: "direct",
    LIGIS_JEV_FALLBACK: "novita-vl,bogus,direct,gateway,direct, novita-vl",
    NOVITA_API_KEY: "nv",
  });
  // gateway has no key, bogus unknown, direct is the primary + a dup,
  // novita-vl dedupes to one entry.
  assert.deepEqual(
    cfg.fallbacks?.map((r) => r.name),
    ["novita-vl"],
  );
  assert.equal(cfg.fallbacks![0]!.protocol, "novita-decide");
  assert.equal(cfg.fallbacks![0]!.apiKey, "nv");
  assert.equal(
    cfg.fallbacks![0]!.apiUrl,
    NOVITA_URL.replace("novita.test", "api.novita.ai"),
  );
  assert.equal(cfg.fallbacks![0]!.model, "autotrust/jev-27b-vl");

  // Unset → no fallbacks at all.
  assert.equal(loadJevConfig({}).fallbacks, undefined);
  // Set but everything dropped → undefined, not an empty chain.
  assert.equal(
    loadJevConfig({ LIGIS_JEV_FALLBACK: "bogus,direct" }).fallbacks,
    undefined,
  );
});

it("loads novita-vl as an explicit primary with defaults and overrides", () => {
  const cfg = loadJevConfig({
    LIGIS_JEV_TRANSPORT: "novita-vl",
    NOVITA_API_KEY: "nv",
    LIGIS_JEV_NOVITA_INPUT_USD_PER_MTOK: "0.5",
  });
  assert.equal(cfg.transport, "novita-vl");
  assert.equal(cfg.apiKey, "nv");
  assert.equal(cfg.apiUrl, "https://api.novita.ai/v3/autotrust/v1/decide");
  assert.equal(cfg.model, "autotrust/jev-27b-vl");
  assert.equal(cfg.novitaInputUsdPerMTok, 0.5);

  // LIGIS_JEV_NOVITA_API_KEY beats NOVITA_API_KEY; URL/model overrides apply.
  const ov = loadJevConfig({
    LIGIS_JEV_TRANSPORT: "novita-vl",
    NOVITA_API_KEY: "nv",
    LIGIS_JEV_NOVITA_API_KEY: "nv-2",
    LIGIS_JEV_NOVITA_API_URL: "https://stub.test/decide",
    LIGIS_JEV_NOVITA_MODEL: "autotrust/other",
  });
  assert.equal(ov.apiKey, "nv-2");
  assert.equal(ov.apiUrl, "https://stub.test/decide");
  assert.equal(ov.model, "autotrust/other");

  // auto never picks novita-vl, even with a Novita key.
  assert.equal(
    loadJevConfig({ NOVITA_API_KEY: "nv", TYPESAFE_API_KEY: "sk" }).transport,
    "direct",
  );
});

it("fans novita-vl out to four single-question decide requests", async () => {
  resetJevCooldowns();
  const { impl, calls } = stubNovitaFetch(NOVITA_GO);
  await evaluatePaymentIntent(BASE_INPUT, NOVITA_CONFIG, impl);
  assert.equal(calls.length, 4);
  const kinds = calls.map((c) => c.body.kind);
  assert.deepEqual(kinds, ["choice", "choice", "noul", "noul"]);
  for (const call of calls) {
    assert.equal(call.url, NOVITA_URL);
    assert.equal(
      (call.init!.headers as Record<string, string>).authorization,
      "Bearer nv-test",
    );
    assert.equal(call.body.model, "autotrust/jev-27b-vl");
    assert.equal(call.body.thinking, "off");
    assert.equal(typeof call.body.question, "string");
    assert.ok(call.body.question.length > 0);
    assert.equal("questions" in call.body, false);
    // Same state object shape the systemone route sends.
    assert.equal(call.body.state.advertised_pay_to, PAYEE);
  }
  assert.deepEqual(calls[0]!.body.options, [
    "consistent",
    "inconsistent",
    "unclear",
  ]);
  assert.deepEqual(calls[1]!.body.options, [
    "implausible",
    "questionable",
    "plausible",
  ]);
  assert.equal(calls[2]!.body.options, undefined);
});

it("composes GO via novita-vl with summed input tokens", async () => {
  resetJevCooldowns();
  const { impl } = stubNovitaFetch(NOVITA_GO, { promptTokens: 50 });
  const result = await evaluatePaymentIntent(BASE_INPUT, NOVITA_CONFIG, impl);
  assert.equal(result.verdict, "GO");
  assert.equal(result.route, "novita-vl");
  assert.equal(result.inputTokens, 200);
  // No published unit price — cost stays undefined, never TypeSafe-priced.
  assert.equal(result.costUsd, undefined);

  const priced = await evaluatePaymentIntent(
    BASE_INPUT,
    { ...NOVITA_CONFIG, novitaInputUsdPerMTok: 0.5 },
    stubNovitaFetch(NOVITA_GO, { promptTokens: 50 }).impl,
  );
  assert.equal(priced.costUsd, (200 * 0.5) / 1e6);
});

it("flags STOP via novita-vl on scope, amount, and payee mismatches", async () => {
  resetJevCooldowns();
  const inconsistent = NOVITA_GO.map((p, i) =>
    i === 0 ? { ...p, probabilities: [0.05, 0.9, 0.05] } : p,
  );
  const scope = await evaluatePaymentIntent(
    BASE_INPUT,
    NOVITA_CONFIG,
    stubNovitaFetch(inconsistent).impl,
  );
  assert.equal(scope.verdict, "STOP");
  assert.equal(scope.flags[0]!.id, "scope-mismatch");

  const implausible = NOVITA_GO.map((p, i) =>
    i === 1 ? { ...p, probabilities: [0.9, 0.08, 0.02] } : p,
  );
  const amount = await evaluatePaymentIntent(
    BASE_INPUT,
    NOVITA_CONFIG,
    stubNovitaFetch(implausible).impl,
  );
  assert.equal(amount.verdict, "STOP");
  assert.equal(amount.flags[0]!.id, "amount-mismatch");

  const payeeLow = NOVITA_GO.map((p, i) =>
    i === 2 ? { ...p, probabilities: [0.9, 0.1] } : p,
  );
  const payee = await evaluatePaymentIntent(
    BASE_INPUT,
    NOVITA_CONFIG,
    stubNovitaFetch(payeeLow).impl,
  );
  assert.equal(payee.verdict, "STOP");
  assert.equal(payee.flags[0]!.id, "payee-mismatch");
});

it("parses noul by index when options arrive reversed", async () => {
  resetJevCooldowns();
  const reversed = NOVITA_GO.map((p, i) =>
    i >= 2 ? { options: ["true", "false"], probabilities: [0.9, 0.1] } : p,
  );
  const result = await evaluatePaymentIntent(
    BASE_INPUT,
    NOVITA_CONFIG,
    stubNovitaFetch(reversed).impl,
  );
  assert.equal(result.verdict, "GO");
});

it("falls through to novita-vl when the direct primary fails", async () => {
  resetJevCooldowns();
  const novita = stubNovitaFetch(NOVITA_GO);
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === NOVITA_URL) return novita.impl(url, init);
    return new Response("nope", { status: 500 });
  };
  const cfg: JevConfig = {
    ...CONFIG,
    fallbacks: [
      {
        name: "novita-vl",
        protocol: "novita-decide",
        apiKey: "nv",
        apiUrl: NOVITA_URL,
        model: "autotrust/jev-27b-vl",
      },
    ],
  };
  const result = await evaluatePaymentIntent(BASE_INPUT, cfg, impl);
  assert.equal(result.verdict, "GO");
  assert.equal(result.route, "novita-vl");
  assert.equal(novita.calls.length, 4);
  assert.deepEqual(result.attempts, [
    { route: "direct", outcome: "jev HTTP 500" },
    { route: "novita-vl", outcome: "ok" },
  ]);
});

it("arms the novita-vl cooldown on a 403 and skips without fetching", async () => {
  resetJevCooldowns();
  let novitaFetches = 0;
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === NOVITA_URL) {
      novitaFetches += 1;
      return new Response("{}", { status: 403 });
    }
    return stubFetch(GO_ANSWERS).impl(url, init);
  };
  const cfg: JevConfig = {
    ...NOVITA_CONFIG,
    fallbacks: [
      {
        name: "direct",
        protocol: "systemone",
        apiKey: "sk-test",
        apiUrl: CONFIG.apiUrl,
        model: "jev-latest",
      },
    ],
  };
  const first = await evaluatePaymentIntent(BASE_INPUT, cfg, impl);
  assert.equal(first.verdict, "GO");
  assert.equal(first.route, "direct");
  assert.ok(novitaFetches > 0);
  assert.equal(first.attempts?.[0]?.outcome, "jev HTTP 403");

  // Second call inside the 60s window: novita-vl is skipped in cooldown —
  // zero further novita fetches, and the chain still answers via direct.
  novitaFetches = 0;
  const second = await evaluatePaymentIntent(BASE_INPUT, cfg, impl);
  assert.equal(second.verdict, "GO");
  assert.equal(second.route, "direct");
  assert.equal(novitaFetches, 0);
  assert.equal(second.attempts?.[0]?.outcome, "cooldown");

  resetJevCooldowns();
});

it("reports every failure when the whole chain dies", async () => {
  resetJevCooldowns();
  const impl = async (url: string): Promise<Response> =>
    new Response("nope", { status: url === NOVITA_URL ? 400 : 500 });
  const cfg: JevConfig = {
    ...CONFIG,
    fallbacks: [
      {
        name: "novita-vl",
        protocol: "novita-decide",
        apiKey: "nv",
        apiUrl: NOVITA_URL,
        model: "autotrust/jev-27b-vl",
      },
    ],
  };
  const result = await evaluatePaymentIntent(BASE_INPUT, cfg, impl);
  assert.equal(result.verdict, "SKIPPED");
  assert.equal(
    result.skippedReason,
    "all routes failed — direct: jev HTTP 500; novita-vl: jev HTTP 400",
  );
  assert.equal(result.attempts?.length, 2);
});

it("honours one overall deadline across the chain", async () => {
  resetJevCooldowns();
  // Primary never resolves on its own — it only rejects when aborted.
  const hanging = async (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("The operation timed out")),
      );
    });
  const start = Date.now();
  const result = await evaluatePaymentIntent(
    BASE_INPUT,
    { ...CONFIG, timeoutMs: 150 },
    hanging,
  );
  const elapsed = Date.now() - start;
  assert.equal(result.verdict, "SKIPPED");
  assert.ok(elapsed < 1000, `took ${elapsed}ms — expected ~150ms`);
  assert.match(result.skippedReason ?? "", /unreachable|deadline/);
});

it("keeps single-route failure reasons exact (no chain decoration)", async () => {
  resetJevCooldowns();
  const { impl } = stubFetch(GO_ANSWERS, { status: 500 });
  const result = await evaluatePaymentIntent(BASE_INPUT, CONFIG, impl);
  assert.equal(result.verdict, "SKIPPED");
  assert.equal(result.skippedReason, "jev HTTP 500");
  assert.equal(result.attempts, undefined);
  assert.equal(result.route, undefined);
});

it("reports the producing route in headers and summary", async () => {
  resetJevCooldowns();
  const { impl } = stubNovitaFetch(NOVITA_GO);
  const result = await evaluatePaymentIntent(BASE_INPUT, NOVITA_CONFIG, impl);
  const headers = jevHeaders(result);
  assert.equal(headers["x-jev-route"], "novita-vl");
  assert.equal(jevSummary(result).route, "novita-vl");

  // Single-route results carry route too; skipped results carry neither.
  const skip = await evaluatePaymentIntent(
    BASE_INPUT,
    { ...CONFIG, enabled: false },
    impl,
  );
  assert.equal(skip.route, undefined);
  assert.equal(jevHeaders(skip)["x-jev-route"], undefined);
});
