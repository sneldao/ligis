import "server-only";

import { aggregateAsync, backendKind } from "@/lib/counters";
import { Rule } from "@/components/Rule";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Counters — Ligis",
  description: "Optional firewall counters. Privacy-light, aggregate-only.",
  robots: { index: false, follow: false },
};

/**
 * Auth gate for /admin/counters.
 * - In production (NODE_ENV === "production", no LIGIS_ADMIN_TOKEN): fails
 *   closed (403) — don't leave admin pages wide open.
 * - With LIGIS_ADMIN_TOKEN set: requires ?token= query param.
 * - Local dev (no token, dev env): open.
 * Uses query param instead of Authorization header so browsers can
 * navigate directly without CORS/preflight issues.
 */
const ADMIN_TOKEN = process.env.LIGIS_ADMIN_TOKEN ?? "";
const IS_PROD = process.env.NODE_ENV === "production";

function checkAuth(searchParams: URLSearchParams): {
  ok: boolean;
  reason?: string;
} {
  // Fail closed in production when no token is configured.
  if (IS_PROD && !ADMIN_TOKEN)
    return { ok: false, reason: "admin token not configured" };
  if (!ADMIN_TOKEN) return { ok: true };
  const token = searchParams.get("token");
  if (!token) return { ok: false, reason: "missing token" };
  if (token !== ADMIN_TOKEN) return { ok: false, reason: "invalid token" };
  return { ok: true };
}

/**
 * `/admin/counters` — operator surface for the privacy-light counters
 * (Phase 6 measurement). Reads the JSONL file written by `lib/counters.ts`
 * and renders one tile per category. Not linked from anywhere except ⌘K
 * ("admin") — keep it that way so visitors don't end up here by accident.
 *
 * The tile labels match the four signals the plan cares about:
 *   - hero CTA clicks (where the wedge is discovered)
 *   - gate runs (preset vs custom)
 *   - share-link opens (operator / audit flows)
 *   - /api/gate calls (the one north-star number)
 */
function tile(label: string, value: number, hint?: string) {
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </p>
      <p className="font-sans text-5xl font-medium tabular text-ink">{value}</p>
      {hint ? (
        <p className="font-serif text-sm italic text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

export default async function CountersPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  // Auth gate: when LIGIS_ADMIN_TOKEN is set, require ?token= query param.
  // Fails closed in production; silently allows in local dev.
  const params = await searchParams;
  const authCheck = checkAuth(
    new URLSearchParams(params as Record<string, string>),
  );
  if (!authCheck.ok) {
    return (
      <main className="route-shell max-w-3xl">
        <header className="route-header text-xs">
          <p className="eyebrow">Ligis · Counters</p>
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Home
          </Link>
        </header>
        <p className="mt-20 font-serif text-xl text-revoke">
          Unauthorized — pass ?token= to access.
        </p>
      </main>
    );
  }

  const counts = await aggregateAsync();
  const backend = backendKind();

  const heroTotal =
    (counts["hero:gate"] ?? 0) +
    (counts["hero:arena"] ?? 0) +
    (counts["hero:proofs"] ?? 0);
  const heroByCta = {
    gate: counts["hero:gate"] ?? 0,
    arena: counts["hero:arena"] ?? 0,
    proofs: counts["hero:proofs"] ?? 0,
  };

  const gateRuns =
    (counts["gate:preset:legit"] ?? 0) +
    (counts["gate:preset:overpay"] ?? 0) +
    (counts["gate:preset:injected"] ?? 0) +
    (counts["gate:custom"] ?? 0);
  const gateByPreset = {
    legit: counts["gate:preset:legit"] ?? 0,
    overpay: counts["gate:preset:overpay"] ?? 0,
    injected: counts["gate:preset:injected"] ?? 0,
    custom: counts["gate:custom"] ?? 0,
  };

  const shareOpens = (counts["share:gate"] ?? 0) + (counts["share:arena"] ?? 0);

  const apiCalls =
    (counts["api:go"] ?? 0) +
    (counts["api:stop"] ?? 0) +
    (counts["api:unknown"] ?? 0) +
    (counts["api:error"] ?? 0);
  const apiByVerdict = {
    go: counts["api:go"] ?? 0,
    stop: counts["api:stop"] ?? 0,
    unknown: counts["api:unknown"] ?? 0,
    error: counts["api:error"] ?? 0,
  };

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Counters</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-14 sm:mt-20">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Privacy-light counters.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Aggregate-only counts of which CTAs were clicked, which gate branches
          visitors tried, and how often the API was called. No payee, amount,
          IP, user agent, or referrer is logged &mdash; only the fixed bucket
          id. Read from{" "}
          {backend === "upstash" ? (
            <span>
              Upstash KV (
              <code className="font-mono text-ink">ligis:counters</code>
              ); file fallback at{" "}
              <code className="font-mono text-ink">
                ~/.ligis/counters.jsonl
              </code>
            </span>
          ) : (
            <span>
              <code className="font-mono text-ink">
                ~/.ligis/counters.jsonl
              </code>
              {process.env.VERCEL ? (
                <>
                  {" "}
                  (ephemeral on Vercel &mdash; set{" "}
                  <code className="font-mono text-ink">
                    KV_REST_API_URL
                  </code> +{" "}
                  <code className="font-mono text-ink">KV_REST_API_TOKEN</code>{" "}
                  for durable counts)
                </>
              ) : null}
            </span>
          )}
          ; this page is a reader, not a writer.
        </p>
      </section>

      <Rule className="mt-14" />

      <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2">
        {tile(
          "Hero CTA clicks",
          heroTotal,
          `${heroByCta.gate} gate · ${heroByCta.arena} arena · ${heroByCta.proofs} proofs`,
        )}
        {tile(
          "Gate runs",
          gateRuns,
          `${gateByPreset.legit} legit · ${gateByPreset.overpay} overpay · ${gateByPreset.injected} injected · ${gateByPreset.custom} custom`,
        )}
        {tile(
          "Share-link opens",
          shareOpens,
          "share links that re-ran the gate",
        )}
        {tile(
          "/api/gate calls",
          apiCalls,
          `${apiByVerdict.go} GO · ${apiByVerdict.stop} STOP · ${apiByVerdict.unknown} UNKNOWN · ${apiByVerdict.error} error`,
        )}
      </div>

      <Rule className="mt-14" />

      <p className="mt-10 max-w-prose font-serif text-base leading-relaxed text-ink-quiet">
        The <span className="font-mono text-ink">/api/gate</span> count is the
        plan&rsquo;s north-star number. A week-over-week rise in the STOP share,
        with a flat API count, means the gate is being reused on more decisions
        per agent &mdash; the right direction.
      </p>
    </main>
  );
}
