import Link from "next/link";
import { FieldInvite } from "@/components/catalog/FieldInvite";
import { ChainBadge } from "@/components/ChainBadge";
import { LandingGate } from "@/components/LandingGate";
import { HeroStage } from "@/components/landing/HeroStage";
import { LiveDot } from "@/components/LiveDot";
import { Rule } from "@/components/Rule";
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
  // The page is force-dynamic and awaits this before first paint, so the
  // reads get a tight budget: a slow public RPC degrades the stats line to
  // "temporarily unreachable" instead of holding the hero for the viem
  // transport's full 20s timeout.
  const budget = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("live stats timeout")), 3_500),
      ),
    ]);
  try {
    const [supply, block] = await Promise.all([
      budget(readTotalSupply(chain)),
      budget(readBlockNumber(chain)),
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
              "A spend firewall for AI agents: every payment is checked against the job before money moves. Right payee, right amount, in scope, plus a verified-payee credential read.",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Web",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            creator: { "@type": "Organization", name: "sneldao" },
          }),
        }}
      />
      <main>
        <HeroStage />
        <div className="mx-auto max-w-5xl px-5 pt-16 pb-12 sm:px-8 sm:pt-24 sm:pb-20">
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
              capabilities={capOptions}
              defaultSubject={sampleSubject}
            />
          </div>
        </div>

        <section
          aria-label="Developer integration"
          className="mx-auto max-w-5xl px-5 pt-4 pb-16 sm:px-8 sm:pt-8 sm:pb-20"
        >
          <div className="mb-16 sm:mb-20">
            <Rule />
            <div className="mt-8 grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,16rem)_1fr]">
              <p className="eyebrow">Ship it</p>
              <div>
                <p className="font-serif text-base leading-relaxed text-ink-soft sm:text-lg">
                  Gate your endpoint — the same read, one line into the payment
                  path. Any client, any agent framework. The verdict header (
                  <code className="font-mono text-ink">
                    X-Ligis-Gate-Verdict
                  </code>
                  ) carries the GO/STOP answer before the body parses.
                </p>
                <pre
                  tabIndex={0}
                  aria-label="Code sample"
                  className="mt-5 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[11px] leading-relaxed tabular text-ink"
                >
                  {`curl -X POST https://ligis.vercel.app/api/gate \\
  -H 'content-type: application/json' \\
  -d '{
    "payee":      "0xabc…",
    "amountUsd":  4200,
    "purpose":    "pay for premium RWA data",
    "capability": "data.premium"
  }'
# → { "verdict": "GO", "signals": [...], "latencyMs": 720, ... }`}
                </pre>
                <p className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em]">
                  <Link
                    href="/embed"
                    className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
                  >
                    embed the badge →
                  </Link>
                  <Link
                    href={`/vouch?chain=${chain.id}`}
                    className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
                  >
                    verify a payee →
                  </Link>
                </p>
                <p className="mt-3 max-w-prose font-serif text-xs italic leading-relaxed text-ink-quiet">
                  Privacy: the gate logs only an aggregate counter of which
                  branches ran and which CTAs were clicked. No payee, amount,
                  IP, or user agent is recorded.
                </p>
              </div>
            </div>
          </div>

          <FieldInvite chainId={chain.id} />

          <nav
            aria-label="Proofs and integrations"
            className="mt-16 flex flex-wrap items-baseline gap-x-7 gap-y-3 border-t border-rule pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet sm:mt-20"
          >
            <span>Proofs &amp; integrations</span>
            <Link
              href="/proofs"
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Proofs
            </Link>
            <Link
              href="/passkey"
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Passkey
            </Link>
            <Link
              href={`/vouch?chain=${chain.id}`}
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Verify a payee
            </Link>
            <Link
              href={`/croo?chain=${chain.id}`}
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              CROO
            </Link>
            <Link
              href={`/embed?chain=${chain.id}`}
              className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Embed
            </Link>
          </nav>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-col gap-3 border-t border-rule px-5 pt-4 pb-16 text-xs text-ink-quiet sm:flex-row sm:items-baseline sm:justify-between sm:px-8 sm:pb-28">
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
    </>
  );
}
