/**
 * Reasoner selection — parse a spec like `"qwen-max,zerog,local"` into a
 * `Reasoner` (single entry) or `ChainReasoner` (ordered fallback).
 *
 * Every call site that runs the Trust Steward resolves its reasoner through
 * here so `LIGIS_REASONER_CHAIN` behaves identically in the CLI, the MCP
 * server, and the web steward. Provider factories that return null (missing
 * credentials) are skipped; unknown names are an error, never a silent no-op.
 */
import { ChainReasoner } from "./chain-reasoner.js";
import {
  REMOTE_REASONER_PRESETS,
  reasonerFromPreset,
  type EnvLike,
} from "./openai-compat-reasoner.js";
import type { Reasoner } from "./reasoner.js";

/**
 * Returns the reasoner, or null when the provider isn't configured (e.g. its
 * API key env var is unset). A throwing factory is treated as null.
 */
export type ReasonerFactory = () => Reasoner | null;

export type ReasonerRegistry = Record<string, ReasonerFactory>;

/** Friendly spellings that collapse onto a canonical name. */
const REASONER_ALIASES: Record<string, string> = {
  "0g": "zerog",
  "0g-compute": "zerog",
  qwen: "qwen-max",
  "qwen3-max": "qwen-max",
  "qwen-3.8-max": "qwen-max",
  qwen38max: "qwen-max",
  moonshot: "kimi",
  "moonshot-ai": "kimi",
  openai: "openai-compat",
};

/** Today's behavior when nothing is configured: 0G, then local keywords. */
export const DEFAULT_REASONER_CHAIN = "zerog,local";

/**
 * `LIGIS_REASONER_CHAIN` (comma list, ordered fallback) wins over
 * `LIGIS_REASONER` (single name); neither set means the default chain.
 */
export function reasonerSpecFromEnv(env: EnvLike = process.env): string {
  return (
    env.LIGIS_REASONER_CHAIN?.trim() ||
    env.LIGIS_REASONER?.trim() ||
    DEFAULT_REASONER_CHAIN
  );
}

/** Parse "qwen, 0G ,local" → ["qwen-max", "zerog", "local"], aliases resolved. */
export function parseReasonerSpec(spec: string): string[] {
  return spec
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((s) => REASONER_ALIASES[s] ?? s);
}

/** Names that resolve — presets plus whatever the caller registered. */
export function availableReasonerNames(extra: ReasonerRegistry = {}): string[] {
  return [
    ...new Set([
      ...Object.keys(REMOTE_REASONER_PRESETS),
      ...Object.keys(extra),
    ]),
  ].sort();
}

export interface ResolveReasonerOptions {
  env?: EnvLike;
  /** Called for each configured-but-unavailable entry that gets skipped. */
  onSkip?: (name: string) => void;
  /** Forwarded to the ChainReasoner when the chain has more than one entry. */
  onFallback?: (name: string, error: unknown) => void;
}

/**
 * Resolve a spec to a reasoner.
 *
 * - Unknown name → throws (never silently ignored).
 * - Factory/preset returns null → skipped via onSkip.
 * - One resolved entry → that reasoner directly.
 * - Several → ChainReasoner in spec order.
 * - None resolved → throws naming the spec and the credentials it needs.
 */
export function resolveReasonerChain(
  spec: string,
  extra: ReasonerRegistry = {},
  opts: ResolveReasonerOptions = {},
): Reasoner {
  const env = opts.env ?? process.env;
  const names = parseReasonerSpec(spec);
  if (names.length === 0) {
    throw new Error("empty reasoner spec");
  }

  const reasoners: Reasoner[] = [];
  const resolvedNames: string[] = [];

  for (const name of names) {
    let reasoner: Reasoner | null;
    const factory = extra[name];
    if (factory) {
      try {
        reasoner = factory();
      } catch {
        reasoner = null;
      }
    } else if (name in REMOTE_REASONER_PRESETS) {
      reasoner = reasonerFromPreset(name, env);
    } else {
      throw new Error(
        `unknown reasoner '${name}' (available: ${availableReasonerNames(extra).join(", ")})`,
      );
    }
    if (!reasoner) {
      opts.onSkip?.(name);
      continue;
    }
    reasoners.push(reasoner);
    resolvedNames.push(name);
  }

  if (reasoners.length === 0) {
    throw new Error(
      `no configured reasoner in chain '${spec}' — set the provider's credentials ` +
        `(e.g. ZEROG_PRIVATE_KEY for zerog, DASHSCOPE_API_KEY for qwen-max, MOONSHOT_API_KEY for kimi)`,
    );
  }
  if (reasoners.length === 1) {
    return reasoners[0]!;
  }
  return new ChainReasoner(reasoners, {
    names: resolvedNames,
    onFallback: opts.onFallback,
  });
}
