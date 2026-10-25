/**
 * `decide()` — the Ligis pre-payment decision service.
 *
 * Spec: `docs/decide-api.md`. Used by `POST /api/gate` and the
 * client-side `GateDecision` component on `/gate`. Returns a `Decision`
 * built from four signals (right payee, right amount, in scope, verified
 * payee), evaluated concurrently. Composition rule: STOP wins; GO only
 * when the payee and amount signals actually answered (mandate or Jev);
 * otherwise UNKNOWN.
 *
 * Mandate is enforced in code as deterministic signals (per AGENTS.md:
 * "computable policy stays in code"). Jev is the reflex layer, not the
 * authority. Arena uses its own `judgePayment()` and does NOT call this.
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
import {
  boundedRead,
  evidenceTimeout,
  unavailable,
  type PayeeEvidence,
  type PayeeEvidenceReader,
  type EvidenceOptions,
} from "./payee-evidence/types";
import {
  formatBaseUnits,
  railFor,
  scaleBaseUnitsByUsd,
  tokenDecimals,
  type PaymentAmount,
} from "./payment-asset";

export type {
  BaseUnits,
  EvmChainId,
  PaymentAmount,
  PaymentChainId,
  PaymentRail,
  TokenSymbol,
  UsdcPaymentAmount,
  ZcashChainId,
  ZecPaymentAmount,
} from "./payment-asset";

// ─── public types (mirror docs/decide-api.md) ──────────────────────────

export type VerdictStatus = "GO" | "STOP" | "SKIPPED" | "UNKNOWN";

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
      /** Source evidence is not a verdict and never claims a capability. */
      evidence?: PayeeEvidence[];
      reason?: string;
      latencyMs?: number;
    };

/**
 * A pre-payment intent. The token leg is explicit and discriminated on
 * `tokenSymbol` (see `./payment-asset`):
 *
 *   - `{ tokenSymbol: "ZEC",  chainId: "zcash:testnet", amountBaseUnits }`
 *     → zatoshis (8 decimals), `zcash-shielded` rail
 *   - `{ tokenSymbol: "USDC", chainId: "eip155:<n>",    amountBaseUnits }`
 *     → micro-USDC (6 decimals), `evm-erc20` rail
 *
 * `amountBaseUnits` is what actually moves on-chain and is what Jev sees.
 * `amountUsd` is the operator-facing valuation that mandate caps
 * (`maxUsd` / `expectedUsd`) are enforced against.
 */
export type PaymentIntent = PaymentIntentBase & PaymentAmount;

export type PaymentIntentBase = {
  /** Payee address or stable known-vendor id. The credential subject. */
  payee: string;
  /** USD valuation of the payment. Mandate caps are enforced against it. */
  amountUsd: number;
  /** What the agent was hired to do. Forwarded to Jev + the operator UI. */
  purpose: string;
  /**
   * Operator mandate. Enforced as deterministic signals BEFORE Jev:
   * payee must appear on the allowlist (STOP if absent), amount must not
   * exceed maxUsd (STOP if exceeded). Scope is advisory — forwarded to
   * Jev but not checked here.
   */
  mandate?: {
    payees?: string[];
    maxUsd?: number;
    /** Contracted price for this job. Used as Jev reference price.
     * When absent, amountUsd is used (compliant payment against cap).
     */
    expectedUsd?: number;
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
    options?: EvidenceOptions,
  ) => Promise<SubjectResolution>;
  env?: NodeJS.ProcessEnv;
  readPayeeEvidence?: PayeeEvidenceReader;
  /** Protected server policy, never parsed from caller JSON. */
  operatorPolicy?: {
    requiredCapability?: string;
    requiredSources?: PayeeEvidence["source"][];
    eligibleSources?: Array<"ligis-credential" | "erc8004" | "nansen">;
    mandate?: PaymentIntent["mandate"];
  };
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

/** Tolerance above expectedUsd before the amount check stops the payment.
 * 10 % — allows minor rounding / exchange-rate drift while catching
 * deliberate overbilling (the original attack was 90× the contract). */
const EXPECTED_USD_TOLERANCE = 0.1;

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

// ─── mandate enforcement ──────────────────────────────────────────────

/**
 * Enforces the operator mandate as deterministic checks.
 *
 * The mandate is the contract — computable terms enforced in code (AGENTS.md).
 * Jev is the reflex layer, not the authority. A mandate check returns GO/STOP
 * when it can, SKIPPED when there's no mandate constraint for that signal.
 *
 * The mandate DOES NOT override Jev — STOP from either wins. This prevents a
 * mandate pass from silencing a Jev STOP (e.g. prompt injection detected by
 * Jev but not by mandate checks). Similarly, a Jev STOP is never masked by a
 * mandate pass.
 *
 * expectedUsd enforcement: if set and amountUsd exceeds expectedUsd × (1 +
 * tolerance), returns STOP. Catches overbilling that falls under maxUsd cap
 * but violates the contracted price.
 */
function checkMandate(intent: PaymentIntent): {
  payeeSignal: Signal | null; // null = no mandate constraint → defer to Jev
  amountSignal: Signal | null;
  expectedUsdSignal: Signal | null; // null = no expectedUsd → skip this check
  /** The matched allowlist entry for this payee, used as Jev reference. */
  matchedPayee: string | null;
} {
  if (!intent.mandate) {
    return {
      payeeSignal: null,
      amountSignal: null,
      expectedUsdSignal: null,
      matchedPayee: null,
    };
  }

  let payeeSignal: Signal | null = null;
  let matchedPayee: string | null = null;
  if (intent.mandate.payees && intent.mandate.payees.length > 0) {
    const normalizedPayee = intent.payee.toLowerCase();
    const matched = intent.mandate.payees.find(
      (p) => p.toLowerCase() === normalizedPayee,
    );
    if (matched) {
      matchedPayee = matched;
      payeeSignal = baseSignal(
        "right-payee",
        "GO",
        1,
        `payee ${matched} is on mandate allowlist`,
      );
    } else {
      payeeSignal = baseSignal(
        "right-payee",
        "STOP",
        1,
        `payee ${intent.payee} not on mandate allowlist`,
      );
    }
  }

  let amountSignal: Signal | null = null;
  if (
    intent.mandate.maxUsd !== undefined &&
    intent.amountUsd > intent.mandate.maxUsd
  ) {
    amountSignal = baseSignal(
      "right-amount",
      "STOP",
      1,
      `amount $${intent.amountUsd} exceeds mandate max $${intent.mandate.maxUsd}`,
    );
  } else if (intent.mandate.maxUsd !== undefined && intent.amountUsd > 0) {
    amountSignal = baseSignal(
      "right-amount",
      "GO",
      1,
      `amount $${intent.amountUsd} is within mandate cap $${intent.mandate.maxUsd}`,
    );
  }

  // expectedUsd tolerance check: catches overbilling under the maxUsd cap.
  // A 90× overcharge that falls under the cap still triggers STOP.
  // Anything at or below the quote (with tolerance) is compliant, including
  // underpaying — you're paying less than the contract says you should.
  let expectedUsdSignal: Signal | null = null;
  if (
    intent.mandate.expectedUsd !== undefined &&
    intent.mandate.expectedUsd > 0 &&
    intent.amountUsd > 0
  ) {
    const threshold = intent.mandate.expectedUsd * (1 + EXPECTED_USD_TOLERANCE);
    if (intent.amountUsd > threshold) {
      expectedUsdSignal = baseSignal(
        "right-amount",
        "STOP",
        1,
        `amount $${intent.amountUsd} exceeds contracted price $${intent.mandate.expectedUsd} (+${(EXPECTED_USD_TOLERANCE * 100).toFixed(0)}% tolerance)`,
      );
    } else {
      // Any amount up to expectedUsd * 1.10 is compliant — underpaying is fine.
      expectedUsdSignal = baseSignal(
        "right-amount",
        "GO",
        1,
        `amount $${intent.amountUsd} is within contracted price $${intent.mandate.expectedUsd} (+${(EXPECTED_USD_TOLERANCE * 100).toFixed(0)}% tolerance)`,
      );
    }
  }

  return { payeeSignal, amountSignal, expectedUsdSignal, matchedPayee };
}

/**
 * Combine a mandate signal with a Jev signal for the same check.
 *
 * STOP wins from either. Mandate is the contract — when there's a mandate
 * constraint, Jev is supplementary (never silences a mandate GO). When there
 * is NO mandate constraint, the signal is SKIPPED regardless of Jev, because
 * Jev's payee/amount check without a mandate compares the payment to itself
 * (advertisedPayTo = intent.payee, referencePrice = intent.amountUsd).
 *
 * This ensures:
 * - Mandate STOP + Jev GO → STOP (contract violation wins)
 * - Mandate GO + Jev STOP → STOP (Jev catches prompt injection, etc.)
 * - No mandate + Jev GO → SKIPPED (no contract to check against)
 */
function combineSignals(mandate: Signal | null, jev: Signal): Signal {
  // STOP always wins.
  if (mandate?.status === "STOP") return mandate;
  if (jev.status === "STOP") return jev;

  // If mandate has a view (GO), use it — Jev GO doesn't add value.
  if (mandate) return mandate;

  // No mandate constraint → SKIPPED regardless of Jev.
  // Jev's payee/amount without a mandate compares payment to itself.
  return baseSignal(
    jev.id,
    "SKIPPED",
    0,
    jev.id === "right-payee"
      ? "no contracted payee"
      : jev.id === "right-amount"
        ? "no contracted price"
        : jev.reason,
  );
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
  const evidenceEnabled = env.LIGIS_PAYEE_EVIDENCE_ENABLED === "1";
  const requiredCapability =
    deps.operatorPolicy?.requiredCapability ??
    env.LIGIS_PAYEE_REQUIRED_CAPABILITY?.trim();
  const capability = requiredCapability || intent.capability;
  const timeoutMs = evidenceTimeout(
    Number(env.LIGIS_PAYEE_EVIDENCE_TIMEOUT_MS),
  );

  // The token leg is explicit on the intent: Jev sees the exact base units
  // that will move, in the token's own decimals (zatoshis / micro-USDC).
  const smallestUnit = intent.amountBaseUnits;

  // Run mandate checks first — they're deterministic and cheap.
  const callerMandate = checkMandate(intent);
  const operatorMandate = checkMandate({
    ...intent,
    mandate: deps.operatorPolicy?.mandate,
  });
  const mergeConstraint = (a: Signal | null, b: Signal | null) =>
    a?.status === "STOP" ? a : b?.status === "STOP" ? b : (a ?? b);
  const mandateResult = {
    payeeSignal: mergeConstraint(
      operatorMandate.payeeSignal,
      callerMandate.payeeSignal,
    ),
    amountSignal: mergeConstraint(
      operatorMandate.amountSignal,
      callerMandate.amountSignal,
    ),
    expectedUsdSignal: mergeConstraint(
      operatorMandate.expectedUsdSignal,
      callerMandate.expectedUsdSignal,
    ),
    matchedPayee: operatorMandate.matchedPayee ?? callerMandate.matchedPayee,
  };

  // Mandate-driven reference values beat intent values where set.
  // The gate advertises what the contract says; Jev compares the
  // actual payment against that reference. If no mandate, fall back
  // to the intent values (the operator's declared terms at request time).
  //
  // matchedPayee: which allowlist entry matched (used as advertisedPayTo
  // so Jev doesn't see a false payee-mismatch when paying a second
  // allowlisted address).
  // contractPriceSmallestUnit: the EXPECTED price, not the cap. Use
  // mandate.expectedUsd when available (the contracted rate); otherwise
  // fall back to amountUsd (the actual payment — a compliant payment
  // against a cap should not read as underpayment).
  const advertisedPayTo = mandateResult.matchedPayee ?? intent.payee;
  const referencePriceUsd =
    deps.operatorPolicy?.mandate?.expectedUsd ??
    intent.mandate?.expectedUsd ??
    intent.amountUsd;
  // Express the USD reference price in the payment token's base units,
  // using the intent's own USD quote as the implied rate (exact for USDC).
  const contractPriceSmallestUnit = scaleBaseUnitsByUsd(
    intent.amountBaseUnits,
    referencePriceUsd,
    intent.amountUsd,
  );

  const jevInput: JevIntentInput = {
    subject: intent.payee,
    capability: capability ?? "payment",
    capabilityDescription: intent.purpose,
    gatePriceSmallestUnit: contractPriceSmallestUnit,
    tokenSymbol: intent.tokenSymbol,
    tokenDecimals: String(tokenDecimals(intent.tokenSymbol)),
    advertisedPayTo,
    payment: {
      amountSmallestUnit: smallestUnit,
      payTo: intent.payee,
    },
  };

  const [jevResult, credentialResult, pageJudgeResult, evidenceResult] =
    await Promise.allSettled([
      config.enabled
        ? evidenceEnabled
          ? boundedRead(() => evaluate(jevInput, config), timeoutMs)
          : Promise.resolve().then(() => evaluate(jevInput, config))
        : Promise.resolve(makeSkippedJev("layer disabled")),
      capability
        ? evidenceEnabled
          ? boundedRead(
              (signal) =>
                resolve(intent.payee, capability, { timeoutMs, signal }),
              timeoutMs,
            )
          : Promise.resolve().then(() => resolve(intent.payee, capability))
        : Promise.resolve({
            ok: false as const,
            error: "no capability supplied",
          } satisfies SubjectResolution),
      intent.pageText
        ? Promise.resolve().then(() => judge(intent.pageText!))
        : Promise.resolve(null),
      evidenceEnabled
        ? boundedRead(
            (signal) =>
              deps.readPayeeEvidence
                ? deps.readPayeeEvidence(intent.payee, {
                    env,
                    timeoutMs,
                    signal,
                  })
                : Promise.resolve([
                    unavailable("erc8004", "ERC-8004 reader not configured"),
                    unavailable(
                      "x402-settlement",
                      "no verified x402 settlement source configured",
                    ),
                    unavailable("nansen", "Nansen reader not configured"),
                  ]),
            timeoutMs + 100,
          )
        : Promise.resolve([] as PayeeEvidence[]),
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

  const signals: Signal[] = SIGNAL_ORDER.map((id) => {
    // Combine mandate with Jev: STOP wins from either. Mandate doesn't
    // override Jev — a Jev STOP on payee or amount always wins.
    if (id === "right-payee") {
      const jevSignal = jevSignalFor(jev, id);
      return combineSignals(mandateResult.payeeSignal, jevSignal);
    }
    if (id === "right-amount") {
      const jevSignal = jevSignalFor(jev, id);
      // Combine mandate result with expectedUsd check: if either mandate
      // or expectedUsd says STOP, STOP wins.
      const mandateAmnt = combineSignals(mandateResult.amountSignal, jevSignal);
      const expectedUsdAmnt = combineSignals(
        mandateResult.expectedUsdSignal,
        jevSignal,
      );
      // If either mandate-amnt or expected-usd-amnt says STOP, STOP wins.
      if (mandateAmnt.status === "STOP") return mandateAmnt;
      if (expectedUsdAmnt.status === "STOP") return expectedUsdAmnt;
      // If mandate-amnt has a view, use it; else use expected-usd-amnt.
      if (mandateResult.amountSignal) return mandateAmnt;
      if (mandateResult.expectedUsdSignal) return expectedUsdAmnt;
      // No mandate constraints → combine (returns SKIPPED).
      return combineSignals(null, jevSignal);
    }
    if (id === "verified-payee") {
      if (evidenceEnabled) {
        const external =
          evidenceResult.status === "fulfilled"
            ? evidenceResult.value
            : [
                unavailable("erc8004", "payee evidence reads did not answer"),
                unavailable(
                  "x402-settlement",
                  "payee evidence reads did not answer",
                ),
                unavailable("nansen", "payee evidence reads did not answer"),
              ];
        return openWorldPayeeSignal(
          credentialResult,
          external,
          capability,
          requiredCapability,
          deps,
          env,
        );
      }
      return verifiedPayeeSignal(credentialResult);
    }
    const signal = buildSignal(id, jev, credentialResult, pageJudge);
    return evidenceEnabled && signal.status === "SKIPPED"
      ? {
          ...signal,
          status: "UNKNOWN",
          reason: signal.reason ?? "intent evaluation did not answer",
        }
      : signal;
  });

  const verdict = composeVerdict(signals, evidenceEnabled);
  const provenance = buildProvenance(jev, credentialResult, pageJudge, config);
  const payeeSignal = signals.find((s) => s.id === "verified-payee");
  if (payeeSignal?.id === "verified-payee") {
    for (const evidence of payeeSignal.evidence ?? []) {
      provenance.push(
        `${evidence.source} ${evidence.status}: ${evidence.reason}${evidence.reference ? ` (${evidence.reference})` : ""}`,
      );
    }
  }

  provenance.push(
    `payment ${formatBaseUnits(intent.tokenSymbol, intent.amountBaseUnits)} (${intent.amountBaseUnits} base units) on ${intent.chainId} via ${railFor(intent)}`,
  );

  return {
    verdict,
    signals,
    latencyMs: Date.now() - t0,
    costUsd: jev.costUsd,
    provenance,
  };
}

// ─── signal builders ────────────────────────────────────────────────────

function credentialEvidence(
  result: PromiseSettledResult<SubjectResolution>,
  capability?: string,
): PayeeEvidence {
  const observedAt = new Date().toISOString();
  const base: Pick<
    PayeeEvidence,
    "source" | "observedAt" | "limitations" | "reference"
  > = {
    source: "ligis-credential",
    observedAt,
    limitations: [],
  };
  if (!capability)
    return {
      ...base,
      status: "unknown",
      reason: "no capability supplied; no credential claim evaluated",
    };
  if (result.status === "rejected" || !result.value.ok) {
    return {
      ...base,
      status: "unavailable",
      reason: "credential source did not answer",
    };
  }
  const r = result.value;
  const verdicts = r.verdicts.length ? r.verdicts : [r.primary];
  base.reference = verdicts
    .map(
      (v) =>
        `${v.chain.id}:${v.outcome.ok ? v.outcome.capabilityHash : "unavailable"}`,
    )
    .join(",");
  const reads = verdicts.flatMap((v) => (v.outcome.ok ? [v.outcome] : []));
  // Do not select the strongest positive and hide a relevant negative on another rail.
  if (
    r.selfIssued ||
    reads.some(
      (out) =>
        out.selfIssued ||
        (out.issuer && out.issuer.toLowerCase() === r.subject.toLowerCase()),
    )
  ) {
    return {
      ...base,
      status: "negative",
      reason: "credential is self-issued; not trustworthy",
    };
  }
  if (reads.some((out) => out.revoked)) {
    return {
      ...base,
      status: "negative",
      reason: "relevant credential has been revoked",
    };
  }
  if (
    reads.some(
      (out) =>
        out.issuer &&
        out.issuer !== "0x0000000000000000000000000000000000000000" &&
        !out.capable,
    )
  ) {
    return {
      ...base,
      status: "negative",
      reason:
        "recorded credential is expired or does not grant the required capability",
    };
  }
  if (verdicts.some((v) => !v.outcome.ok) || !r.primary.outcome.ok) {
    return {
      ...base,
      status: "unavailable",
      reason: "credential coverage includes unavailable chain reads",
    };
  }
  if (
    r.capable &&
    reads.some(
      (out) =>
        out.capable &&
        (out.capabilityId === capability ||
          out.capabilityHash.toLowerCase() === capability.toLowerCase()),
    )
  ) {
    return {
      ...base,
      status: "positive",
      reason: `non-self-issued credential held on ${r.primary.chain.name}`,
    };
  }
  return {
    ...base,
    status: "unknown",
    reason: "successful credential reads found no matching trust record",
  };
}

function openWorldPayeeSignal(
  result: PromiseSettledResult<SubjectResolution>,
  external: PayeeEvidence[],
  capability: string | undefined,
  requiredCapability: string | undefined,
  deps: DecideDeps,
  env: NodeJS.ProcessEnv,
): Signal {
  const credential = credentialEvidence(result, capability);
  const evidence = [
    credential,
    ...external.filter((e) => e.source !== "ligis-credential"),
  ];
  const allowedSources: PayeeEvidence["source"][] = [
    "ligis-credential",
    "erc8004",
    "x402-settlement",
    "nansen",
  ];
  const configuredSources = (env.LIGIS_PAYEE_REQUIRED_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidSource = configuredSources.some(
    (s) => !allowedSources.includes(s as PayeeEvidence["source"]),
  );
  const requiredSources =
    deps.operatorPolicy?.requiredSources ??
    (configuredSources as PayeeEvidence["source"][]);
  for (const source of requiredSources) {
    if (!evidence.some((e) => e.source === source)) {
      evidence.push(
        unavailable(source, "required source returned no evidence record"),
      );
    }
  }
  const negative = evidence.find((e) => e.status === "negative");
  const missingRequired = requiredSources.find((source) => {
    const records = evidence.filter((e) => e.source === source);
    return !records.length || records.some((e) => e.status !== "positive");
  });
  const eligible = deps.operatorPolicy?.eligibleSources ?? [
    "ligis-credential",
    "erc8004",
  ];
  // Settlement volume is never an independently eligible trust source.
  const positive = evidence.find(
    (e) =>
      eligible.includes(e.source as (typeof eligible)[number]) &&
      e.source !== "x402-settlement" &&
      e.status === "positive",
  );
  let status: VerdictStatus = "UNKNOWN";
  let reason = "no qualifying payee trust evidence; absence is not a rejection";
  if (negative) {
    status = "STOP";
    reason = negative.reason;
  } else if (requiredCapability && credential.status === "unknown") {
    status = "STOP";
    reason = `operator requires specific non-self-issued capability ${requiredCapability}; credential missing`;
  } else if (invalidSource) {
    reason = "operator required-source configuration is invalid";
  } else if (credential.status === "unavailable") {
    reason = credential.reason;
  } else if (missingRequired) {
    reason = `required evidence source ${missingRequired} did not establish a positive answer`;
  } else if (requiredCapability && credential.status !== "positive") {
    reason = `required capability ${requiredCapability} could not be verified`;
  } else if (positive) {
    status = "GO";
    reason = positive.reason;
  }
  const strict = verifiedPayeeSignal(result);
  return {
    ...strict,
    id: "verified-payee",
    status,
    confidence: status === "UNKNOWN" ? 0 : 1,
    reason,
    evidence,
  };
}

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
      const jevSignal = jevSignalFor(jev, id);
      if (jevSignal.status === "STOP") return jevSignal;
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
  if (
    jev.verdict === "STOP" &&
    signalId === "in-scope" &&
    !jev.flags.some((f) => JEV_FLAG_TO_SIGNAL[f.id])
  ) {
    return baseSignal(
      signalId,
      "STOP",
      jev.confidence,
      "intent evaluator returned STOP without a recognized flag",
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

/**
 * Build the verified-payee signal from a resolution result.
 * Self-issued credentials (issuer === subject) are treated as STOP.
 */
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
    );
  }
  const r = result.value;
  if (!r.ok) {
    return baseSignal("verified-payee", "SKIPPED", 0, r.error);
  }
  const primary = r.primary;
  const out = primary.outcome;
  if (!out.ok) {
    return baseSignal("verified-payee", "SKIPPED", 0, out.error);
  }

  // Self-issued credentials don't count as verification.
  if (r.selfIssued) {
    return baseSignal(
      "verified-payee",
      "STOP",
      1,
      "credential is self-issued (issuer === subject); not trustworthy",
    );
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
  latencyMs?: number,
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

/**
 * Compose the final verdict from the four signals.
 *
 * Composition rule: STOP wins. GO when:
 * 1. No signal is STOP
 * 2. Payee and amount signals have answered (mandate or Jev evaluated them)
 *    — a mandate pass counts as GO, Jev GO/STOP counts as answered,
 *    missing capability (verified-payee SKIPPED) is neutral
 * 3. All ANSWERED signals are GO (SKIPPED signals are neutral)
 *
 * Returns UNKNOWN when payee or amount couldn't be evaluated (Jev off,
 * no mandate). This prevents a single credential GO from silencing three
 * skipped signals into a misleading green light.
 */
function composeVerdict(
  signals: Signal[],
  evidenceEnabled = false,
): Decision["verdict"] {
  if (signals.some((s) => s.status === "STOP")) return "STOP";
  if (signals.some((s) => s.status === "UNKNOWN")) return "UNKNOWN";
  if (evidenceEnabled && signals.some((s) => s.status !== "GO"))
    return "UNKNOWN";

  const payee = signals.find((s) => s.id === "right-payee")!;
  const amount = signals.find((s) => s.id === "right-amount")!;

  // Both payee and amount must have answered (not been skipped) for GO.
  const intentSignalsAnswered = payee.status === "GO" && amount.status === "GO";

  if (!intentSignalsAnswered) return "UNKNOWN";

  // All ANSWERED signals must be GO. SKIPPED signals (e.g. verified-payee
  // when capability is missing) are neutral — they don't block GO.
  const answeredSignals = signals.filter((s) => s.status !== "SKIPPED");
  if (answeredSignals.every((s) => s.status === "GO")) return "GO";

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
