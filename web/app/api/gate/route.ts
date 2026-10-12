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
import {
  bodyToIntent,
  fromBadRequest,
  isBadRequest,
  queryToIntent,
} from "@/lib/gate-intent";
import { runGateDecision } from "@/lib/gate-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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
  return toResponse(await runGateDecision(intent));
}

async function toResponse(
  out:
    | { ok: true; decision: import("@/lib/decide").Decision }
    | { ok: false; status: number; body: Record<string, unknown> },
): Promise<Response> {
  if (!out.ok) {
    return NextResponse.json(out.body, {
      status: out.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(out.decision, {
    headers: {
      "Cache-Control": "no-store",
      "X-Ligis-Gate-Verdict": out.decision.verdict,
    },
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const intentOrError = queryToIntent(
    q.get("payee"),
    q.get("amountUsd"),
    q.get("purpose"),
    q.get("capability"),
    {
      mandatePayees: q.get("mandatePayees"),
      mandateMaxUsd: q.get("mandateMaxUsd"),
      mandateExpectedUsd: q.get("mandateExpectedUsd"),
    },
  );
  if (isBadRequest(intentOrError)) {
    return bad(fromBadRequest(intentOrError));
  }
  const intent = intentOrError;
  return toResponse(await runGateDecision(intent));
}
