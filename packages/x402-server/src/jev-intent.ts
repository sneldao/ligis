/**
 * Jev Intent Evaluation — optional pre-settlement signal for the Trust Gate.
 *
 * Jev (TypeSafe's "System One" model) takes a state plus typed questions and
 * returns structured answers — Choice, Score, Noul — with probabilities and
 * confidence. No text generation, no parsing. Every question in one request
 * is evaluated in parallel against the same state (~100ms typical), so we ask
 * all four trust questions in a single call and compose the verdict in code:
 *
 *   scope                (Choice) — is this payment consistent with the capability?
 *   amount_plausibility  (Score)  — is the amount plausible for what it buys?
 *   payee_consistency    (Noul)   — does the payee match the service collecting?
 *   request_normality    (Noul)   — is this a normal, expected request?
 *
 * Policy questions with computable answers (e.g. "is this payment redundant
 * given what the subject already holds?") stay in code — Jev is for judgments
 * a `=IF()` cannot make.
 *
 * Design rules (non-negotiable):
 *   - The credential check is the source of truth. Jev is a signal, not a gate.
 *   - Fail open. Missing key, timeout, non-200, or malformed response →
 *     verdict SKIPPED and the gate flow proceeds unchanged.
 *   - Cost: the AI Gateway reports billed USD in `provider_metadata.gateway.cost`
 *     and that is used directly when present; otherwise cost is derived from
 *     `usage.input_tokens` at Jev's published input price ($0.042/MTok),
 *     output tokens free.
 *
 * Two interchangeable routes with identical wire shapes (Choice/Score/Noul,
 * confidence, input_tokens) — only base URL, credential, and model slug
 * differ (see loadJevConfig):
 *
 *   gateway (default): POST https://ai-gateway.vercel.sh/typesafe/v1/systemone
 *     auth AI_GATEWAY_API_KEY, model `typesafe-ai/jev`. Free promo through
 *     2026-09-25 — after that, flip to direct or keep the gateway with billing.
 *   direct: POST https://api.typesafe.ai/v1/systemone
 *     auth TYPESAFE_API_KEY, model `jev-latest`.
 */

/** Input price published by TypeSafe at launch: $0.042 per million tokens. */
const JEV_INPUT_USD_PER_MTOK = 0.042;

export type JevVerdict = "GO" | "STOP" | "SKIPPED";

/** Context about the payment request being judged. */
export interface JevIntentInput {
  /** The agent's account identifier (Casper account-hash or EVM address). */
  subject: string;
  /** Capability the request targets, e.g. `data.premium`. */
  capability: string;
  /** Human description of what the capability grants. */
  capabilityDescription?: string;
  /** Gate price in smallest units (motes/wei) — what the gate asks for. */
  gatePriceSmallestUnit: string;
  /** Token symbol for the price, e.g. CSPR. */
  tokenSymbol?: string;
  /** Token decimals, so the state can carry a human-readable amount. */
  tokenDecimals?: string;
  /** The payee the gate advertises (normalized account string). */
  advertisedPayTo: string;
  /** Decoded X-PAYMENT authorization, when the agent already attached one. */
  payment?: {
    scheme?: string;
    amountSmallestUnit?: string;
    payTo?: string;
  };
}

export interface JevFlag {
  id: string;
  label: string;
  confidence: number;
}

export interface JevIntentResult {
  verdict: JevVerdict;
  /** 0..1. 0 when skipped; max flag confidence on STOP, mean Choice/Score confidence on GO. */
  confidence: number;
  flags: JevFlag[];
  /** Wall-clock time of the evaluation, including network. */
  latencyMs: number;
  /** Estimated USD cost of the call, from input token usage. */
  costUsd?: number;
  /** Versioned model id reported by the API (e.g. jev-1.13.0). */
  model?: string;
  /** Present only when verdict is SKIPPED — why the layer stood down. */
  skippedReason?: string;
  inputTokens?: number;
}

export interface JevConfig {
  enabled: boolean;
  /** Which upstream serves the request — same wire shapes, different URL/key. */
  transport: "gateway" | "direct";
  apiKey: string;
  apiUrl: string;
  model: string;
  /** Minimum flag confidence for a flag to fire. */
  minConfidence: number;
  timeoutMs: number;
  /** When true, the server may refuse (403) on a confident STOP. Default off. */
  enforce: boolean;
}

const GATEWAY_API_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const GATEWAY_MODEL = "typesafe-ai/jev";
const DIRECT_API_URL = "https://api.typesafe.ai/v1/systemone";
const DIRECT_MODEL = "jev-latest";

/**
 * Transport resolution:
 *   LIGIS_JEV_TRANSPORT=gateway|direct|auto (default auto).
 *   auto → gateway when AI_GATEWAY_API_KEY is set (the free route), else
 *   direct when TYPESAFE_API_KEY is set, else gateway so the skip reason
 *   names the credential we actually want.
 * LIGIS_JEV_API_KEY overrides the credential for whichever route is active;
 * LIGIS_JEV_API_URL / LIGIS_JEV_MODEL still override URL and model slug.
 */
export function loadJevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const requested = (env.LIGIS_JEV_TRANSPORT ?? "auto").toLowerCase();
  const hasGatewayKey = Boolean(env.AI_GATEWAY_API_KEY);
  const hasDirectKey = Boolean(env.TYPESAFE_API_KEY);
  const transport: "gateway" | "direct" =
    requested === "gateway" || requested === "direct"
      ? requested
      : hasGatewayKey
        ? "gateway"
        : hasDirectKey
          ? "direct"
          : "gateway";
  const apiKey =
    env.LIGIS_JEV_API_KEY ??
    (transport === "gateway" ? env.AI_GATEWAY_API_KEY : env.TYPESAFE_API_KEY) ??
    "";
  return {
    enabled: env.LIGIS_JEV_ENABLED === "1",
    transport,
    apiKey,
    apiUrl:
      env.LIGIS_JEV_API_URL ??
      (transport === "gateway" ? GATEWAY_API_URL : DIRECT_API_URL),
    model:
      env.LIGIS_JEV_MODEL ??
      (transport === "gateway" ? GATEWAY_MODEL : DIRECT_MODEL),
    minConfidence: Number(env.LIGIS_JEV_MIN_CONFIDENCE ?? "0.6"),
    // Jev answers in 70–500ms; the headroom covers event-loop contention from
    // the gate's synchronous casper-client reads on cold requests.
    timeoutMs: Number(env.LIGIS_JEV_TIMEOUT_MS ?? "4000"),
    enforce: env.LIGIS_JEV_ENFORCE === "1",
  };
}

// ---------- Jev wire types (POST /v1/systemone) ----------

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevNoulAnswer {
  type: "noul";
  noul: number;
}
type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer | undefined>;
  usage?: { input_tokens?: number; output_tokens?: number };
  /** AI Gateway routes report billed cost here (TypeSafe-compatible shape). */
  provider_metadata?: { gateway?: { cost?: string } };
  providerMetadata?: { gateway?: { cost?: string } };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------- State + questions ----------

/** The state Jev sees. Keep it minimal — context rot degrades calibration.
 *
 * Enrichment doctrine: facts code can compute are STATED (code_checks),
 * facts only the operator knows are DECLARED (advertised price, capability
 * class), and judgments that need meaning are ASKED (the four questions).
 * Amounts are always paired with a human-readable form — raw smallest units
 * are meaningless to the model and make it hedge.
 */
function buildState(input: JevIntentInput): Record<string, unknown> {
  const decimals = /^\d+$/.test(input.tokenDecimals ?? "")
    ? Number(input.tokenDecimals)
    : 9;
  return {
    service: {
      name: "Ligis Trust Gate",
      description:
        "A credential-gated x402 resource server. Agents pay micropayments for premium data; the gate checks each caller's credential on-chain separately from this payment.",
      operator_note:
        "Judge the payment intent on its own merits — credential status is verified independently by the gate and is not visible here.",
    },
    capability: {
      name: input.capability,
      description: input.capabilityDescription ?? "",
      class:
        "single-request access to a premium data feed (one payment, one response — not a subscription)",
    },
    subject: input.subject,
    gate_price: {
      amount_smallest_unit: input.gatePriceSmallestUnit,
      human_readable: formatAmount(
        input.gatePriceSmallestUnit,
        decimals,
        input.tokenSymbol ?? "",
      ),
      token: input.tokenSymbol ?? "",
      decimals,
      set_by:
        "the gate operator — the advertised standard price for this capability",
    },
    advertised_pay_to: input.advertisedPayTo,
    code_checks: {
      note: "Computed by the gate in code. Treat as authoritative facts about the payment's mechanics.",
      amount_matches_requested_price: amountsMatch(
        input.payment?.amountSmallestUnit,
        input.gatePriceSmallestUnit,
      ),
      payee_matches_advertised: sameAccount(
        input.payment?.payTo,
        input.advertisedPayTo,
      ),
    },
    payment: input.payment
      ? {
          scheme: input.payment.scheme,
          amount_smallest_unit: input.payment.amountSmallestUnit,
          human_readable: formatAmount(
            input.payment.amountSmallestUnit,
            decimals,
            input.tokenSymbol ?? "",
          ),
          pay_to: input.payment.payTo,
          flow_note:
            "standard x402 exact-scheme payment payload built from the gate's own 402 requirements",
        }
      : null,
  };
}

/** Numeric equality on smallest units; null when there is no payment to compare. */
function amountsMatch(paid: string | undefined, asked: string): boolean | null {
  if (paid === undefined) return null;
  if (/^\d+$/.test(paid) && /^\d+$/.test(asked)) {
    return BigInt(paid) === BigInt(asked);
  }
  return paid === asked;
}

/** Account equality across Casper/EVM address formattings; null without a payment. */
function sameAccount(a: string | undefined, b: string): boolean | null {
  if (a === undefined) return null;
  const norm = (s: string) =>
    s
      .trim()
      .replace(/^account-hash-/, "")
      .replace(/^0x/, "")
      .replace(/^0[01]/, "")
      .toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  if (/^[0-9a-f]{64}$/.test(na) && /^[0-9a-f]{64}$/.test(nb)) return na === nb;
  return a === b;
}

/** "1000000000" + 9 decimals + CSPR → "1.000000000 CSPR". */
function formatAmount(
  smallestUnit: string | undefined,
  decimals: number,
  symbol: string,
): string | undefined {
  if (!smallestUnit || !/^\d+$/.test(smallestUnit)) return undefined;
  try {
    const amount = BigInt(smallestUnit);
    if (decimals <= 0) return symbol ? `${amount} ${symbol}` : `${amount}`;
    const base = 10n ** BigInt(decimals);
    const whole = amount / base;
    const frac = (amount % base).toString().padStart(decimals, "0");
    return symbol ? `${whole}.${frac} ${symbol}` : `${whole}.${frac}`;
  } catch {
    return undefined;
  }
}

function buildQuestions(): Record<string, unknown> {
  return {
    scope: {
      type: "choice",
      instructions:
        "Does the intent of `payment` (or, when `payment` is null, this price request) match the intended use of capability `capability.name` (`capability.description`) at `service`? `code_checks` states how the payment's mechanics compare with the gate's advertised terms.",
      criteria: {
        consistent:
          "The payment is exactly for what this capability grants, on the gate's advertised terms.",
        inconsistent:
          "The payment's amount, target, or framing does not match what this capability grants on the gate's advertised terms.",
        unclear: "Not enough information to judge.",
      },
    },
    amount_plausibility: {
      type: "score",
      instructions:
        "How plausible is the amount being paid for access described by `capability` — `payment.human_readable` (smallest units in `payment.amount_smallest_unit`) when `payment` is present, else `gate_price.human_readable` (smallest units in `gate_price.amount_smallest_unit`)? Whether the offered amount matches the gate's ask is already stated in `code_checks`; judge fair value here.",
      criteria: [
        "Implausible — far below or far above fair value for this capability",
        "Questionable — off by a factor but not absurd",
        "Plausible — within the normal range for this kind of access",
      ],
    },
    payee_consistency: {
      type: "noul",
      instructions:
        "The payment target (`payment.pay_to` when present, else `advertised_pay_to`) is consistent with `advertised_pay_to` — the address this gate advertises as its collector. `code_checks.payee_matches_advertised` states the mechanical comparison.",
      criteria: {
        yes: "Same account, or trivially equivalent formatting of the same account.",
        no: "A different account than the one the gate advertises.",
      },
    },
    request_normality: {
      type: "noul",
      instructions:
        "Taken together (`payment`, `gate_price`, `capability`, `code_checks`), this request is a normal, expected payment for this service.",
    },
  };
}

// ---------- Verdict composition ----------

const FLAG_MIN_CONFIDENCE_FALLBACK = 0.6;

function composeVerdict(
  data: JevResponse,
  input: JevIntentInput,
  latencyMs: number,
  config: JevConfig,
): JevIntentResult {
  const answers = data.answers ?? {};
  const minConf = config.minConfidence ?? FLAG_MIN_CONFIDENCE_FALLBACK;
  const flags: JevFlag[] = [];

  const scope = answers.scope;
  if (
    scope?.type === "choice" &&
    scope.choice === "inconsistent" &&
    scope.confidence >= minConf
  ) {
    flags.push({
      id: "scope-mismatch",
      label: "payment intent inconsistent with capability scope",
      confidence: scope.confidence,
    });
  }

  const amount = answers.amount_plausibility;
  if (
    amount?.type === "score" &&
    amount.score <= 0.5 &&
    amount.confidence >= minConf
  ) {
    flags.push({
      id: "amount-mismatch",
      label: amountFlagLabel(input),
      confidence: amount.confidence,
    });
  }

  const payee = answers.payee_consistency;
  if (payee?.type === "noul" && payee.noul <= 0.3) {
    flags.push({
      id: "payee-mismatch",
      label: "payment target differs from the advertised payee",
      confidence: 1 - payee.noul,
    });
  }

  const normality = answers.request_normality;
  if (normality?.type === "noul" && normality.noul <= 0.3) {
    flags.push({
      id: "abnormal-pattern",
      label: "request pattern reads as abnormal for this service",
      confidence: 1 - normality.noul,
    });
  }

  // Prefer the gateway's billed cost (authoritative, handles free-promo zero
  // and surcharges); fall back to input tokens at the published input price.
  const gatewayCost =
    data.provider_metadata?.gateway?.cost ??
    data.providerMetadata?.gateway?.cost;
  const parsedGatewayCost =
    gatewayCost !== undefined && gatewayCost !== "" ? Number(gatewayCost) : NaN;
  const costUsd = Number.isFinite(parsedGatewayCost)
    ? parsedGatewayCost
    : typeof data.usage?.input_tokens === "number"
      ? (data.usage.input_tokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000
      : undefined;

  if (flags.length > 0) {
    const confidence = Math.max(...flags.map((f) => f.confidence));
    return {
      verdict: "STOP",
      confidence,
      flags,
      latencyMs,
      costUsd,
      model: data.model,
      inputTokens: data.usage?.input_tokens,
    };
  }

  // GO confidence: mean of the two confidence-carrying answers, falling back
  // to 0.5 when the API omitted them (should not happen).
  const confidences: number[] = [];
  if (scope?.type === "choice") confidences.push(scope.confidence);
  if (amount?.type === "score") confidences.push(amount.confidence);
  const confidence =
    confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0.5;

  return {
    verdict: "GO",
    confidence,
    flags: [],
    latencyMs,
    costUsd,
    model: data.model,
    inputTokens: data.usage?.input_tokens,
  };
}

/** Direction-aware label for the amount flag: underpay, overpay, or generic. */
function amountFlagLabel(input: JevIntentInput): string {
  const paid = input.payment?.amountSmallestUnit;
  const asked = input.gatePriceSmallestUnit;
  if (paid && asked && /^\d+$/.test(paid) && /^\d+$/.test(asked)) {
    if (BigInt(paid) < BigInt(asked)) {
      return "underpayment — amount far below the gate price for this capability";
    }
    if (BigInt(paid) > BigInt(asked)) {
      return "overpayment — amount far above the gate price for this capability";
    }
  }
  return "amount implausible for this capability";
}

function skipped(reason: string, t0: number): JevIntentResult {
  return {
    verdict: "SKIPPED",
    confidence: 0,
    flags: [],
    latencyMs: Date.now() - t0,
    skippedReason: reason,
  };
}

// ---------- Entry point ----------

export async function evaluatePaymentIntent(
  input: JevIntentInput,
  config: JevConfig,
  fetchImpl: FetchLike = fetch,
): Promise<JevIntentResult> {
  const t0 = Date.now();

  if (!config.enabled) return skipped("layer disabled", t0);
  if (!config.apiKey)
    return skipped(
      config.transport === "gateway"
        ? "missing AI_GATEWAY_API_KEY"
        : "missing TYPESAFE_API_KEY",
      t0,
    );

  let res: Response;
  try {
    res = await fetchImpl(config.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        state: buildState(input),
        questions: buildQuestions(),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    return skipped(
      `jev unreachable: ${err instanceof Error ? err.message : String(err)}`,
      t0,
    );
  }

  if (!res.ok) {
    return skipped(`jev HTTP ${res.status}`, t0);
  }

  let data: JevResponse;
  try {
    data = (await res.json()) as JevResponse;
  } catch {
    return skipped("jev returned malformed JSON", t0);
  }

  if (!data.answers || typeof data.answers !== "object") {
    return skipped("jev response missing answers", t0);
  }

  return composeVerdict(data, input, Date.now() - t0, config);
}

// ---------- Response headers ----------

/** Header names use the X-Jev-* prefix so a curl -i shows the verdict at a glance. */
export function jevHeaders(r: JevIntentResult): Record<string, string> {
  const headers: Record<string, string> = {
    "x-jev-verdict": r.verdict,
    "x-jev-confidence": r.confidence.toFixed(3),
    "x-jev-latency-ms": String(r.latencyMs),
    "x-jev-model": r.model ?? "",
    "x-jev-flags": r.flags.map((f) => f.id).join(","),
  };
  if (r.costUsd !== undefined) {
    headers["x-jev-cost-usd"] = r.costUsd.toFixed(8);
  }
  if (r.skippedReason) {
    headers["x-jev-skipped-reason"] = r.skippedReason;
  }
  return headers;
}

/** Public subset embedded in JSON bodies and the /verdicts feed. */
export function jevSummary(r: JevIntentResult) {
  return {
    verdict: r.verdict,
    confidence: Number(r.confidence.toFixed(3)),
    flags: r.flags.map((f) => ({
      id: f.id,
      confidence: Number(f.confidence.toFixed(3)),
    })),
    latencyMs: r.latencyMs,
    ...(r.costUsd !== undefined
      ? { costUsd: Number(r.costUsd.toFixed(8)) }
      : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.skippedReason ? { skippedReason: r.skippedReason } : {}),
  };
}
