import "server-only";

import Link from "next/link";
import { Rule } from "@/components/Rule";
import { JevTelemetry } from "@/components/JevTelemetry";
import { LiveDot } from "@/components/LiveDot";
import { aggregateAsync, backendKind } from "@/lib/counters";
import { readGateStatus, type GateStatus } from "@/lib/operator";
import { checkAdminAuth } from "@/lib/admin-auth";
import { truncateAddress } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Operator — Ligis",
  description:
    "The operator's desk: firewall state, live decisions, and the counters that prove the gate is working.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ token?: string }>;

/** Hairline label row: mono eyebrow left, mono value right. */
function row(label: string, value: React.ReactNode) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </span>
      <span className="font-mono text-sm tabular text-ink">{value}</span>
    </div>
  );
}

/** North-star counter: mono label, big sans numeral. */
function stat(label: string, value: number, tone?: string) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-rule pt-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </p>
      <p
        className={`font-sans text-4xl font-medium tabular ${tone ?? "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

function FirewallSection({ status }: { status: GateStatus }) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="eyebrow">Firewall · trust gate</p>
        <span
          className={`flex items-center gap-2 font-mono text-[11px] tabular uppercase tracking-[0.16em] ${
            status.online ? "text-sage" : "text-revoke"
          }`}
        >
          {status.online ? (
            <LiveDot />
          ) : (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-rule"
              aria-hidden
            />
          )}
          {status.online
            ? `live · ${status.gateUrl!.replace(/^https?:\/\//, "")}`
            : status.gateUrl
              ? `offline · ${status.gateUrl.replace(/^https?:\/\//, "")}`
              : "no gate url configured"}
        </span>
      </div>
      <Rule className="mt-3" />
      {!status.online ? (
        <p className="mt-4 font-serif text-base italic leading-relaxed text-ink-quiet">
          The Trust Gate is not answering. Start it with{" "}
          <code className="font-mono not-italic text-ink-soft">
            pnpm x402:dev
          </code>{" "}
          (or point{" "}
          <code className="font-mono not-italic text-ink-soft">
            NEXT_PUBLIC_LIGIS_GATE_URL
          </code>{" "}
          at the running one) and the firewall state fills in here — no
          configuration is cached, what you see is the live report.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-rule">
          {row("capability", status.capability)}
          {row("chain", status.chain)}
          {row("endpoint", status.endpoint)}
          {row("settlement", status.settlement)}
          {row(
            "price",
            `${status.price.smallestUnit} ${status.price.tokenSymbol}`.trim(),
          )}
          {row(
            "pay to",
            status.payTo ? (
              truncateAddress(status.payTo)
            ) : (
              <span className="text-ink-quiet">not set</span>
            ),
          )}
          {row(
            "intent layer",
            status.jev.enabled ? (
              <>
                on · {status.jev.model ?? "jev"}
                {status.jev.enforce ? " · enforce" : " · advisory"}
              </>
            ) : (
              <span className="text-ink-quiet">off</span>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function CountersSection({ counts }: { counts: Record<string, number> }) {
  const backend = backendKind();
  const apiCalls =
    (counts["api:go"] ?? 0) +
    (counts["api:stop"] ?? 0) +
    (counts["api:unknown"] ?? 0) +
    (counts["api:error"] ?? 0);
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="eyebrow">Counters · north star</p>
        <span className="font-mono text-[11px] tabular uppercase tracking-[0.16em] text-ink-quiet">
          backend: {backend}
          {backend === "file" ? " · ephemeral" : ""}
        </span>
      </div>
      <Rule className="mt-3" />
      <div className="mt-5 grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4">
        {stat("api · go", counts["api:go"] ?? 0, "text-sage")}
        {stat("api · stop", counts["api:stop"] ?? 0, "text-revoke")}
        {stat("api · unknown", counts["api:unknown"] ?? 0, "text-ink-quiet")}
        {stat("api · total", apiCalls)}
      </div>
      <p className="mt-6 font-serif text-sm italic text-ink-soft">
        Full breakdown — hero clicks, gate runs by preset, share-link opens —{" "}
        <Link
          href="/admin/counters"
          className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
        >
          on the counters page
        </Link>
        .
      </p>
    </section>
  );
}

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const authCheck = checkAdminAuth(
    new URLSearchParams(params as Record<string, string>),
  );
  if (!authCheck.ok) {
    return (
      <main className="route-shell max-w-3xl">
        <header className="route-header text-xs">
          <p className="eyebrow">Ligis · Operator</p>
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Home
          </Link>
        </header>
        <h1 className="mt-20 display text-3xl text-ink">Operator console</h1>
        <p className="mt-4 font-serif text-lg text-revoke" role="alert">
          You need an operator token to see this page.
        </p>
        <p className="mt-2 font-serif text-base text-ink-soft">
          Open it as{" "}
          <code className="font-mono text-sm">/operator?token=…</code> with the
          token from your deployment settings. Looking for the product?{" "}
          <Link
            href="/gate"
            className="text-ink underline decoration-terra decoration-1 underline-offset-4"
          >
            Gate a payment
          </Link>{" "}
          or try the{" "}
          <Link
            href="/zcash"
            className="text-ink underline decoration-terra decoration-1 underline-offset-4"
          >
            guided Zcash demo
          </Link>
          .
        </p>
      </main>
    );
  }

  // The gate report and the counter aggregate are independent reads — run
  // them together; neither is allowed to drag the other down.
  const [status, counts] = await Promise.all([
    readGateStatus(),
    aggregateAsync(),
  ]);

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · Operator</p>
        <Link
          href="/"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          The operator&apos;s desk.
        </h1>
        <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-ink-soft">
          Three things, in the order an operator checks them: is the firewall
          up, is it judging right now, and is it being used. All of it read live
          — nothing cached, nothing configured in this page.
        </p>
      </section>

      <div className="mt-14 space-y-14">
        <FirewallSection status={status} />
        <section>
          <JevTelemetry />
        </section>
        <CountersSection counts={counts} />
      </div>

      <Rule className="mt-16" />
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        moat route · ⌘K &rarr; operator · noindex
      </p>
    </main>
  );
}
