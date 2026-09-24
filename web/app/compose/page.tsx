import Link from "next/link";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { getChain } from "@/lib/network";

export const metadata = {
  title: "Build it in · Ligis",
  description:
    "Call isCapable from any contract, agent, or script. No Ligis account, SDK, or API key.",
};

const SNIPPET = `import { readContract } from "viem";

// One on-chain read. No SDK. Any contract or agent can do this.
const ok = await readContract({
  address: credentialRegistry,
  abi: CREDENTIAL_REGISTRY_ABI,
  functionName: "isCapable",
  args: [subject, capabilityHash],
});

if (!ok) throw new Error("Counterparty not authorized. Aborting.");`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ComposePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const chain = getChain(await searchParams);
  const home = `/?chain=${chain.id}`;

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · Build the check in</p>
        <Link
          href={home}
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          One read. Anywhere.
        </h1>
        <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-ink-soft">
          Call <code className="font-mono text-ink">isCapable</code> from any
          contract or agent. No Ligis account. Answer from chain state.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          viem · ethers · cast · any caller
        </p>
      </section>

      <section className="mt-14">
        <p className="eyebrow">Example · viem</p>
        <Rule className="mt-3" />
        <div className="mt-6">
          <Snippet code={SNIPPET} />
        </div>
      </section>

      <section className="mt-14">
        <p className="eyebrow">Next</p>
        <Rule className="mt-3" />
        <div className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
          <Link
            href={`/gate?chain=${chain.id}`}
            className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
          >
            Try the gate →
          </Link>
          <Link
            href={`/capabilities?chain=${chain.id}`}
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            Capability catalog
          </Link>
          <a
            href="https://github.com/sneldao/ligis?tab=readme-ov-file#quickstart"
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            README quickstart ↗
          </a>
        </div>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet">
        <Link
          href={home}
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Home
        </Link>
        <span className="font-mono tabular">{chain.name.toLowerCase()}</span>
      </footer>
    </main>
  );
}
