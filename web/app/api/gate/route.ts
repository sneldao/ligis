/**
 * `POST /api/gate` + `GET /api/gate` — the Ligis pre-payment decision API.
 *
 * Spec: `docs/decide-api.md`. Single endpoint, two transports (JSON body or
 * query string) so the same shape powers a curl-on-a-server (`POST`) and a
 * shareable link (`GET`).
 *
 * Returns a `Decision` as JSON. HTTP status mirrors the verdict:
 *   - 200 OK on GO or UNKNOWN (decision returned for the caller to honor)
 *   - 200 OK on STOP (the gate says no, but the API itself answered; callers
 *     shouldn't 4xx out — a STOP is a successful read)
 *   - 400 Bad Request on malformed input
 *   - 502 Bad Gateway when the upstream chain RPC was unreachable
 *   - 504 Gateway Timeout when Jev's layer timed out
 *
 * No-store cached; this endpoint is read-only and every call must produce
 * the decision the caller asked for, not whatever was last cached.
 */
import { NextRequest, NextResponse } from "next/server";
import { decide, type PaymentIntent } from "@/lib/decide";
import { parseMandate } from "@/lib/mandate";
import type { SubjectResolution } from "@/lib/resolve";
import { resolveSubject as resolveSubjectProd } from "@/lib/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── input validation ───────────────────────────────────────────────────

const HEX = /^0x[0-9a-fA-F]{40}$/;
const CASPER_ACCT = /^account-hash-[0-9a-f]{64}$/;
const CAPABILITY_RE = /^[a-z0-9._-]{1,64}$/i;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

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

  return {
    payee,
    amountUsd,
    purpose,
    mandate,
    capability,
    pageText: pageText ?? undefined,
  };
}

function queryToIntent(
  payee: string | null,
  amountUsd: string | null,
  purpose: string | null,
  capability: string | null,
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
  return { payee: p, amountUsd: n, purpose: pur, capability: cap };
}

function bad400(message: string): string {
  // Tiny helper so the bodyToIntent pipeline can early-out with a typed
  // error marker that the route handler maps to a 400. Avoids throwing.
  return `__bad_request__:${message}`;
}

function isBadRequest(maybeError: unknown): maybeError is string {
  return (
    typeof maybeError === "string" && maybeError.startsWith("__bad_request__:")
  );
}

function fromBadRequest(err: string): string {
  return err.slice("__bad_request__:".length);
}

// ─── handlers ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body");
  }
  const intentOrError = bodyToIntent(body);
  if (isBadRequest(intentOrError)) {
    return bad(fromBadRequest(intentOrError));
  }
  const intent = intentOrError;
  return runDecide(intent);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const intentOrError = queryToIntent(
    q.get("payee"),
    q.get("amountUsd"),
    q.get("purpose"),
    q.get("capability"),
  );
  if (isBadRequest(intentOrError)) {
    return bad(fromBadRequest(intentOrError));
  }
  const intent = intentOrError;
  return runDecide(intent);
}

async function runDecide(
  intent: PaymentIntent,
  opts?: {
    resolveSubject?: (payee: string, cap: string) => Promise<SubjectResolution>;
  },
): Promise<Response> {
  const resolve = opts?.resolveSubject ?? resolveSubjectProd;
  try {
    const decision = await decide(intent, {
      resolveSubject: (payee, capability) => resolve(payee, capability),
    });
    // Privacy-light aggregate counter — verdict only, no payee / amount.
    try {
      const { record } = await import("@/lib/counters");
      const bucket =
        decision.verdict === "GO"
          ? "api:go"
          : decision.verdict === "STOP"
            ? "api:stop"
            : "api:unknown";
      record("api_call", bucket);
    } catch {
      // counters must never break the response
    }
    return NextResponse.json(decision, {
      headers: {
        "Cache-Control": "no-store",
        "X-Ligis-Gate-Verdict": decision.verdict,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return NextResponse.json(
        { error: "jev layer timed out", upstream: "jev" },
        {
          status: 504,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("RPC") ||
      msg.includes("chain")
    ) {
      return NextResponse.json(
        {
          error: "credential read failed",
          upstream: "chain",
          detail: msg.slice(0, 300),
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[/api/gate] unexpected error:", msg);
    try {
      const { record } = await import("@/lib/counters");
      record("api_call", "api:error");
    } catch {
      // ignore
    }
    return NextResponse.json(
      { error: msg.slice(0, 300) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
