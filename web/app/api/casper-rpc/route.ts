/**
 * Stateless CORS proxy for Casper Testnet JSON-RPC.
 *
 * The public Casper Testnet RPC at `https://node.testnet.casper.network/rpc`
 * returns 403 on browser OPTIONS preflight (verified Jul 2026) — there is
 * no CORS allow-origin. To make the browser-side wallet flow possible
 * without bringing our own CORS-friendly RPC (we don't have a CSPR.cloud
 * token we can publish to browsers), we run a stateless proxy here.
 *
 * **Crucially, this is NOT a relayer.** It does not sign, does not modify
 * payload bytes, does not custody keys, does not log request/response
 * bodies, and does not keep any client state. It accepts a JSON-RPC
 * envelope from the browser, forwards it to the public Casper RPC, and
 * returns the response unchanged. The `X-Ligis-Proxy` header is set on
 * every response to make the indirection obvious to anyone debugging.
 *
 * The user's signed deploy bodies remain in their browser; only the same
 * opaque bytes traverse this route. The trusted computing base is the
 * user's browser + the Casper Network.
 *
 * Rate-limited per client IP via a simple in-memory counter. Production
 * deployments behind Vercel/proxies should layer a real rate limiter
 * (KV-backed) and an allow-list of JSON-RPC method names.
 */
import { NextRequest, NextResponse } from "next/server";
import type { ReadableStream } from "node:stream/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET = "https://node.testnet.casper.network/rpc";

const ALLOWED_METHODS = new Set<string>([
  // reads
  "chain_get_state_root_hash",
  "chain_get_block_info",
  "chain_get_block_transfers",
  "info_get_deploy",
  "info_get_transaction",
  "state_get_item",
  "state_get_dictionary_item",
  "query_global_state",
  "state_get_balance",
  "state_get_account_info",
  "state_get_auction_info",
  // writes — the user's browser signs these client-side
  "account_put_transaction",
  // intentional: we permit legacy put_deploy if user wants it
  "account_put_deploy",
]);

const RATE_PER_MINUTE = 240;

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function checkRate(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= RATE_PER_MINUTE) return false;
  bucket.count += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const ip = clientIp(req);
  if (!checkRate(ip)) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: 429, message: "rate limited" } },
      { status: 429, headers: { "X-Ligis-Proxy": "rate-limited" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400, headers: proxyHeaders() },
    );
  }

  // Method allow-list — protects against the proxy being abused as a
  // generic forwarder for non-Casper-JSON-RPC traffic.
  const method = (body as { method?: unknown })?.method;
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (body as { id?: unknown })?.id ?? null,
        error: { code: -32601, message: `method not allowed via proxy: ${String(method)}` },
      },
      { status: 403, headers: proxyHeaders() },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(TARGET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Cache: 0 — every JSON-RPC response is stateful.
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (body as { id?: unknown })?.id ?? null,
        error: {
          code: -32603,
          message: `upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
      { status: 502, headers: proxyHeaders() },
    );
  }

  const responseText = await upstream.text();
  return new Response(responseText, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store, no-transform",
      ...proxyHeaders(),
    },
  });
}

export function GET(): Response {
  return NextResponse.json(
    {
      ok: true,
      proxy: "ligis-casper-rpc-stateless-shim",
      upstream: TARGET,
      allowed: Array.from(ALLOWED_METHODS),
    },
    { headers: proxyHeaders() },
  );
}

function proxyHeaders(): Record<string, string> {
  return {
    "X-Ligis-Proxy": "stateless-shim",
    "X-Ligis-Proxy-Upstream": TARGET,
  };
}

// Make linter happy about the Web type import (used in JSDoc above).
type _Stream = ReadableStream;
