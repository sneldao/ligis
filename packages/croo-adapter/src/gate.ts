import { loadLigisAdapter } from "./config.js";
import {
  type ChainAdapter,
  evaluatePaymentIntent,
  loadJevConfig,
  type JevConfig,
} from "@ligis/core";
import {
  type ServiceRequest,
  type ServiceResult,
  parseServiceRequirements,
} from "./services.js";

/**
 * ligis.gate — the pre-flight trust read, sold as a service.
 *
 * Given a payment an agent is about to make (or accept), this handler runs
 * the full gate in miniature and returns one typed verdict:
 *
 *   1. Jev intent read (TypeSafe System One) — four typed questions in one
 *      parallel call: is the payment consistent with the capability's scope,
 *      is the amount plausible, does the payee match, is the pattern normal.
 *      Fail-open: if the Jev upstream is unreachable the intent block reports
 *      SKIPPED and everything else still runs.
 *   2. On-chain credential check via the ChainAdapter (Casper or Pharos) —
 *      the source of truth, unchanged.
 *
 * The buyer gets both signals in one deliverable, so it can refuse a
 * counterparty payment before any money moves.
 */

interface GateRequirements {
  subject: string;
  capability: string;
  /** Advertised price in smallest units for the capability being paid for. */
  priceSmallestUnit: string;
  /** The account the payment is headed to (the counterparty's collector). */
  payTo: string;
  /** Token symbol for the price, e.g. CSPR. Defaults to CSPR. */
  tokenSymbol?: string;
  /** Token decimals for human-readable amounts. Defaults to 9 (CSPR). */
  tokenDecimals?: string;
  /** Optional encoded/decoded payment the agent is about to send. */
  payment?: {
    scheme?: string;
    amountSmallestUnit?: string;
    payTo?: string;
  };
  /** Optional trusted issuer to constrain the credential check. */
  issuer?: string;
  /** Human description of what the capability grants. */
  capabilityDescription?: string;
}

function isGateRequirements(req: unknown): req is GateRequirements {
  const r = req as Record<string, unknown>;
  const payment = r.payment as Record<string, unknown> | undefined;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    typeof r.priceSmallestUnit === "string" &&
    typeof r.payTo === "string" &&
    (r.tokenSymbol === undefined || typeof r.tokenSymbol === "string") &&
    (r.tokenDecimals === undefined || typeof r.tokenDecimals === "string") &&
    (r.issuer === undefined || typeof r.issuer === "string") &&
    (r.capabilityDescription === undefined ||
      typeof r.capabilityDescription === "string") &&
    (payment === undefined ||
      (typeof payment === "object" &&
        (payment.scheme === undefined || typeof payment.scheme === "string") &&
        (payment.amountSmallestUnit === undefined ||
          typeof payment.amountSmallestUnit === "string") &&
        (payment.payTo === undefined || typeof payment.payTo === "string")))
  );
}

/** Test seams, matching the other handlers' opts-injection convention. */
export interface GateHandlerOpts {
  adapter?: ChainAdapter;
  jevConfig?: JevConfig;
}

export async function handleGate(
  req: ServiceRequest,
  opts: GateHandlerOpts = {},
): Promise<ServiceResult> {
  const parsed = parseServiceRequirements(req.requirements);
  if (!isGateRequirements(parsed)) {
    throw new Error(
      "ligis.gate requirements must include { subject, capability, priceSmallestUnit, payTo, payment?, issuer? }",
    );
  }

  // Jev intent read. Dispatched FIRST so it runs concurrently with the
  // on-chain credential read below (the adapter's Casper path shells out to
  // a synchronous CLI, so ordering matters for wall-clock latency).
  const jevConfig = opts.jevConfig ?? loadJevConfig();
  const intentPromise = evaluatePaymentIntent(
    {
      subject: parsed.subject,
      capability: parsed.capability,
      capabilityDescription: parsed.capabilityDescription,
      gatePriceSmallestUnit: parsed.priceSmallestUnit,
      tokenSymbol: parsed.tokenSymbol ?? "CSPR",
      tokenDecimals: parsed.tokenDecimals,
      advertisedPayTo: parsed.payTo,
      serviceName: "Ligis Gate (CROO)",
      serviceDescription:
        "A pre-flight trust read for agent payments: the caller is deciding whether to accept or make this payment and wants a typed intent verdict alongside an on-chain credential check.",
      payment: parsed.payment,
    },
    jevConfig,
  );

  // On-chain credential check — the source of truth, unchanged.
  const adapter = opts.adapter ?? (await loadLigisAdapter());
  const verify = await adapter.verifyCapability({
    subject: parsed.subject,
    capability: parsed.capability,
    issuer: parsed.issuer,
  });

  const intent = await intentPromise;

  return {
    deliverableType: "text",
    deliverableText: JSON.stringify(
      {
        service: "ligis.gate",
        subject: verify.subject,
        capability: verify.capability,
        capabilityHash: verify.capabilityHash,
        // The credential verdict (source of truth).
        credential: {
          capable: verify.capable,
          latest: verify.latest,
        },
        // The Jev reflex (fail-open signal).
        intent: {
          verdict: intent.verdict,
          confidence: Number(intent.confidence.toFixed(3)),
          flags: intent.flags.map((f) => ({
            id: f.id,
            label: f.label,
            confidence: Number(f.confidence.toFixed(3)),
          })),
          latencyMs: intent.latencyMs,
          model: intent.model,
          ...(intent.skippedReason
            ? { skippedReason: intent.skippedReason }
            : {}),
        },
        // Operator-facing composite: refuse when the credential fails OR the
        // intent layer confidently says stop. Both signals stay independent
        // in the payload — this field is a convenience, not the authority.
        proceed: verify.capable && intent.verdict !== "STOP" ? true : false,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  };
}
