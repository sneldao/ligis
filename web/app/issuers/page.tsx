import Link from "next/link";
import { AddressDisplay } from "@/components/AddressDisplay";
import { ChainBadge } from "@/components/ChainBadge";
import { Rule } from "@/components/Rule";
import { readIssuerActivity } from "@/lib/chain-router";
import { getChain } from "@/lib/network";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata = {
  title: "Issuers — Ligis",
  description:
    "Who vouches for agents. Every credential is signed by an issuer — the one saying 'I checked this agent, and it's authorized.' These are the addresses that have vouched on chain.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IssuersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const chain = getChain(await searchParams);

  const log = await readIssuerActivity(chain);
  const top = log.issuers.slice(0, 50);

  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · who vouches for agents</p>
        <div className="flex items-baseline gap-6">
          <ChainBadge chain={chain} />
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            &larr; Index
          </Link>
        </div>
      </header>

      <section className="mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Who vouches
          <br />
          for agents.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Every credential is signed by an issuer. The issuer is the one
          vouching &mdash; saying &ldquo;I checked this agent, and it&rsquo;s
          authorized to do X.&rdquo; When you run a risk check, the report shows
          who issued each credential. If all credentials come from one issuer,
          that&rsquo;s concentration risk. These are the addresses that have
          vouched on {chain.name.toLowerCase()}.
        </p>
        <p className="mt-6 max-w-prose font-serif text-base italic leading-relaxed text-ink-quiet">
          {log.issuers.length === 0
            ? "No issuances detected in the scanned range yet."
            : `${log.issuers.length} ${log.issuers.length === 1 ? "issuer has" : "issuers have"} vouched, ${log.totalIssuances} ${log.totalIssuances === 1 ? "credential" : "credentials"} signed.`}{" "}
          {log.truncated
            ? `Scanned blocks ${log.blockRange.from.toString()} -> ${log.blockRange.to.toString()}.`
            : null}
        </p>
      </section>

      <section className="mt-20 space-y-0">
        <div className="hidden grid-cols-[2rem_1fr_auto_auto] items-baseline gap-x-8 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet sm:grid">
          <span>#</span>
          <span>issuer</span>
          <span>vouched</span>
          <span className="w-32 text-right">last seen at block</span>
        </div>
        <Rule />
        {top.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-serif text-base italic text-ink-quiet">
              Be the first.
            </p>
          </div>
        ) : (
          top.map((entry, i) => (
            <div key={entry.issuer}>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-4 text-sm sm:grid-cols-[2rem_1fr_auto_auto] sm:gap-x-8">
                <span className="font-mono tabular text-ink-quiet">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <AddressDisplay
                    address={entry.issuer}
                    copy={false}
                    head={6}
                    tail={4}
                  />
                  <p className="mt-1 font-mono text-[10px] tabular text-ink-quiet sm:hidden">
                    last seen · {entry.lastSeen.toString()}
                  </p>
                </div>
                <span className="font-mono tabular text-ink">
                  {entry.count.toLocaleString("en")}
                </span>
                <span className="hidden w-32 text-right font-mono tabular text-ink-soft sm:block">
                  {entry.lastSeen.toString()}
                </span>
              </div>
              <Rule tone="soft" />
            </div>
          ))
        )}
      </section>

      <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Return to the index
        </Link>
        <span className="font-mono tabular">
          {chain.name.toLowerCase()} · chain {chain.chainId ?? chain.chainName}
        </span>
      </footer>
    </main>
  );
}
