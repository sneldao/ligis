import Link from "next/link";
import { Suspense } from "react";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { StewardRunner } from "@/components/StewardRunner";
import { WalletGate } from "@/components/WalletGate";
import { getChain, CASPER_TESTNET, PHAROS_ATLANTIC } from "@/lib/network";

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
  title: "The Steward — Ligis",
  description:
    "An agent that doesn't know who it is yet. Watch it mint its own identity, reason about what it needs, earn credentials, and record its journey — all autonomously on Casper or Pharos.",
};

export default async function StewardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const chain = getChain(searchParams);
  const isCasper = chain.id === CASPER_TESTNET.id;
  const defaultGoal = isCasper ? CASPER_GOAL : PHAROS_GOAL;
  const cliSnippet = isCasper ? CASPER_CLI : PHAROS_CLI;

  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · steward 00</p>
        <div className="flex items-baseline gap-6">
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
          An agent that
          <br />
          doesn&rsquo;t know
          <br />
          who it is yet.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          A goal arrives with nothing: no identity, no credentials. The
          Steward mints, reasons, gates, self-issues what is missing, then
          roots a tamper-proof manifest of every step into 0G Storage.
        </p>
        <ol className="mt-8 grid grid-cols-1 divide-y divide-rule border-t border-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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
      </section>

      {/* WalletGate — contextually-placed wallet entry point. Hidden on
          Pharos. Provides the Connect / Funded / Awaiting funding CTA
          that augments (and clarifies) the live-toggle indicator below. */}
      <section className="mt-16">
        <WalletGate />
      </section>

      <section className="mt-12">
        <Suspense fallback={<div className="font-mono text-sm text-ink-quiet">Loading steward…</div>}>
          <StewardRunner defaultGoal={defaultGoal} />
        </Suspense>
      </section>

      <section className="mt-32">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Or run it yourself</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            cli · {isCasper ? "casper" : "pharos"} · authentic
          </p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-8 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          The CLI runs the same loop against your own keys. Nothing is shared
          with this site. The output is identical JSON to the stream above.
        </p>
        <div className="mt-8">
          <Snippet code={cliSnippet} lang="sh" />
        </div>
      </section>

      <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
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
