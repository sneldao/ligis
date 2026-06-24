import Link from "next/link";
import { CatalogHero } from "@/components/catalog/CatalogHero";
import { Diagram } from "@/components/Diagram";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { VerifyDemo } from "@/components/VerifyDemo";
import {
  addresses,
  capabilities,
  network,
  readBlockNumber,
  readTotalSupply,
} from "@/lib/chain";

export const dynamic = "force-dynamic";

const SAMPLE_SUBJECT = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

const SNIPPET = `import { readContract } from "viem";

// One on-chain read. No SDK. Any contract or skill can do this.
const ok = await readContract({
  address: credentialRegistry,
  abi: CREDENTIAL_REGISTRY_ABI,
  functionName: "isCapable",
  args: [subject, capabilityHash],
});`;

async function liveStats() {
  try {
    const [supply, block] = await Promise.all([readTotalSupply(), readBlockNumber()]);
    return { supply: Number(supply), block: block.toString(), ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function HomePage() {
  const stats = await liveStats();
  const capOptions = capabilities.map((c) => ({ id: c.id, label: c.label }));

  return (
    <>
      <CatalogHero />

      <main className="mx-auto max-w-5xl px-8 pt-32 pb-24 sm:pt-44 sm:pb-32">
        <header className="flex items-baseline justify-between text-xs">
          <p className="eyebrow">Ligis · spec sheet 00</p>
          <nav className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm text-ink-soft">
            <Link
              href="/capabilities"
              className="hover:text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Capabilities
            </Link>
            <Link
              href="/issuers"
              className="hover:text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Issuers
            </Link>
            <Link
              href="/steward"
              className="hover:text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Steward
            </Link>
            <Link
              href="/embed"
              className="hover:text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Embed
            </Link>
            <a
              href="https://github.com/sneldao/ligis"
              className="hover:text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
            >
              Source
            </a>
          </nav>
        </header>

        <section className="mt-20">
          <h1 className="display max-w-3xl text-5xl text-ink sm:text-7xl">
            Trust, made
            <br />
            portable.
          </h1>
          <p className="mt-12 max-w-2xl font-serif text-xl leading-relaxed text-ink-soft">
            The catalog above is the product. Each tile is an agent that can
            hold portable identity and verifiable credentials, issued and
            revoked on Pharos through two non-custodial contracts. No
            administrator, no upgrade key, no off-chain dependency.
          </p>
          <p className="mt-6 max-w-2xl font-serif text-base italic leading-relaxed text-ink-quiet">
            {stats.ok ? (
              <>
                <span className="font-mono not-italic tabular text-ink">
                  {stats.supply.toLocaleString("en")}
                </span>{" "}
                {stats.supply === 1 ? "agent is" : "agents are"} presently in the
                live index, counted at block{" "}
                <span className="font-mono not-italic tabular text-ink">
                  {Number(stats.block).toLocaleString("en")}
                </span>{" "}
                on {network.name.toLowerCase()}. The catalog above shows the
                live agent plus a preview set so the spatial pattern is legible
                before the index fills out.
              </>
            ) : (
              <>The live index is presently unreachable. {stats.error}</>
            )}
          </p>
        </section>

        <section className="mt-32 sm:mt-44">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">01 · Verify</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              live · {network.name.toLowerCase()}
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[18rem_1fr]">
            <div>
              <h2 className="display text-3xl text-ink">
                Ask the chain a single question.
              </h2>
              <p className="mt-6 font-serif text-base leading-relaxed text-ink-soft">
                Pick a wallet. Pick a capability. The registry answers from chain
                state, signed by a real issuer, in one call.
              </p>
            </div>
            <VerifyDemo
              capabilities={capOptions}
              defaultSubject={SAMPLE_SUBJECT}
              explorerUrl={network.explorerUrl}
            />
          </div>
        </section>

        <section className="mt-32 sm:mt-44">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">02 · Compose</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              viem · ethers · cast · any caller
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[18rem_1fr]">
            <div>
              <h2 className="display text-3xl text-ink">
                One read. Drop it anywhere.
              </h2>
              <p className="mt-6 font-serif text-base leading-relaxed text-ink-soft">
                Other skills and contracts compose Ligis by calling{" "}
                <code className="font-mono text-ink">isCapable</code>. No SDK,
                no oracle, no off-chain service. The credentials registry stands
                alone, with no dependency on the identity contract.
              </p>
            </div>
            <Snippet code={SNIPPET} />
          </div>
        </section>

        <section className="mt-32 sm:mt-44">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">03 · The system</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              no admin · no upgrade key
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-10">
            <Diagram className="h-auto w-full" />
          </div>
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
            <a
              href={`${network.explorerUrl}/address/${addresses.pharosAgentId}`}
              target="_blank"
              rel="noreferrer"
              className="group block space-y-2 py-2"
            >
              <p className="eyebrow">PharosAgentID</p>
              <Rule tone="soft" />
              <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                {addresses.pharosAgentId}
              </p>
            </a>
            <a
              href={`${network.explorerUrl}/address/${addresses.credentialRegistry}`}
              target="_blank"
              rel="noreferrer"
              className="group block space-y-2 py-2"
            >
              <p className="eyebrow">CredentialRegistry</p>
              <Rule tone="soft" />
              <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                {addresses.credentialRegistry}
              </p>
            </a>
          </div>
        </section>

        <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet sm:mt-40">
          <span>
            Built for the Pharos Skill cascade. MIT licensed. Read{" "}
            <Link
              href="/styleguide"
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              the design system
            </Link>
            .
          </span>
          <span className="font-mono tabular">chain {network.chainId}</span>
        </footer>
      </main>
    </>
  );
}
