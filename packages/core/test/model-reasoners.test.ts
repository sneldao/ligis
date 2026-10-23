import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChainReasoner } from "../src/chain-reasoner.js";
import {
  OpenAICompatReasoner,
  reasonerFromPreset,
} from "../src/openai-compat-reasoner.js";
import {
  availableReasonerNames,
  parseReasonerSpec,
  reasonerSpecFromEnv,
  resolveReasonerChain,
} from "../src/reasoner-select.js";
import type { Reasoner, ReasoningResult } from "../src/reasoner.js";

function stubReasoner(
  result: Partial<ReasoningResult> & { throws?: string },
): Reasoner {
  return {
    async reason(): Promise<ReasoningResult> {
      if (result.throws) throw new Error(result.throws);
      return {
        text: result.text ?? "{}",
        verified: result.verified ?? false,
        model: result.model ?? "stub",
        provider: result.provider ?? "stub",
      };
    },
  };
}

describe("OpenAICompatReasoner", () => {
  const config = {
    baseUrl: "https://example.test/v1/",
    apiKey: "sk-test",
    model: "qwen-max",
    provider: "alibaba-dashscope",
  };

  it("posts a chat completion and reports the served model", async () => {
    let seen: { url: string; auth: string; body: string } | null = null;
    const reasoner = new OpenAICompatReasoner({
      ...config,
      fetchImpl: (async (url: unknown, init: RequestInit) => {
        seen = {
          url: String(url),
          auth: (init.headers as Record<string, string>).Authorization,
          body: String(init.body),
        };
        return new Response(
          JSON.stringify({
            model: "qwen3-max-2026-09",
            choices: [{ message: { content: '{"capabilities":[]}' } }],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const result = await reasoner.reason("prompt");
    assert.equal(seen!.url, "https://example.test/v1/chat/completions");
    assert.equal(seen!.auth, "Bearer sk-test");
    assert.match(seen!.body, /"model":"qwen-max"/);
    assert.deepEqual(result, {
      text: '{"capabilities":[]}',
      verified: false,
      model: "qwen3-max-2026-09",
      provider: "alibaba-dashscope",
    });
  });

  it("throws on non-200 with status and body", async () => {
    const reasoner = new OpenAICompatReasoner({
      ...config,
      fetchImpl: (async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many",
        })) as typeof fetch,
    });
    await assert.rejects(reasoner.reason("x"), /429.*rate limited/);
  });

  it("throws on an empty completion", async () => {
    const reasoner = new OpenAICompatReasoner({
      ...config,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
        })) as typeof fetch,
    });
    await assert.rejects(reasoner.reason("x"), /empty completion/);
  });
});

describe("reasonerFromPreset", () => {
  it("builds qwen-max from DASHSCOPE_API_KEY", () => {
    const r = reasonerFromPreset("qwen-max", { DASHSCOPE_API_KEY: " k " });
    assert.ok(r instanceof OpenAICompatReasoner);
  });

  it("returns null when the key is missing", () => {
    assert.equal(reasonerFromPreset("qwen-max", {}), null);
    assert.equal(reasonerFromPreset("kimi", {}), null);
  });

  it("returns null for unknown names", () => {
    assert.equal(reasonerFromPreset("nope", { DASHSCOPE_API_KEY: "k" }), null);
  });

  it("honors model/base-url env overrides", () => {
    const r = reasonerFromPreset("openai-compat", {
      OPENAI_COMPAT_API_KEY: "k",
      OPENAI_COMPAT_BASE_URL: "https://ollama.test/v1",
      OPENAI_COMPAT_MODEL: "llama3",
    });
    assert.ok(r instanceof OpenAICompatReasoner);
  });
});

describe("ChainReasoner", () => {
  it("returns the first success", async () => {
    const chain = new ChainReasoner([
      stubReasoner({ throws: "down" }),
      stubReasoner({ text: "ok", provider: "second" }),
    ]);
    const r = await chain.reason("p");
    assert.equal(r.provider, "second");
  });

  it("reports every failure when all fail", async () => {
    const chain = new ChainReasoner(
      [stubReasoner({ throws: "e1" }), stubReasoner({ throws: "e2" })],
      { names: ["a", "b"] },
    );
    await assert.rejects(chain.reason("p"), /a: e1.*b: e2/s);
  });

  it("calls onFallback for each skipped failure", async () => {
    const seen: string[] = [];
    const chain = new ChainReasoner(
      [stubReasoner({ throws: "e1" }), stubReasoner({ text: "ok" })],
      { names: ["a", "b"], onFallback: (n) => seen.push(n) },
    );
    await chain.reason("p");
    assert.deepEqual(seen, ["a"]);
  });

  it("rejects an empty chain", () => {
    assert.throws(() => new ChainReasoner([]), /at least one/);
  });
});

describe("parseReasonerSpec / reasonerSpecFromEnv", () => {
  it("parses comma lists and resolves aliases", () => {
    assert.deepEqual(parseReasonerSpec("qwen, 0G ,local"), [
      "qwen-max",
      "zerog",
      "local",
    ]);
    assert.deepEqual(parseReasonerSpec("moonshot"), ["kimi"]);
  });

  it("env precedence: CHAIN > REASONER > default", () => {
    assert.equal(
      reasonerSpecFromEnv({
        LIGIS_REASONER_CHAIN: "kimi",
        LIGIS_REASONER: "qwen-max",
      }),
      "kimi",
    );
    assert.equal(reasonerSpecFromEnv({ LIGIS_REASONER: "local" }), "local");
    assert.equal(reasonerSpecFromEnv({}), "zerog,local");
  });
});

describe("resolveReasonerChain", () => {
  const extra = {
    zerog: () => null as Reasoner | null,
    local: () => stubReasoner({ provider: "local" }),
  };

  it("resolves a single entry directly", () => {
    const r = resolveReasonerChain("local", extra);
    assert.ok(!(r instanceof ChainReasoner));
  });

  it("chains multiple entries in order", () => {
    const r = resolveReasonerChain("zerog,local,qwen-max", {
      ...extra,
      "qwen-max": () => stubReasoner({ provider: "q" }),
    });
    assert.ok(r instanceof ChainReasoner);
  });

  it("skips unconfigured providers via onSkip", () => {
    const skipped: string[] = [];
    const r = resolveReasonerChain("zerog,local", extra, {
      onSkip: (n) => skipped.push(n),
    });
    assert.deepEqual(skipped, ["zerog"]);
    assert.ok(!(r instanceof ChainReasoner)); // only local survived
  });

  it("resolves presets from env", () => {
    const r = resolveReasonerChain("qwen-max,local", extra, {
      env: { DASHSCOPE_API_KEY: "k" },
    });
    assert.ok(r instanceof ChainReasoner);
  });

  it("throws on unknown names listing what is available", () => {
    assert.throws(
      () => resolveReasonerChain("bogus,local", extra),
      /unknown reasoner 'bogus'.*local/s,
    );
    assert.ok(availableReasonerNames(extra).includes("local"));
  });

  it("throws when nothing in the chain is configured", () => {
    assert.throws(
      () => resolveReasonerChain("zerog,qwen-max", extra, { env: {} }),
      /no configured reasoner.*zerog,qwen-max/,
    );
  });

  it("treats throwing factories as unconfigured", () => {
    const skipped: string[] = [];
    const r = resolveReasonerChain(
      "zerog,local",
      {
        zerog: () => {
          throw new Error("no key");
        },
        local: () => stubReasoner({ provider: "local" }),
      },
      { onSkip: (n) => skipped.push(n) },
    );
    assert.deepEqual(skipped, ["zerog"]);
    assert.ok(!(r instanceof ChainReasoner));
  });
});
