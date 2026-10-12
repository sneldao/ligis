/**
 * `decide()` — the Ligis pre-payment decision service.
 *
 * Spec: `docs/decide-api.md`. One code path used by `/gate` (POST /api/gate)
 * and `/arena` (with `pageText` set). Returns a `Decision` built from four
 * signals (right payee, right amount, in scope, verified payee), evaluated
 * concurrently. Composition rule: STOP > UNKNOWN > GO; UNKNOWN is a valid,
 * surfaced answer, never a silent GO.
 *
 * Server-only by transitive import (`resolveSubject` enforces it).
 */
import {
  evaluatePaymentIntent,
  loadJevConfig,
  type JevConfig,
  type JevIntentInput,
  type JevIntentResult,
} from "@ligis/core";
// Type-only import so tests don't trigger the server-only guard inside
// `@/lib/resolve` (which loads `server-only` at the top). At runtime,
// `SubjectResolution` is erased; production wires `resolveSubject` via
// `DecideDeps`.
import type { SubjectResolution } from "@/lib/resolve";

// ─── public types (mirror docs/decide-api.md) ──────────────────────────

export type VerdictStatus = "GO" | "STOP" | "SKIPPED";

export type Signal =
  | {
      id: "right-payee";
      status: VerdictStatus;
      confidence: number;
      reason?: string;
      latencyMs?: number;
    }
  | {
      id: "right-amount";
      status: VerdictStatus;
      confidence: number;
      reason?: string;
      latencyMs?: number;
    }
  | {
      id: "in-scope";
      status: VerdictStatus;
      confidence: number;
      reason?: string;
      latencyMs?: number;
    }
  | {
      id: "verified-payee";
      status: VerdictStatus;
      confidence: number;
      chain?: string;
      capabilityHash?: string;
      credentialId?: string;
      expiresAt?: string;
      revoked?: boolean;
      issuer?: string;
      reason?: string;
      latencyMs?: number;
    };

export type PaymentIntent = {
  /** Payee address or stable known-vendor id. The credential subject. */
  payee: string;
  /** Amount in USD; Jev reads it as human-readable. */
  amountUsd: number;
  /** What the agent was hired to do. Forwarded to Jev + the operator UI. */
  purpose: string;
  /** Optional mandate from the agent's operator. Not enforced in 3a. */
  mandate?: {
    payees?: string[];
    maxUsd?: number;
    scope?: string;
  };
  /** Capability the payment targets (e.g. `data.premium`). Required to
      resolve `verified-payee`. When omitted, that signal goes SKIPPED. */
  capability?: string;
  /** Optional: page text from the agent's open doc (Arena demo). Triggers
      a conservative in-process regex judge; full Arena LLM judge lives in
      `judgePayment()` and is unchanged. */
  pageText?: string;
};

export type Decision = {
  /** Aggregate verdict: STOP wins, then GO, then UNKNOWN. */
  verdict: "GO" | "STOP" | "UNKNOWN";
  /** Full signal stack, in canonical order. */
  signals: Signal[];
  /** Wall-clock latency of the parallel signal evaluations. */
  latencyMs: number;
  /** Estimated Jev cost (USD) when available. */
  costUsd?: number;
  /** Each upstream that ran, e.g. `jev go jev-1.13.0 (direct, 235ms)`,
      `pharos-atlantic credential`. */
  provenance: string[];
};

/**
 * Dependency injection for `decide()`. The `resolveSubject` and
 * `evaluateIntent` slots are required — production wires them at the
 * route layer (`web/app/api/gate/route.ts`), and tests wire stubs.
 *
 * Required rather than defaulted so `decide.ts` doesn't import
 * `@/lib/resolve` (which is `server-only`); the runtime chain-agnostic
 * credential read stays in the route, this module only orchestrates.
 */
export type DecideDeps = {
  evaluateIntent?: (
    input: JevIntentInput,
    config: JevConfig,
  ) => Promise<JevIntentResult>;
  resolveSubject: (
    payee: string,
    capability: string,
  ) => Promise<SubjectResolution>;
  env?: NodeJS.ProcessEnv;
  /** Pluggable LLM judge for prompt-injection on `pageText`. */
  judgePageText?: (text: string) => {
    status: VerdictStatus;
    confidence: number;
    reason?: string;
  };
};

// ─── constants ──────────────────────────────────────────────────────────

const SIGNAL_ORDER: ReadonlyArray<Signal["id"]> = [
  "right-payee",
  "right-amount",
  "in-scope",
  "verified-payee",
] as const;

// Jev flag id → Signal id mapping. `scope-mismatch` and `abnormal-pattern`
// both ride on the single `in-scope` signal — the public surface stays at
// four signals (per docs/decide-api.md "R1: Jev packs 4 questions").
const JEV_FLAG_TO_SIGNAL: Readonly<Record<string, Signal["id"]>> = {
  "payee-mismatch": "right-payee",
  "amount-mismatch": "right-amount",
  "scope-mismatch": "in-scope",
  "abnormal-pattern": "in-scope",
};

// Conservative in-process regex fallback for the prompt-injection demo path.
// Arena's full-featured judge is `judgePayment()` (still used by /arena);
// `decide()` stays self-contained for the live gate without a Vultr key.
const INJECTION_TRIGGERS: ReadonlyArray<RegExp> = [
  /ignore (all )?(previous|prior) instructions/i,
  /transfer (all )?funds? (to|into) (0x|account-hash-)/i,
  /send (everything|all|the whole balance) to/i,
  /(urgent|immediate) (transfer|wire|payment) to/i,
];

// Phase 3a assumption: amountUsd is USD with 6 decimals (USDC). Phase 3b
// should extend PaymentIntent with `tokenSymbol`/`tokenDecimals` so the gate
// can serve CSPR (9 decimals), ETH (18), etc. without re-deriving here.
const ASSUMED_USDC_DECIMALS = 6;

function defaultJudgePageText(text: string): {
  status: VerdictStatus;
  confidence: number;
  reason?: string;
} {
  for (const re of INJECTION_TRIGGERS) {
    if (re.test(text)) {
      return {
        status: "STOP",
        confidence: 0.95,
        reason: "page text contained an obvious prompt-injection pattern",
      };
    }
  }
  return {
    status: "SKIPPED",
    confidence: 0,
    reason:
      "no in-process triggers fired; full LLM judge lives in judgePayment()",
  };
}

// ─── main entry ─────────────────────────────────────────────────────────

export async function decide(
  intent: PaymentIntent,
  deps: DecideDeps,
): Promise<Decision> {
  const t0 = Date.now();
  const env = deps.env ?? process.env;
  const config = loadJevConfig(env);
  const evaluate = deps.evaluateIntent ?? evaluatePaymentIntent;
  const resolve = deps.resolveSubject;
  const judge = deps.judgePageText ?? defaultJudgePageText;

  const smallestUnit = BigInt(
    Math.max(0, Math.round(intent.amountUsd * 10 ** ASSUMED_USDC_DECIMALS)),
  ).toString();

  const jevInput: JevIntentInput = {
    subject: intent.payee,
    capability: intent.capability ?? "payment",
    capabilityDescription: intent.purpose,
    gatePriceSmallestUnit: smallestUnit,
    tokenSymbol: "USDC",
    tokenDecimals: String(ASSUMED_USDC_DECIMALS),
    advertisedPayTo: intent.payee,
  };

  const [jevResult, credentialResult, pageJudgeResult] =
    await Promise.allSettled([
      config.enabled
        ? Promise.resolve().then(() => evaluate(jevInput, config))
        : Promise.resolve(makeSkippedJev("layer disabled")),
      intent.capability
        ? Promise.resolve().then(() =>
            resolve(intent.payee, intent.capability!),
          )
        : Promise.resolve({
            ok: false as const,
            error: "no capability supplied",
          } satisfies SubjectResolution),
      intent.pageText
        ? Promise.resolve().then(() => judge(intent.pageText!))
        : Promise.resolve(null),
    ]);

  const jev: JevIntentResult =
    jevResult.status === "fulfilled"
      ? jevResult.value
      : makeSkippedJev(
          jevResult.reason instanceof Error
            ? jevResult.reason.message
            : "intent layer threw",
        );

  const pageJudge =
    pageJudgeResult.status === "fulfilled" ? pageJudgeResult.value : null;

  const signals: Signal[] = SIGNAL_ORDER.map((id) =>
    buildSignal(id, jev, credentialResult, pageJudge),
  );

  const verdict = composeVerdict(signals);

  return {
    verdict,
    signals,
    latencyMs: Date.now() - t0,
    costUsd: jev.costUsd,
    provenance: buildProvenance(jev, credentialResult, pageJudge, config),
  };
}

// ─── signal builders ────────────────────────────────────────────────────

function buildSignal(
  id: Signal["id"],
  jev: JevIntentResult,
  credential: PromiseSettledResult<SubjectResolution>,
  inScopeFromPage: {
    status: VerdictStatus;
    confidence: number;
    reason?: string;
  } | null,
): Signal {
  if (id === "verified-payee") {
    return verifiedPayeeSignal(credential);
  }

  // Page-text override beats Jev on the in-scope signal. SKIPPED on
  // page-text means "we tried but the in-process judge had nothing to
  // say" → defer to Jev's verdict on `in-scope`.
  if (id === "in-scope" && inScopeFromPage) {
    if (inScopeFromPage.status === "STOP") {
      return baseSignal(
        id,
        "STOP",
        inScopeFromPage.confidence,
        inScopeFromPage.reason,
        jev.latencyMs || undefined,
      );
    }
    if (inScopeFromPage.status === "GO") {
      return baseSignal(
        id,
        "GO",
        inScopeFromPage.confidence,
        inScopeFromPage.reason,
        jev.latencyMs || undefined,
      );
    }
  }

  return jevSignalFor(jev, id);
}

function jevSignalFor(jev: JevIntentResult, signalId: Signal["id"]): Signal {
  if (jev.verdict === "SKIPPED") {
    return baseSignal(
      signalId,
      "SKIPPED",
      0,
      jev.skippedReason ?? "jev skipped",
      undefined,
    );
  }
  const flag = jev.flags.find((f) => JEV_FLAG_TO_SIGNAL[f.id] === signalId);
  if (flag) {
    return baseSignal(
      signalId,
      "STOP",
      flag.confidence,
      flag.label,
      jev.latencyMs || undefined,
    );
  }
  return baseSignal(
    signalId,
    "GO",
    jev.confidence,
    undefined,
    jev.latencyMs || undefined,
  );
}

function verifiedPayeeSignal(
  result: PromiseSettledResult<SubjectResolution>,
): Signal {
  if (result.status === "rejected") {
    return baseSignal(
      "verified-payee",
      "SKIPPED",
      0,
      result.reason instanceof Error
        ? result.reason.message
        : "credential layer threw",
      undefined,
    );
  }
  const r = result.value;
  if (!r.ok) {
    return baseSignal("verified-payee", "SKIPPED", 0, r.error, undefined);
  }
  const primary = r.primary;
  const out = primary.outcome;
  if (!out.ok) {
    return baseSignal("verified-payee", "SKIPPED", 0, out.error, undefined);
  }
  const verified = out.capable && !out.revoked;
  const status: VerdictStatus = verified ? "GO" : "STOP";
  const expiresIso =
    out.expiresAt && out.expiresAt !== 0n
      ? new Date(Number(out.expiresAt) * 1000).toISOString()
      : undefined;
  return {
    id: "verified-payee",
    status,
    confidence: verified ? 1 : out.capable ? 0.95 : 0.5,
    chain: primary.chain.id,
    capabilityHash: out.capabilityHash,
    issuer: out.issuer ?? undefined,
    expiresAt: expiresIso,
    revoked: out.revoked,
    reason: out.revoked
      ? "credential has been revoked"
      : out.capable
        ? `credential held on ${primary.chain.name}`
        : `no un-revoked credential on ${primary.chain.name}`,
  };
}

function baseSignal(
  id: Signal["id"],
  status: VerdictStatus,
  confidence: number,
  reason: string | undefined,
  latencyMs: number | undefined,
): Signal {
  switch (id) {
    case "right-payee":
      return { id, status, confidence, reason, latencyMs };
    case "right-amount":
      return { id, status, confidence, reason, latencyMs };
    case "in-scope":
      return { id, status, confidence, reason, latencyMs };
    case "verified-payee":
      return { id, status, confidence, reason, latencyMs };
  }
}

function composeVerdict(signals: Signal[]): Decision["verdict"] {
  if (signals.some((s) => s.status === "STOP")) return "STOP";
  if (signals.some((s) => s.status === "GO")) return "GO";
  return "UNKNOWN";
}

function buildProvenance(
  jev: JevIntentResult,
  credential: PromiseSettledResult<SubjectResolution>,
  pageJudge: {
    status: VerdictStatus;
    confidence: number;
    reason?: string;
  } | null,
  config: ReturnType<typeof loadJevConfig>,
): string[] {
  const lines: string[] = [];
  const jevDescriptor = `jev ${jev.verdict.toLowerCase()}${jev.model ? ` ${jev.model}` : ""} (${config.transport}, ${jev.latencyMs}ms${jev.skippedReason ? `, ${jev.skippedReason}` : ""})`;
  lines.push(jevDescriptor);

  if (pageJudge) {
    if (pageJudge.status === "SKIPPED") {
      lines.push("page-text skipped");
    } else {
      lines.push(
        `page-text ${pageJudge.status.toLowerCase()} ${pageJudge.confidence.toFixed(2)}${pageJudge.reason ? ` (${pageJudge.reason})` : ""}`,
      );
    }
  }

  if (credential.status === "fulfilled") {
    const r = credential.value;
    if (r.ok) {
      const out = r.primary.outcome;
      lines.push(
        out.ok
          ? `verified-payee credential on ${r.primary.chain.name}`
          : `verified-payee skipped on ${r.primary.chain.name} (${out.error})`,
      );
    } else {
      lines.push(`verified-payee skipped (${r.error})`);
    }
  } else {
    lines.push(`verified-payee threw`);
  }

  return lines;
}

// ─── internal helpers ───────────────────────────────────────────────────

function makeSkippedJev(reason: string): JevIntentResult {
  return {
    verdict: "SKIPPED",
    confidence: 0,
    flags: [],
    latencyMs: 0,
    skippedReason: reason,
  };
}
