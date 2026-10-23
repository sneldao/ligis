/**
 * OpenAICompatReasoner — `Reasoner` over any OpenAI-compatible chat endpoint.
 *
 * Lets the Trust Steward run on hosted frontier models (Alibaba Model
 * Studio / DashScope for Qwen Max, Moonshot for KIMI, or any compatible
 * provider) alongside — or instead of — the TEE-verified 0G path.
 *
 * `verified` is always false: only 0G's TEE path produces verifiable
 * inference. The `provider` field names the vendor honestly so receipts
 * can distinguish capability (a stronger model) from verifiability (0G).
 */
import type { Reasoner, ReasoningResult } from "./reasoner.js";

export interface OpenAICompatConfig {
  /** Base URL without the /chat/completions suffix (trailing slashes ok). */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Vendor label reported in ReasoningResult.provider. */
  provider: string;
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string } }[];
}

export class OpenAICompatReasoner implements Reasoner {
  constructor(private config: OpenAICompatConfig) {}

  async reason(prompt: string): Promise<ReasoningResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${this.config.provider} inference failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`,
      );
    }
    const completion = (await response.json()) as ChatCompletion;
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(`${this.config.provider} returned an empty completion`);
    }
    return {
      text,
      verified: false,
      // Report the served model when the provider echoes it back — aliases
      // like `qwen-max` resolve to a concrete version upstream.
      model: completion.model ?? this.config.model,
      provider: this.config.provider,
    };
  }
}

// ---------- Presets ----------

export type EnvLike = Record<string, string | undefined>;

export interface ReasonerPreset {
  provider: string;
  baseUrl?: string;
  model?: string;
  /** Env vars checked in order for the API key. */
  apiKeyEnv: readonly string[];
  baseUrlEnv?: string;
  modelEnv?: string;
}

export const REMOTE_REASONER_PRESETS: Record<string, ReasonerPreset> = {
  /** Alibaba Model Studio (DashScope compatible-mode). `qwen-max` is the
   *  upstream alias for the current Qwen-Max generation; pin a version via
   *  LIGIS_QWEN_MODEL. The Singapore endpoint needs dashscope-intl — set
   *  LIGIS_QWEN_BASE_URL for keys issued there. */
  "qwen-max": {
    provider: "alibaba-dashscope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
    apiKeyEnv: ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"],
    baseUrlEnv: "LIGIS_QWEN_BASE_URL",
    modelEnv: "LIGIS_QWEN_MODEL",
  },
  /** Moonshot AI. The .ai endpoint is international; use
   *  LIGIS_KIMI_BASE_URL=https://api.moonshot.cn/v1 for .cn keys. */
  kimi: {
    provider: "moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-latest",
    apiKeyEnv: ["MOONSHOT_API_KEY"],
    baseUrlEnv: "LIGIS_KIMI_BASE_URL",
    modelEnv: "LIGIS_KIMI_MODEL",
  },
  /** Any other OpenAI-compatible provider; all three fields come from env. */
  "openai-compat": {
    provider: "openai-compat",
    apiKeyEnv: ["OPENAI_COMPAT_API_KEY"],
    baseUrlEnv: "OPENAI_COMPAT_BASE_URL",
    modelEnv: "OPENAI_COMPAT_MODEL",
  },
};

/**
 * Build a preset reasoner from environment variables. Returns null when the
 * preset isn't configured (missing key/url/model) — callers decide whether
 * that's a skip or an error.
 */
export function reasonerFromPreset(
  name: string,
  env: EnvLike = process.env,
): OpenAICompatReasoner | null {
  const preset = REMOTE_REASONER_PRESETS[name];
  if (!preset) return null;
  const apiKey = preset.apiKeyEnv.map((key) => env[key]?.trim()).find((v) => v);
  const baseUrl =
    (preset.baseUrlEnv ? env[preset.baseUrlEnv]?.trim() : undefined) ??
    preset.baseUrl;
  const model =
    (preset.modelEnv ? env[preset.modelEnv]?.trim() : undefined) ??
    preset.model;
  if (!apiKey || !baseUrl || !model) return null;
  const timeout = Number(env.LIGIS_REASONER_TIMEOUT_MS);
  return new OpenAICompatReasoner({
    baseUrl,
    apiKey,
    model,
    provider: preset.provider,
    timeoutMs: timeout > 0 ? timeout : undefined,
  });
}
