/**
 * Jev Intent Evaluation — the typed-reflex layer for any Ligis gate.
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
 *     verdict SKIPPED and the calling flow proceeds unchanged.
 *   - Cost: the AI Gateway reports billed USD in `provider_metadata.gateway.cost`
 *     and that is used directly when present; otherwise cost is derived from
 *     `usage.input_tokens` at Jev's published input price ($0.042/MTok),
 *     output tokens free.
 *
 * Three routes, resolved in order — the primary from LIGIS_JEV_TRANSPORT,
 * then any fallbacks from LIGIS_JEV_FALLBACK (see loadJevConfig):
 *
 *   gateway (default): POST https://ai-gateway.vercel.sh/typesafe/v1/systemone
 *     auth AI_GATEWAY_API_KEY, model `typesafe-ai/jev`. Free promo through
 *     2026-09-25 — after that, flip to direct or keep the gateway with billing.
 *   direct: POST https://api.typesafe.ai/v1/systemone
 *     auth TYPESAFE_API_KEY, model `jev-latest`.
 *   novita-vl: POST https://api.novita.ai/v3/autotrust/v1/decide
 *     auth NOVITA_API_KEY (or LIGIS_JEV_NOVITA_API_KEY), model
 *     `autotrust/jev-27b-vl`. AutoTrust JEV-27B-VL — free ~14-day partner
 *     promo, then metered (input tokens only). Different protocol: ONE
 *     question per request, so this route fans the four trust questions out
 *     to four parallel requests and synthesizes the same Choice/Score/Noul
 *     answers before verdict composition.
 *
 * The chain: each route is tried in order under ONE overall deadline
 * (config.timeoutMs is the budget for the whole chain, not per route). A
 * route fails → the next is tried; all fail → SKIPPED. HTTP 401/403/429
 * (Novita's NOT_ENOUGH_BALANCE family included) arms a 60s per-route
 * cooldown so a dead promo or bad key costs zero network calls.
 *
 * Consumers: the x402 Trust Gate (packages/x402-server, judges /premium
 * payment requests) and the CROO adapter's `ligis.gate` service
 * (packages/croo-adapter, sells the same pre-flight read on the Agent Store).
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
  /** Name of the gating service, shown to Jev as `service.name`. */
  serviceName?: string;
  /** Description of the gating service, shown to Jev as `service.description`. */
  serviceDescription?: string;
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
  /** Route that produced the verdict (set on GO/STOP, never on SKIPPED). */
  route?: JevRouteName;
  /** Per-route outcomes in order, present only when >1 route was configured. */
  attempts?: { route: JevRouteName; outcome: string }[];
}

export type JevRouteName = "gateway" | "direct" | "novita-vl";

/** A single upstream route in the evaluation chain. */
export interface JevRoute {
  name: JevRouteName;
  /** systemone = TypeSafe multi-question; novita-decide = one question per request. */
  protocol: "systemone" | "novita-decide";
  apiKey: string;
  apiUrl: string;
  model: string;
}

export interface JevConfig {
  enabled: boolean;
  /** Primary upstream — the first route tried in the chain. */
  transport: JevRouteName;
  apiKey: string;
  apiUrl: string;
  model: string;
  /** Minimum flag confidence for a flag to fire. */
  minConfidence: number;
  /**
   * Overall deadline for the ENTIRE route chain (primary + fallbacks),
   * not per route.
   */
  timeoutMs: number;
  /** When true, the server may refuse (403) on a confident STOP. Default off. */
  enforce: boolean;
  /** Fallback routes, tried in order after the primary. Built from LIGIS_JEV_FALLBACK. */
  fallbacks?: JevRoute[];
  /**
   * Novita input price ($/MTok), from LIGIS_JEV_NOVITA_INPUT_USD_PER_MTOK.
   * Unset → novita-vl costUsd is undefined (Novita publishes no unit price;
   * never apply TypeSafe's JEV_INPUT_USD_PER_MTOK to it).
   */
  novitaInputUsdPerMTok?: number;
}

const GATEWAY_API_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const GATEWAY_MODEL = "typesafe-ai/jev";
const DIRECT_API_URL = "https://api.typesafe.ai/v1/systemone";
const DIRECT_MODEL = "jev-latest";
const NOVITA_API_URL = "https://api.novita.ai/v3/autotrust/v1/decide";
const NOVITA_MODEL = "autotrust/jev-27b-vl";

const ROUTE_NAMES: ReadonlySet<string> = new Set([
  "gateway",
  "direct",
  "novita-vl",
]);

/** The novita-vl route's credential + endpoint + slug from the env. */
function novitaRouteFromEnv(env: NodeJS.ProcessEnv): JevRoute {
  return {
    name: "novita-vl",
    protocol: "novita-decide",
    apiKey: env.LIGIS_JEV_NOVITA_API_KEY ?? env.NOVITA_API_KEY ?? "",
    apiUrl: env.LIGIS_JEV_NOVITA_API_URL ?? NOVITA_API_URL,
    model: env.LIGIS_JEV_NOVITA_MODEL ?? NOVITA_MODEL,
  };
}

/** A route description from its own route-specific env vars, or null if unknown. */
function routeFromName(name: string, env: NodeJS.ProcessEnv): JevRoute | null {
  switch (name) {
    case "gateway":
      return {
        name: "gateway",
        protocol: "systemone",
        apiKey: env.AI_GATEWAY_API_KEY ?? "",
        apiUrl: GATEWAY_API_URL,
        model: GATEWAY_MODEL,
      };
    case "direct":
      return {
        name: "direct",
        protocol: "systemone",
        apiKey: env.TYPESAFE_API_KEY ?? "",
        apiUrl: DIRECT_API_URL,
        model: DIRECT_MODEL,
      };
    case "novita-vl":
      return novitaRouteFromEnv(env);
    default:
      return null;
  }
}

/**
 * Transport resolution:
 *   LIGIS_JEV_TRANSPORT=gateway|direct|novita-vl|auto (default auto).
 *   auto → gateway when AI_GATEWAY_API_KEY is set (the free route), else
 *   direct when TYPESAFE_API_KEY is set, else gateway so the skip reason
 *   names the credential we actually want. novita-vl is explicit-only —
 *   auto never picks it.
 * LIGIS_JEV_API_KEY overrides the credential for whichever route is active;
 * LIGIS_JEV_API_URL / LIGIS_JEV_MODEL still override URL and model slug.
 * LIGIS_JEV_FALLBACK is a comma-separated chain of route names tried after
 * the primary (each built from its own credential; keyless, unknown,
 * duplicate, and primary-name entries are dropped).
 */
export function loadJevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const requested = (env.LIGIS_JEV_TRANSPORT ?? "auto").toLowerCase();
  const hasGatewayKey = Boolean(env.AI_GATEWAY_API_KEY);
  const hasDirectKey = Boolean(env.TYPESAFE_API_KEY);
  const transport: JevRouteName = ROUTE_NAMES.has(requested)
    ? (requested as JevRouteName)
    : hasGatewayKey
      ? "gateway"
      : hasDirectKey
        ? "direct"
        : "gateway";

  let apiKey: string;
  let apiUrl: string;
  let model: string;
  if (transport === "novita-vl") {
    const novita = novitaRouteFromEnv(env);
    apiKey = env.LIGIS_JEV_API_KEY ?? novita.apiKey;
    apiUrl = env.LIGIS_JEV_API_URL ?? novita.apiUrl;
    model = env.LIGIS_JEV_MODEL ?? novita.model;
  } else {
    apiKey =
      env.LIGIS_JEV_API_KEY ??
      (transport === "gateway"
        ? env.AI_GATEWAY_API_KEY
        : env.TYPESAFE_API_KEY) ??
      "";
    apiUrl =
      env.LIGIS_JEV_API_URL ??
      (transport === "gateway" ? GATEWAY_API_URL : DIRECT_API_URL);
    model =
      env.LIGIS_JEV_MODEL ??
      (transport === "gateway" ? GATEWAY_MODEL : DIRECT_MODEL);
  }

  let fallbacks: JevRoute[] | undefined;
  if (env.LIGIS_JEV_FALLBACK !== undefined) {
    const seen = new Set<string>([transport]);
    const list: JevRoute[] = [];
    for (const raw of env.LIGIS_JEV_FALLBACK.split(",")) {
      const name = raw.trim().toLowerCase();
      if (!ROUTE_NAMES.has(name) || seen.has(name)) continue;
      seen.add(name);
      const route = routeFromName(name, env);
      if (route?.apiKey) list.push(route);
    }
    if (list.length > 0) fallbacks = list;
  }

  return {
    enabled: env.LIGIS_JEV_ENABLED === "1",
    transport,
    apiKey,
    apiUrl,
    model,
    minConfidence: Number(env.LIGIS_JEV_MIN_CONFIDENCE ?? "0.6"),
    // Jev answers in 70–500ms; the headroom covers event-loop contention from
    // the gate's synchronous casper-client reads on cold requests. This is
    // the budget for the whole route chain, not per route.
    timeoutMs: Number(env.LIGIS_JEV_TIMEOUT_MS ?? "4000"),
    enforce: env.LIGIS_JEV_ENFORCE === "1",
    ...(fallbacks ? { fallbacks } : {}),
    ...(env.LIGIS_JEV_NOVITA_INPUT_USD_PER_MTOK !== undefined
      ? {
          novitaInputUsdPerMTok: Number(
            env.LIGIS_JEV_NOVITA_INPUT_USD_PER_MTOK,
          ),
        }
      : {}),
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
      name: input.serviceName,
      description:
        input.serviceDescription ??
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
  /**
   * Route-supplied cost: undefined = derive below (gateway metadata or
   * TypeSafe's input price); null = force undefined (route has no published
   * price); a number = that cost verbatim.
   */
  costOverride?: number | null,
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
  // A route may override this entirely (novita-vl prices only input tokens
  // at an env-configured rate — never TypeSafe's).
  const gatewayCost =
    data.provider_metadata?.gateway?.cost ??
    data.providerMetadata?.gateway?.cost;
  const parsedGatewayCost =
    gatewayCost !== undefined && gatewayCost !== "" ? Number(gatewayCost) : NaN;
  const costUsd =
    costOverride !== undefined
      ? (costOverride ?? undefined)
      : Number.isFinite(parsedGatewayCost)
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

// ---------- Route cooldown (per-route circuit breaker) ----------

const COOLDOWN_MS = 60_000;
const cooldowns = new Map<string, { until: number; status: number }>();

/** Test hook: clear all armed route cooldowns. */
export function resetJevCooldowns(): void {
  cooldowns.clear();
}

/** Statuses that arm the cooldown — auth, balance/budget (Novita's 403
 * NOT_ENOUGH_* family is how a spent promo reports itself), rate limits. */
const COOLDOWN_STATUSES = new Set([401, 403, 429]);

function missingKeyReason(name: JevRouteName): string {
  return name === "gateway"
    ? "missing AI_GATEWAY_API_KEY"
    : name === "direct"
      ? "missing TYPESAFE_API_KEY"
      : "missing NOVITA_API_KEY";
}

// ---------- Novita decide adapter (one question per request) ----------

interface NovitaDecideResponse {
  kind?: string;
  options?: string[];
  probabilities?: number[];
  choice_index?: number;
  choice?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface NovitaQuestionPlan {
  key: string;
  kind: "choice" | "noul";
  /** Expected option labels (choice only) — validated 1:1 against the response. */
  options?: string[];
}

const NOVITA_PLAN: NovitaQuestionPlan[] = [
  {
    key: "scope",
    kind: "choice",
    options: ["consistent", "inconsistent", "unclear"],
  },
  {
    key: "amount_plausibility",
    kind: "choice",
    options: ["implausible", "questionable", "plausible"],
  },
  { key: "payee_consistency", kind: "noul" },
  { key: "request_normality", kind: "noul" },
];

/** Render each buildQuestions() entry as the single `question` string the
 * decide endpoint takes: instructions plus criteria inline. */
function novitaQuestions(): (NovitaQuestionPlan & { question: string })[] {
  const questions = buildQuestions() as Record<
    string,
    { instructions?: string; criteria?: unknown }
  >;
  return NOVITA_PLAN.map((plan) => {
    const src = questions[plan.key] ?? {};
    const instructions = src.instructions ?? "";
    let suffix = "";
    if (plan.kind === "choice") {
      if (Array.isArray(src.criteria)) {
        // score-type criteria are already "Label — description" strings.
        suffix = ` Options: ${src.criteria.join("; ")}`;
      } else if (src.criteria && typeof src.criteria === "object") {
        suffix = ` Options: ${Object.entries(src.criteria)
          .map(([label, text]) => `${label} — ${text}`)
          .join("; ")}`;
      }
    } else if (src.criteria && typeof src.criteria === "object") {
      const c = src.criteria as Record<string, string>;
      if (c.yes || c.no) {
        suffix = ` Answer true if: ${c.yes}; false if: ${c.no}`;
      }
    }
    return { ...plan, question: `${instructions}${suffix}` };
  });
}

/** Turn a decide response into the TypeSafe-shaped answer composeVerdict
 * already consumes. Throws on any unparseable shape — the caller treats a
 * throw as a route failure. */
function synthesizeNovitaAnswer(
  plan: NovitaQuestionPlan,
  data: NovitaDecideResponse,
): JevAnswer {
  const options = data.options;
  const probs = data.probabilities;
  if (
    !Array.isArray(options) ||
    !Array.isArray(probs) ||
    options.length !== probs.length ||
    probs.some((p) => typeof p !== "number" || Number.isNaN(p))
  ) {
    throw new Error("missing options/probabilities");
  }

  if (plan.kind === "noul") {
    const idx = options.indexOf("true");
    if (idx === -1) throw new Error("noul options missing 'true'");
    return { type: "noul", noul: probs[idx]! };
  }

  // Choice — every expected label must be present.
  const expected = plan.options ?? [];
  if (expected.some((label) => !options.includes(label))) {
    throw new Error("choice options missing expected label");
  }
  const argmax = probs.indexOf(Math.max(...probs));

  if (plan.key === "amount_plausibility") {
    // Expected index on the 0..2 scale TypeSafe's score answer uses
    // (0=implausible … 2=plausible) — composeVerdict flags at score <= 0.5.
    const legendIndex = new Map(expected.map((label, i) => [label, i]));
    let score = 0;
    for (let j = 0; j < options.length; j++) {
      score += probs[j]! * (legendIndex.get(options[j]!) ?? 0);
    }
    const legend: Record<string, string> = {};
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < expected.length; i++) {
      legend[String(i)] = expected[i]!;
      const idx = options.indexOf(expected[i]!);
      probabilities[String(i)] = idx === -1 ? 0 : probs[idx]!;
    }
    return {
      type: "score",
      score,
      legend,
      probabilities,
      confidence: probs[argmax]!,
    };
  }

  const probabilities: Record<string, number> = {};
  for (let j = 0; j < options.length; j++) {
    probabilities[options[j]!] = probs[j]!;
  }
  return {
    type: "choice",
    choice: options[argmax]!,
    probabilities,
    confidence: probs[argmax]!,
  };
}

// ---------- Route execution ----------

type RouteOutcome =
  | { ok: true; data: JevResponse; costUsd?: number | null }
  | { ok: false; reason: string; status?: number };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function callSystemone(
  route: JevRoute,
  input: JevIntentInput,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<RouteOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(route.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${route.apiKey}`,
      },
      body: JSON.stringify({
        model: route.model,
        state: buildState(input),
        questions: buildQuestions(),
      }),
      signal,
    });
  } catch (err) {
    return { ok: false, reason: `jev unreachable: ${errMessage(err)}` };
  }
  if (!res.ok) {
    return { ok: false, reason: `jev HTTP ${res.status}`, status: res.status };
  }
  let data: JevResponse;
  try {
    data = (await res.json()) as JevResponse;
  } catch {
    return { ok: false, reason: "jev returned malformed JSON" };
  }
  if (!data.answers || typeof data.answers !== "object") {
    return { ok: false, reason: "jev response missing answers" };
  }
  return { ok: true, data };
}

async function callNovita(
  route: JevRoute,
  input: JevIntentInput,
  config: JevConfig,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<RouteOutcome> {
  const plans = novitaQuestions();
  const state = buildState(input);

  let responses: Response[];
  try {
    responses = await Promise.all(
      plans.map((plan) =>
        fetchImpl(route.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${route.apiKey}`,
          },
          body: JSON.stringify({
            model: route.model,
            kind: plan.kind,
            state,
            question: plan.question,
            ...(plan.options ? { options: plan.options } : {}),
            thinking: "off",
          }),
          signal,
        }),
      ),
    );
  } catch (err) {
    return { ok: false, reason: `jev unreachable: ${errMessage(err)}` };
  }

  for (const res of responses) {
    if (!res.ok) {
      return {
        ok: false,
        reason: `jev HTTP ${res.status}`,
        status: res.status,
      };
    }
  }

  let datas: NovitaDecideResponse[];
  try {
    datas = (await Promise.all(
      responses.map((res) => res.json()),
    )) as NovitaDecideResponse[];
  } catch {
    return { ok: false, reason: "jev returned malformed JSON" };
  }

  const answers: Record<string, JevAnswer> = {};
  try {
    plans.forEach((plan, i) => {
      answers[plan.key] = synthesizeNovitaAnswer(plan, datas[i]!);
    });
  } catch {
    return { ok: false, reason: "jev response missing answers" };
  }

  const inputTokens = datas.reduce(
    (sum, d) => sum + (d.usage?.prompt_tokens ?? 0),
    0,
  );
  const data: JevResponse = {
    model: datas[0]?.model,
    answers,
    usage: { input_tokens: inputTokens },
  };
  // Novita bills input tokens only and publishes no unit price: cost is
  // undefined unless the operator configured a rate — never TypeSafe's.
  const costUsd =
    config.novitaInputUsdPerMTok !== undefined
      ? (inputTokens * config.novitaInputUsdPerMTok) / 1_000_000
      : null;
  return { ok: true, data, costUsd };
}

// ---------- Entry point ----------

export async function evaluatePaymentIntent(
  input: JevIntentInput,
  config: JevConfig,
  fetchImpl: FetchLike = fetch,
): Promise<JevIntentResult> {
  const t0 = Date.now();

  if (!config.enabled) return skipped("layer disabled", t0);

  const primary: JevRoute = {
    name: config.transport,
    protocol: config.transport === "novita-vl" ? "novita-decide" : "systemone",
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    model: config.model,
  };
  const routes: JevRoute[] = [primary, ...(config.fallbacks ?? [])];
  const multi = routes.length > 1;
  const attempts: { route: JevRouteName; outcome: string }[] = [];

  for (const route of routes) {
    if (!route.apiKey) {
      const reason = missingKeyReason(route.name);
      if (!multi) return skipped(reason, t0);
      attempts.push({ route: route.name, outcome: reason });
      continue;
    }

    const cooldown = cooldowns.get(`${route.name}|${route.apiUrl}`);
    if (cooldown && cooldown.until > Date.now()) {
      if (!multi) {
        return skipped(
          `${route.name} in cooldown after HTTP ${cooldown.status}`,
          t0,
        );
      }
      attempts.push({ route: route.name, outcome: "cooldown" });
      continue;
    }

    // config.timeoutMs is the budget for the whole chain — each attempt
    // gets whatever is left.
    const remaining = config.timeoutMs - (Date.now() - t0);
    if (remaining <= 0) break;

    const outcome =
      route.protocol === "novita-decide"
        ? await callNovita(
            route,
            input,
            config,
            AbortSignal.timeout(remaining),
            fetchImpl,
          )
        : await callSystemone(
            route,
            input,
            AbortSignal.timeout(remaining),
            fetchImpl,
          );

    if (!outcome.ok) {
      if (
        outcome.status !== undefined &&
        COOLDOWN_STATUSES.has(outcome.status)
      ) {
        cooldowns.set(`${route.name}|${route.apiUrl}`, {
          until: Date.now() + COOLDOWN_MS,
          status: outcome.status,
        });
      }
      attempts.push({ route: route.name, outcome: outcome.reason });
      if (!multi) return skipped(outcome.reason, t0);
      continue;
    }

    const result = composeVerdict(
      outcome.data,
      input,
      Date.now() - t0,
      config,
      outcome.costUsd,
    );
    result.route = route.name;
    if (multi) {
      attempts.push({ route: route.name, outcome: "ok" });
      result.attempts = attempts;
    }
    return result;
  }

  if (multi) {
    const reason = `all routes failed — ${attempts
      .map((a) => `${a.route}: ${a.outcome}`)
      .join("; ")}`;
    const result = skipped(reason, t0);
    result.attempts = attempts;
    return result;
  }
  // Single route with nothing left of the budget before its first attempt.
  return skipped("jev evaluation deadline exceeded", t0);
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
  if (r.route) {
    headers["x-jev-route"] = r.route;
  }
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
    ...(r.route ? { route: r.route } : {}),
    ...(r.costUsd !== undefined
      ? { costUsd: Number(r.costUsd.toFixed(8)) }
      : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.skippedReason ? { skippedReason: r.skippedReason } : {}),
  };
}
