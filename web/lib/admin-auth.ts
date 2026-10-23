import "server-only";

/**
 * Auth gate for operator surfaces (/admin/counters, /operator).
 *
 * - In production (NODE_ENV === "production", no LIGIS_ADMIN_TOKEN): fails
 *   closed (403) — don't leave operator pages wide open.
 * - With LIGIS_ADMIN_TOKEN set: requires ?token= query param.
 * - Local dev (no token, dev env): open.
 *
 * Uses a query param instead of an Authorization header so browsers can
 * navigate directly without CORS/preflight issues. Single source of truth
 * for the rule — every operator surface calls this.
 */
const ADMIN_TOKEN = process.env.LIGIS_ADMIN_TOKEN ?? "";
const IS_PROD = process.env.NODE_ENV === "production";

export function checkAdminAuth(searchParams: URLSearchParams): {
  ok: boolean;
  reason?: string;
} {
  if (IS_PROD && !ADMIN_TOKEN)
    return { ok: false, reason: "admin token not configured" };
  if (!ADMIN_TOKEN) return { ok: true };
  const token = searchParams.get("token");
  if (!token) return { ok: false, reason: "missing token" };
  if (token !== ADMIN_TOKEN) return { ok: false, reason: "invalid token" };
  return { ok: true };
}
