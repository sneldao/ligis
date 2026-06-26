import Link from "next/link";
import { AddressDisplay } from "@/components/AddressDisplay";
import { ChainSelector } from "@/components/ChainSelector";
import { Rule } from "@/components/Rule";
import { network, readIssuerActivity } from "@/lib/chain";
import { getChain } from "@/lib/network";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata = {
  title: "Issuers — Ligis",
  description: "Addresses that have signed credentials onto Ligis.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IssuersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const chain = getChain(await searchParams);

  // Non-live chains get a preview notice.
  if (!chain.live) {
    return (
      <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
        <header className="flex items-baseline justify-between text-xs">
          <p className="eyebrow">Ligis · issuers 00</p>
          <ChainSelector activeId={chain.id} />
        </header>
        <section className="mt-20">
          <h1 className="display text-5xl text-ink sm:text-6xl">Issuers.</h1>
          <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
            {chain.name} is not yet live. Issuer activity will appear here once
            the Casper contracts are deployed. Switch to Pharos Atlantic for
            live issuer data.
          </p>
        </section>
      </main>
    );
  }

  const log = await readIssuerActivity();
  const top = log.issuers.slice(0, 50);

  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · issuers 00</p>
        <div className="flex items-baseline gap-6">
          <ChainSelector activeId={chain.id} />
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Index
          </Link>
        </div>
      </header>

      <section className="mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Who has signed.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Issuance is permissionless. Anyone can sign a credential and submit
          it. The page below counts the addresses that have done so on{" "}
          {network.name.toLowerCase()} and ranks them by the number of
          credentials they have signed.
        </p>
        <p className="mt-6 max-w-prose font-serif text-base italic leading-relaxed text-ink-quiet">
          {log.issuers.length === 0
            ? "No issuances detected in the scanned range yet."
            : `${log.issuers.length} addresses, ${log.totalIssuances} credentials signed.`}{" "}
          {log.truncated
            ? `Scanned blocks ${log.blockRange.from.toString()} → ${log.blockRange.to.toString()}.`
            : null}
        </p>
      </section>

      <section className="mt-20 space-y-0">
        <div className="grid grid-cols-[2rem_1fr_auto_auto] items-baseline gap-x-8 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          <span>#</span>
          <span>issuer</span>
          <span>signed</span>
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
              <div className="grid grid-cols-[2rem_1fr_auto_auto] items-baseline gap-x-8 py-4 text-sm">
                <span className="font-mono tabular text-ink-quiet">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <AddressDisplay address={entry.issuer} copy={false} head={6} tail={4} />
                <span className="font-mono tabular text-ink">
                  {entry.count.toLocaleString("en")}
                </span>
                <span className="w-32 text-right font-mono tabular text-ink-soft">
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
          {network.name.toLowerCase()} · chain {network.chainId}
        </span>
      </footer>
    </main>
  );
}
