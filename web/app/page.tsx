import Link from "next/link";
import { CatalogHero } from "@/components/catalog/CatalogHero";
import { ChainSelector } from "@/components/ChainSelector";
import { ChainBadge } from "@/components/ChainBadge";
import { Diagram } from "@/components/Diagram";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { StewardTeaser } from "@/components/StewardTeaser";
import { VerifyDemo } from "@/components/VerifyDemo";
import { capabilities, addresses } from "@/lib/chain";
import { readBlockNumber, readTotalSupply, isCasperChain } from "@/lib/chain-router";
import { getChain, type ChainNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

const SNIPPET = `import { readContract } from "viem";

// One on-chain read. No SDK. Any contract or skill can do this.
const ok = await readContract({
  address: credentialRegistry,
  abi: CREDENTIAL_REGISTRY_ABI,
  functionName: "isCapable",
  args: [subject, capabilityHash],
});`;

async function liveStats(chain: ChainNetwork) {
  if (!chain.live) {
    return { ok: false as const, preview: true as const };
  }
  try {
    const [supply, block] = await Promise.all([
      readTotalSupply(chain),
      readBlockNumber(chain),
    ]);
    return { supply: Number(supply), block: block.toString(), ok: true as const };
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
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const chain = getChain(searchParams);
  const stats = await liveStats(chain);
  const capOptions = capabilities.map((c) => ({ id: c.id, label: c.label }));
  const isCasper = isCasperChain(chain);
  const sampleSubject = isCasper
    ? "account-hash-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"
    : "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

  return (
    <>
      <CatalogHero chain={chain} />

      <StewardTeaser />

      <main id="how" className="mx-auto max-w-5xl scroll-mt-24 px-8 pt-32 pb-24 sm:pt-44 sm:pb-32">
        <header className="flex items-baseline justify-between text-xs">
          <p className="eyebrow">Ligis · how it works 00</p>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <ChainSelector activeId={chain.id} />
            <ChainBadge chain={chain} />
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
          </div>
        </header>

        <section className="mt-20">
          <h1 className="display max-w-3xl text-5xl text-ink sm:text-7xl">
            Identity and permissions
            <br />
            for AI agents, onchain.
          </h1>
          <p className="mt-12 max-w-2xl font-serif text-xl leading-relaxed text-ink-soft">
            Every other system trusts agents implicitly. Ligis lets them prove
            what they&rsquo;re allowed to do: each agent holds a portable
            identity, plus credentials that anyone can issue, anyone can
            verify, and the issuer can revoke. Two non-custodial contracts on
            Pharos. No administrator, no upgrade key, no off-chain dependency.
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
                on {chain.name.toLowerCase()}. The catalog above shows the
                live agent plus a preview set so the spatial pattern is legible
                before the index fills out.
              </>
            ) : stats.preview ? (
              <>
                <span className="not-italic text-ink-soft">
                  {chain.name}
                </span>{" "}
                is live. The steward loop and x402 payment flow are operational
                — see the{" "}
                <Link href={`/steward?chain=${chain.id}`} className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">
                  Steward page
                </Link>{" "}
                for the autonomous loop demo.
              </>
            ) : (
              <>The live index is presently unreachable. {stats.error}</>
            )}
          </p>
        </section>

        <section id="verify" className="mt-32 scroll-mt-24 sm:mt-44">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">01 · Verify</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              live · {chain.name.toLowerCase()}
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
              defaultSubject={sampleSubject}
              explorerUrl={chain.explorerUrl}
              chainId={chain.id}
            />
          </div>
        </section>

        <section id="compose" className="mt-32 scroll-mt-24 sm:mt-44">
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

        <section id="system" className="mt-32 scroll-mt-24 sm:mt-44">
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
            {isCasper ? (
              <>
                <a
                  href={`${chain.explorerUrl}/contract/${process.env.LIGIS_CASPER_AGENT_ID ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block space-y-2 py-2"
                >
                  <p className="eyebrow">AgentId (Casper)</p>
                  <Rule tone="soft" />
                  <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                    {process.env.LIGIS_CASPER_AGENT_ID ?? "not configured"}
                  </p>
                </a>
                <a
                  href={`${chain.explorerUrl}/contract/${process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block space-y-2 py-2"
                >
                  <p className="eyebrow">CredentialRegistry (Casper)</p>
                  <Rule tone="soft" />
                  <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                    {process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ?? "not configured"}
                  </p>
                </a>
              </>
            ) : (
              <>
                <a
                  href={`${chain.explorerUrl}/address/${addresses.pharosAgentId}`}
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
                  href={`${chain.explorerUrl}/address/${addresses.credentialRegistry}`}
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
              </>
            )}
          </div>
        </section>

        <section id="issue" className="mt-32 scroll-mt-24 sm:mt-44">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">04 · Issue a credential</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              cli · private key required
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[18rem_1fr]">
            <div>
              <h2 className="display text-3xl text-ink">
                Mint an identity. Sign a credential. From your terminal.
              </h2>
              <p className="mt-6 font-serif text-base leading-relaxed text-ink-soft">
                Issuing requires a private key because only the controller or
                an authorized issuer can write to the registry. The web app is
                read-only by design — no admin keys, no backend proxy. If you
                have a Pharos testnet wallet, the CLI handles everything:
              </p>
              <ul className="mt-4 space-y-2 font-serif text-sm leading-relaxed text-ink-soft">
                <li className="flex items-baseline gap-3">
                  <span className="inline-block h-1 w-1 rounded-full bg-terra" />
                  Mint a soulbound PharosAgentID to your wallet
                </li>
                <li className="flex items-baseline gap-3">
                  <span className="inline-block h-1 w-1 rounded-full bg-terra" />
                  Sign an EIP-712 credential for any capability name
                </li>
                <li className="flex items-baseline gap-3">
                  <span className="inline-block h-1 w-1 rounded-full bg-terra" />
                  Submit the attestation to CredentialRegistry
                </li>
                <li className="flex items-baseline gap-3">
                  <span className="inline-block h-1 w-1 rounded-full bg-terra" />
                  Verify it seconds later — right here in the demo above
                </li>
              </ul>
            </div>
            <div className="space-y-8">
              <div className="space-y-3">
                <p className="eyebrow">1 · Install</p>
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">
                  bash &lt;(curl -sL https://raw.githubusercontent.com/sneldao/ligis/main/install.sh)
                </pre>
              </div>
              <div className="space-y-3">
                <p className="eyebrow">2 · Mint &amp; issue</p>
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">
                  {`PRIVATE_KEY=0x... ligis issue --token-uri "ipfs://my-agent"

# sign is off-chain — only the issuer key, no PRIVATE_KEY needed
ligis sign \\
  --issuer-key 0x... \\
  --subject 0x... \\
  --capability "agent.commerce.escrow"`}
                </pre>
              </div>
              <p className="font-serif text-xs italic leading-relaxed text-ink-quiet">
                See the{" "}
                <a
                  href="https://github.com/sneldao/ligis?tab=readme-ov-file#quickstart"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  README
                </a>{" "}
                or{" "}
                <Link
                  href="/steward"
                  className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  the Steward page
                </Link>{" "}
                for the full walkthrough.
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet sm:mt-40">
          <span>
            Built for the Casper Agentic Buildathon + Pharos Skill cascade.
            Autonomous agents · x402 payments · RWA oracle. MIT licensed. Read{" "}
            <Link
              href="/styleguide"
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              the design system
            </Link>
            .
          </span>
          <span className="font-mono tabular">chain {chain.chainId ?? chain.chainName}</span>
        </footer>
      </main>
    </>
  );
}
