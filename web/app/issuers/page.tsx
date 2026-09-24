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

function historyMeta(log: Awaited<ReturnType<typeof readIssuerActivity>>): {
  lead: string;
  range: string | null;
} {
  if (log.unavailable) {
    return {
      lead: `History could not be read on ${log.source === "none" ? "this chain" : "the configured indexer"} — this list is unknown, not empty.`,
      range: null,
    };
  }

  const countLead =
    log.issuers.length === 0
      ? "No issuances detected yet."
      : `${log.issuers.length} ${log.issuers.length === 1 ? "issuer has" : "issuers have"} vouched, ${log.totalIssuances} ${log.totalIssuances === 1 ? "credential" : "credentials"} signed.`;

  if (log.source === "envio") {
    return {
      lead: `${countLead} Full history via Envio HyperIndex.`,
      range:
        log.blockRange.from > 0n
          ? `Blocks ${log.blockRange.from.toString()} → ${log.blockRange.to.toString()}${log.truncated ? " · latest 500 issuances" : ""}.`
          : null,
    };
  }

  return {
    lead: countLead,
    range: log.truncated
      ? `Recent public-RPC window · blocks ${log.blockRange.from.toString()} → ${log.blockRange.to.toString()}.`
      : log.blockRange.from > 0n
        ? `Blocks ${log.blockRange.from.toString()} → ${log.blockRange.to.toString()}.`
        : null,
  };
}

export default async function IssuersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const chain = getChain(await searchParams);

  let log;
  try {
    log = await readIssuerActivity(chain);
  } catch {
    return (
      <main className="route-shell max-w-5xl">
        <header className="route-header text-xs">
          <p className="eyebrow">Ligis · Issuers</p>
          <div className="flex items-baseline gap-6">
            <ChainBadge chain={chain} />
            <Link
              href={`/?chain=${chain.id}`}
              className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              ← Home
            </Link>
          </div>
        </header>

        <section className="mt-14 max-w-3xl sm:mt-20">
          <h1 className="display text-5xl text-ink sm:text-6xl">
            Unable to load
            <br />
            issuers.
          </h1>
          <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
            The chain RPC is temporarily unavailable. Please try again in a
            moment.
          </p>
        </section>
      </main>
    );
  }
  const top = log.issuers.slice(0, 50);
  const meta = historyMeta(log);
  const chainQs = `?chain=${chain.id}`;

  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · Issuers</p>
        <div className="flex items-baseline gap-6">
          <ChainBadge chain={chain} />
          <Link
            href={`/${chainQs}`}
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Home
          </Link>
        </div>
      </header>

      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Who vouches
          <br />
          for agents.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Issuers are the parties who sign an agent&rsquo;s credentials. Their
          signatures make a claim independently verifiable by any caller.
        </p>
        <p className="mt-4 max-w-prose font-serif text-sm italic leading-relaxed text-ink-quiet">
          {meta.lead}
          {meta.range ? ` ${meta.range}` : null}
        </p>
      </section>

      <section className="mt-16 max-w-5xl space-y-0 sm:mt-20">
        <div className="hidden grid-cols-[2rem_1fr_auto_auto] items-baseline gap-x-8 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet sm:grid">
          <span>#</span>
          <span>issuer</span>
          <span>vouched</span>
          <span className="w-32 text-right">last seen at block</span>
        </div>
        <Rule />
        {top.length === 0 ? (
          <div className="max-w-xl py-12 sm:py-16">
            <p className="display text-2xl text-ink">
              {log.unavailable
                ? "Issuer history could not be read."
                : "No issuers in this scan yet."}
            </p>
            <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
              {log.unavailable
                ? chain.id === "monad-testnet"
                  ? "The gate still works: a direct credential read answers GO or STOP. History needs Envio HyperIndex — confirm LIGIS_ENVIO_GRAPHQL_URL is set for this deployment."
                  : "The gate still works on this chain: a direct credential read answers GO or STOP. History needs a log-capable RPC."
                : "An issuer is a KYC provider, compliance service, or protocol team that can attest to what an agent is allowed to do."}
            </p>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
              <Link
                href={`/steward${chainQs}`}
                className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
              >
                Run the steward →
              </Link>
              <a
                href="https://github.com/sneldao/ligis/tree/main/packages/envio-indexer"
                target="_blank"
                rel="noreferrer"
                className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                Envio indexer ↗
              </a>
            </div>
          </div>
        ) : (
          top.map((entry, i) => (
            <div key={entry.issuer}>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-4 text-sm sm:grid-cols-[2rem_1fr_auto_auto] sm:gap-x-8">
                <span className="font-mono tabular text-ink-quiet">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <a
                    href={`${chain.explorerUrl}/address/${entry.issuer}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block transition-colors hover:text-terra"
                  >
                    <AddressDisplay
                      address={entry.issuer}
                      copy={false}
                      head={6}
                      tail={4}
                    />
                  </a>
                  <p className="mt-1 font-mono text-xs tabular text-ink-quiet sm:hidden">
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

      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
        <Link
          href={`/${chainQs}`}
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        <span className="font-mono tabular">
          {chain.name.toLowerCase()} · chain {chain.chainId ?? chain.chainName}
          {log.source === "envio" ? " · envio" : null}
        </span>
      </footer>
    </main>
  );
}
