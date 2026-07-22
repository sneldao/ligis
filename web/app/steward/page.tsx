import Link from "next/link";
import { Suspense } from "react";
import { ChainBadge } from "@/components/ChainBadge";
import { Snippet } from "@/components/Snippet";
import { StewardRunner } from "@/components/StewardRunner";
import { StewardTriptych } from "@/components/StewardTriptych";
import { WalletGate } from "@/components/WalletGate";
import { getChain, CASPER_TESTNET } from "@/lib/network";

const PHAROS_GOAL =
  "I am a Pharos agent. I need to participate in escrow-backed commerce and swap between approved venues. Figure out what credentials I need and make sure I have them.";

const CASPER_GOAL =
  "I am a Casper agent. I need to fetch premium RWA market data for tokenized real estate and pay for it via x402. Figure out what credentials I need and make sure I have them.";

const PHAROS_CLI = `# 0G wallet (one-time, see docs/setup.md)
source .env.d/zerog.env
PRIVATE_KEY=0x... bash scripts/setup-zerog.ts

# Then run the loop against any goal
PRIVATE_KEY=0x... ligis agent run \\
  --goal "Operate as a Pharos agent that participates in escrow-backed commerce."`;

const CASPER_CLI = `# Casper env (one-time, see docs/setup.md)
source .env.d/casper.env
source .env.d/zerog.env
export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY

# Run the autonomous loop on Casper Testnet
npx tsx scripts/casper-e2e-demo.ts

# Or via CLI:
ligis agent run --chain casper \\
  --goal "Fetch premium RWA market data and pay via x402"`;

export const metadata = {
  title: "Steward — Ligis",
  description:
    "Watch an agent bootstrap its own identity: mint, reason about what it needs, earn credentials, and anchor the proof on-chain. A live demo of the autonomous loop on Casper or Pharos.",
};

export const dynamic = "force-dynamic";

export default async function StewardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const chain = getChain(await searchParams);
  const isCasper = chain.id === CASPER_TESTNET.id;
  const defaultGoal = isCasper ? CASPER_GOAL : PHAROS_GOAL;
  const cliSnippet = isCasper ? CASPER_CLI : PHAROS_CLI;

  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · autonomous bootstrap demo</p>
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

      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          An agent that
          <br />
          doesn&rsquo;t know
          <br />
          who it is yet.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Give an agent a goal. It finds or mints its identity, checks what it
          can prove, fills the gaps, and records the evidence.
        </p>
        <details className="group mt-6 border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">How the loop works +</span><span className="hidden group-open:inline">Close loop details −</span></summary>
          <ol className="grid grid-cols-1 divide-y divide-rule border-t border-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <li className="space-y-2 py-4 sm:pr-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
              01 · simulated
            </p>
            <p className="font-serif text-sm leading-relaxed text-ink-soft">
              Default. No wallet, no writes.
            </p>
          </li>
          <li className="space-y-2 py-4 sm:px-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
              02 · live reads
            </p>
            <p className="font-serif text-sm leading-relaxed text-ink-soft">
              Real{" "}
              <span className="font-mono text-ink">
                {isCasper ? "isCapable" : "isCapableMulti"}
              </span>{" "}
              against the registry.
            </p>
          </li>
          <li className="space-y-2 py-4 sm:pl-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
              03 · live writes
            </p>
            <p className="font-serif text-sm leading-relaxed text-ink-soft">
              <span className="font-mono text-ink">
                {isCasper ? "mint_self" : "mintSelf"}
              </span>
              , EIP-712 self-issue, anchor via{" "}
              <span className="font-mono text-ink">
                {isCasper ? "set_token_uri" : "setTokenURI"}
              </span>
              . When{" "}
              <span className="font-mono text-ink">ZEROG_PRIVATE_KEY</span>{" "}
              is set, REASON uses 0G Compute (TEE-verified) and RECORD
              uploads to 0G Storage.{" "}
              <strong className="text-ink">Requires a funded wallet.</strong>
            </p>
          </li>
          </ol>
          <p className="py-4 font-serif text-xs italic leading-relaxed text-ink-quiet">
          Operation names follow each chain&rsquo;s convention —{" "}
          <span className="font-mono not-italic">mintSelf</span> on EVM,{" "}
          <span className="font-mono not-italic">mint_self</span> on Casper.
          Same operation, two chains.
          </p>
        </details>
      </section>

      {/* WalletGate — the wallet entry point. On Casper it carries the
          inline connect/fund action; on Pharos it nudges to Casper. */}
      <section className="mt-12 max-w-3xl sm:mt-16">
        <WalletGate />
      </section>

      {/* StewardRunner — the actual product. Primary, above the fold. */}
      <section className="mt-10">
        <Suspense fallback={
          <div className="space-y-8">
            <div className="h-[3px] w-full bg-rule" />
            <div className="space-y-3">
              <div className="h-4 w-24 bg-rule-soft" />
              <div className="h-6 w-full max-w-md bg-rule-soft" />
            </div>
            <div className="space-y-3">
              <div className="h-4 w-16 bg-rule-soft" />
              <div className="h-24 w-full bg-rule-soft" />
            </div>
          </div>
        }>
          <StewardRunner defaultGoal={defaultGoal} />
        </Suspense>
      </section>

      {/* StewardTriptych — the three-act narrative as a reflective coda
          after the loop. genesis · synthesis · stasis. Static SVG,
          one-time staggered fade-in on viewport entry, honours
          prefers-reduced-motion. */}
      <section className="mt-20 max-w-3xl sm:mt-28">
        <details className="group border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">See the three-act protocol story +</span><span className="hidden group-open:inline">Close protocol story −</span></summary>
          <div className="border-t border-rule-soft py-6"><StewardTriptych isCasper={isCasper} /></div>
        </details>
      </section>

      <section className="mt-12 max-w-3xl sm:mt-16">
        <details className="group border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Run the same loop locally +</span><span className="hidden group-open:inline">Hide CLI instructions −</span></summary>
          <div className="border-t border-rule-soft py-5"><p className="mb-6 max-w-prose font-serif text-base leading-relaxed text-ink-soft">The CLI uses your own keys. Nothing is shared with this site.</p><Snippet code={cliSnippet} lang="sh" /></div>
        </details>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Return to the index
        </Link>
        <span className="font-mono tabular">
          {chain.name.toLowerCase()}
          {chain.chainId ? ` · chain ${chain.chainId}` : ` · ${chain.chainName}`}
        </span>
      </footer>
    </main>
  );
}
