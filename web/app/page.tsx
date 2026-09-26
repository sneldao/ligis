import Link from "next/link";
import { FieldInvite } from "@/components/catalog/FieldInvite";
import { ChainBadge } from "@/components/ChainBadge";
import { LandingGate } from "@/components/LandingGate";
import { HeroStage } from "@/components/landing/HeroStage";
import { LiveDot } from "@/components/LiveDot";
import { capabilities } from "@/lib/chain";
import {
  readBlockNumber,
  readTotalSupply,
  isCasperChain,
} from "@/lib/chain-router";
import { getChain, type ChainNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

async function liveStats(chain: ChainNetwork) {
  if (!chain.live) {
    return { ok: false as const, preview: true as const };
  }
  try {
    const [supply, block] = await Promise.all([
      readTotalSupply(chain),
      readBlockNumber(chain),
    ]);
    return {
      supply: Number(supply),
      block: block.toString(),
      ok: true as const,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const chain = getChain(await searchParams);
  const stats = await liveStats(chain);
  const capOptions = capabilities.map((c) => ({ id: c.id, label: c.label }));
  const isCasper = isCasperChain(chain);
  const sampleSubject = isCasper
    ? "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326"
    : "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Ligis",
            description:
              "Portable identity and verifiable credentials for autonomous agents. One on-chain read before money moves.",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Web",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            creator: { "@type": "Organization", name: "sneldao" },
          }),
        }}
      />
      <HeroStage />
      <main className="mx-auto max-w-5xl px-5 pt-16 pb-12 sm:px-8 sm:pt-24 sm:pb-20">
        <div>
          <header className="flex items-baseline justify-between text-xs">
            <p className="eyebrow">Try it on a live registry</p>
            <ChainBadge
              chain={chain}
              live={stats.ok || Boolean(stats.preview)}
            />
          </header>

          <section id="gate" className="mt-8 scroll-mt-28">
            <h2 className="display max-w-2xl text-4xl leading-[1.05] text-ink sm:text-5xl">
              Gate the payment.
            </h2>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
              {stats.ok ? (
                <>
                  <LiveDot className="mr-2" />
                  {Number(stats.supply) > 3 ? (
                    <>
                      <span className="tabular text-ink">
                        {stats.supply.toLocaleString("en")}
                      </span>{" "}
                      agents · {chain.name} · block{" "}
                      <span className="tabular text-ink">
                        {Number(stats.block).toLocaleString("en")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-ink">{chain.name}</span> · block{" "}
                      <span className="tabular text-ink">
                        {Number(stats.block).toLocaleString("en")}
                      </span>
                    </>
                  )}
                </>
              ) : stats.preview ? (
                <>
                  <LiveDot className="mr-2" />
                  <span className="text-ink">{chain.name}</span> · registry
                </>
              ) : (
                <>Live index temporarily unreachable.</>
              )}
            </p>
          </section>

          <div className="mt-10 sm:mt-14">
            <LandingGate
              chainId={chain.id}
              capabilities={capOptions}
              defaultSubject={sampleSubject}
              explorerUrl={chain.explorerUrl}
            />
          </div>
        </div>
      </main>

      <section className="mx-auto max-w-5xl px-5 pt-4 pb-16 sm:px-8 sm:pt-8 sm:pb-28">
        <FieldInvite chainId={chain.id} />

        <nav
          aria-label="Also"
          className="mt-16 flex flex-wrap items-baseline gap-x-7 gap-y-3 border-t border-rule pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet sm:mt-20"
        >
          <span>Also</span>
          <Link
            href={`/croo?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            CROO
          </Link>
          <Link
            href={`/compose?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Compose
          </Link>
          <Link
            href={`/issuers?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Issuers
          </Link>
          <Link
            href={`/steward?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Steward
          </Link>
          <Link
            href={`/capabilities?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Capabilities
          </Link>
          <Link
            href="/embed"
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Embed
          </Link>
        </nav>

        <footer className="mt-10 flex flex-col gap-3 border-t border-rule pt-4 text-xs text-ink-quiet sm:flex-row sm:items-baseline sm:justify-between">
          <Link
            href="/styleguide"
            className="font-mono text-[11px] uppercase tracking-[0.14em] underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            Design
          </Link>
          <span className="font-mono tabular">
            chain {chain.chainId ?? chain.chainName}
          </span>
        </footer>
      </section>
    </>
  );
}
