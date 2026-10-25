/**
 * Intent parsing for `POST /api/gate` + `GET /api/gate`.
 *
 * Pure parsing / validation with no `next/server` import, so it can be
 * unit-tested without pulling the route's Next types. The route handler
 * (`web/app/api/gate/route.ts`) delegates to these and owns the HTTP layer.
 *
 * NOTE: these must live outside `route.ts` — Next's generated route types
 * require every non-route export from that file to satisfy
 * `{ [x: string]: never }`, so exporting helpers there breaks
 * `next build` type-checking (production builds only; `tsc --noEmit`
 * passes because it doesn't apply the route-type constraint).
 */
import type { PaymentIntent } from "./decide";
import { parseMandate } from "./mandate";
import { parsePaymentAmount, type PaymentAmount } from "./payment-asset";
import { detectSubjectKind } from "./subject-format";
import { parseZkProof, type ZkProofInput } from "./zk-credential";

const HEX = /^0x[0-9a-fA-F]{40}$/;
const CASPER_ACCT = /^account-hash-[0-9a-f]{64}$/;
const CAPABILITY_RE = /^[a-z0-9._-]{1,64}$/i;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asPayee(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  if (s.length > 200) return null;
  if (HEX.test(s) || CASPER_ACCT.test(s)) return s;
  return s; // accept vendor-id strings (operator-declared payee names) too.
}

function asCapability(v: unknown): string | null {
  const s = asString(v);
  return s && CAPABILITY_RE.test(s) ? s : null;
}

const MAX_PAGE_TEXT = 100_000; // ~100 KB; matches the x402 gate's body budget.
const MAX_USD = 1e9; // $1B upper bound; payments over this want /compose, not /gate.
const MAX_PURPOSE = 1_000;
const MAX_MANDATE_PAYEES = 16;

export function bodyToIntent(
  body: Record<string, unknown>,
): PaymentIntent | string {
  const payee = asPayee(body.payee);
  if (!payee)
    return bad400(
      "payee must be an EVM address, Casper account-hash, or vendor id",
    );

  const amountUsd = asNumber(body.amountUsd);
  if (amountUsd === null) return bad400("amountUsd must be a finite number");
  if (amountUsd <= 0) return bad400("amountUsd must be > 0");
  if (amountUsd > MAX_USD) {
    return bad400(
      `amountUsd must be ≤ ${MAX_USD.toLocaleString("en")} — payments above that want /compose, not /gate`,
    );
  }

  const purpose = asString(body.purpose);
  if (!purpose) return bad400("purpose must be a non-empty string");
  if (purpose.length > MAX_PURPOSE) {
    return bad400(`purpose must be ≤ ${MAX_PURPOSE} characters`);
  }

  let capability: string | undefined;
  if (body.capability !== undefined) {
    const cap = asCapability(body.capability);
    if (cap === null) {
      return bad400(
        "capability must match /^[a-z0-9._-]{1,64}$/i (e.g. 'agent.commerce.escrow')",
      );
    }
    capability = cap;
  }

  let pageText: string | undefined;
  if (body.pageText !== undefined) {
    const txt = asString(body.pageText);
    if (txt === null) {
      return bad400("pageText must be a non-empty string when provided");
    }
    if (txt.length > MAX_PAGE_TEXT) {
      return bad400(`pageText must be ≤ ${MAX_PAGE_TEXT} characters`);
    }
    pageText = txt;
  }

  const mandateRaw = body.mandate;
  const mandateOrError = parseMandate(mandateRaw);
  if (typeof mandateOrError === "string") return bad400(mandateOrError);
  const mandate: PaymentIntent["mandate"] = mandateOrError;

  let zkProof: ZkProofInput | undefined;
  if (body.zkProof !== undefined) {
    const parsed = parseZkProof(body.zkProof);
    if (typeof parsed === "string") return bad400(parsed);
    zkProof = parsed;
  }

  const amountOrError = parseIntentAmount(payee, amountUsd, {
    tokenSymbol: body.tokenSymbol,
    chainId: body.chainId,
    amountBaseUnits: body.amountBaseUnits,
  });
  if (typeof amountOrError === "string") return bad400(amountOrError);

  return {
    payee,
    amountUsd,
    purpose,
    mandate,
    capability,
    pageText: pageText ?? undefined,
    ...(zkProof ? { zkProof } : {}),
    ...amountOrError,
  };
}

/**
 * Parse the token leg and check it against the payee format: a ZEC payment
 * must not target an EVM/Casper address, and USDC must not target a Zcash
 * shielded address. Vendor ids (unknown format) are accepted on either rail.
 */
function parseIntentAmount(
  payee: string,
  amountUsd: number,
  raw: { tokenSymbol?: unknown; chainId?: unknown; amountBaseUnits?: unknown },
): PaymentAmount | string {
  const amount = parsePaymentAmount(raw, amountUsd);
  if (typeof amount === "string") return amount;
  const kind = detectSubjectKind(payee);
  if (amount.tokenSymbol === "ZEC" && (kind === "evm" || kind === "casper")) {
    return `ZEC payments need a Zcash shielded payee, got a ${kind} address`;
  }
  // Only an explicit USDC claim is rejected for a shielded payee; legacy
  // amountUsd-only requests keep their pre-typing behaviour.
  if (
    amount.tokenSymbol === "USDC" &&
    kind === "zcash" &&
    raw.tokenSymbol !== undefined
  ) {
    return "USDC payments cannot target a Zcash shielded address";
  }
  return amount;
}

export function queryToIntent(
  payee: string | null,
  amountUsd: string | null,
  purpose: string | null,
  capability: string | null,
  mandateRaw?: {
    mandatePayees?: string | null;
    mandateMaxUsd?: string | null;
    mandateExpectedUsd?: string | null;
  },
  amountRaw?: {
    tokenSymbol?: string | null;
    chainId?: string | null;
    amountBaseUnits?: string | null;
  },
): PaymentIntent | string {
  const p = asPayee(payee);
  if (!p)
    return bad400(
      "payee must be an EVM address, Casper account-hash, or vendor id",
    );
  const n = amountUsd === null ? null : Number(amountUsd);
  if (n === null || !Number.isFinite(n) || n <= 0 || n > MAX_USD) {
    return bad400(
      `amountUsd must be a finite number in (0, ${MAX_USD.toLocaleString("en")}]`,
    );
  }
  const pur = asString(purpose);
  if (!pur) return bad400("purpose must be a non-empty string");
  if (pur.length > MAX_PURPOSE) {
    return bad400(`purpose must be ≤ ${MAX_PURPOSE} characters`);
  }
  let cap: string | undefined;
  if (capability !== null) {
    const parsed = asCapability(capability);
    if (parsed === null) {
      return bad400(
        "capability must match /^[a-z0-9._-]{1,64}$/i (e.g. 'agent.commerce.escrow')",
      );
    }
    cap = parsed;
  }
  let mandate: PaymentIntent["mandate"];
  if (mandateRaw) {
    const raw: Record<string, unknown> = {};
    if (mandateRaw.mandatePayees != null) {
      raw.payees = mandateRaw.mandatePayees
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (mandateRaw.mandateMaxUsd != null) {
      const m = Number(mandateRaw.mandateMaxUsd);
      raw.maxUsd = Number.isFinite(m) ? m : mandateRaw.mandateMaxUsd;
    }
    if (mandateRaw.mandateExpectedUsd != null) {
      const e = Number(mandateRaw.mandateExpectedUsd);
      raw.expectedUsd = Number.isFinite(e) ? e : mandateRaw.mandateExpectedUsd;
    }
    const parsed = parseMandate(raw);
    if (typeof parsed === "string") return bad400(parsed);
    mandate = parsed;
  }
  const amountOrError = parseIntentAmount(p, n, {
    tokenSymbol: amountRaw?.tokenSymbol ?? undefined,
    chainId: amountRaw?.chainId ?? undefined,
    amountBaseUnits: amountRaw?.amountBaseUnits ?? undefined,
  });
  if (typeof amountOrError === "string") return bad400(amountOrError);
  return {
    payee: p,
    amountUsd: n,
    purpose: pur,
    capability: cap,
    mandate,
    ...amountOrError,
  };
}

export function bad400(message: string): string {
  // Tiny helper so the bodyToIntent pipeline can early-out with a typed
  // error marker that the route handler maps to a 400. Avoids throwing.
  return `__bad_request__:${message}`;
}

export function isBadRequest(maybeError: unknown): maybeError is string {
  return (
    typeof maybeError === "string" && maybeError.startsWith("__bad_request__:")
  );
}

export function fromBadRequest(err: string): string {
  return err.slice("__bad_request__:".length);
}
