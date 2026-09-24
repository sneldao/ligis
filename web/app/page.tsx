import Link from "next/link";
import { FieldInvite } from "@/components/catalog/FieldInvite";
import { ChainBadge } from "@/components/ChainBadge";
import { Diagram } from "@/components/Diagram";
import { GateStates } from "@/components/GateStates";
import { Rule } from "@/components/Rule";
import { SituationCast } from "@/components/SituationCast";
import { VerifyDemo } from "@/components/VerifyDemo";
import { capabilities } from "@/lib/chain";
import {
  readBlockNumber,
  readDeployment,
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
  const chainDeployment = readDeployment(chain);
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
      {/* The home route earns attention with a live check first. The rest of
          the protocol is available on intent, rather than competing with it.
          The identity field is a separate room — invited here, entered at /field. */}
      <main
        id="how"
        className="mx-auto max-w-5xl scroll-mt-24 px-5 pt-24 pb-12 sm:px-8 sm:pt-36 sm:pb-24"
      >
        <header className="flex items-baseline justify-between text-xs">
          <p className="eyebrow">
            Ligis · the trust gate for autonomous payments
          </p>
          <ChainBadge chain={chain} />
        </header>

        <section className="mt-14 sm:mt-16">
          <h1 className="display max-w-3xl text-[2.8rem] text-ink sm:text-6xl lg:text-7xl">
            Before your agent pays a stranger, gate the payment.
          </h1>
          <p className="mt-7 max-w-xl font-serif text-lg leading-relaxed text-ink-soft sm:mt-10 sm:text-xl">
            Ligis is the one on-chain read that turns &ldquo;trust this
            wallet&rdquo; into <span className="text-sage">GO</span> or{" "}
            <span className="text-revoke">STOP</span> &mdash; before money
            moves. Start from a moment you recognize, not from a capability
            name.
          </p>
          <p className="mt-5 max-w-2xl font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
            {stats.ok ? (
              Number(stats.supply) > 3 ? (
                <>
                  <span className="tabular text-ink">
                    {stats.supply.toLocaleString("en")}
                  </span>{" "}
                  verifiable agents · {chain.name} · block{" "}
                  <span className="tabular text-ink">
                    {Number(stats.block).toLocaleString("en")}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-ink">{chain.name}</span> · live registry
                  read · block{" "}
                  <span className="tabular text-ink">
                    {Number(stats.block).toLocaleString("en")}
                  </span>
                </>
              )
            ) : stats.preview ? (
              <>
                <span className="text-ink">{chain.name}</span> · live registry
                read
              </>
            ) : (
              <>Live index temporarily unreachable.</>
            )}
          </p>
        </section>

        {/* Cast the visitor into a role before the mechanism. Abstract
            "counterparty / capability" copy loses people who don't already
            live in agent commerce — named situations come first. */}
        <div className="mt-16 sm:mt-20">
          <SituationCast chainId={chain.id} />
        </div>

        <section id="verify" className="mt-16 scroll-mt-24 sm:mt-28">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">01 · The gate</p>
            <p className="font-mono text-xs tabular text-ink-quiet">
              live · {chain.name.toLowerCase()}
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-10 sm:mt-10 lg:grid-cols-[18rem_1fr] lg:gap-y-12">
            <div>
              <h2 className="display text-3xl text-ink">
                Gate it before it pays.
              </h2>
              <p className="mt-5 font-serif text-base leading-relaxed text-ink-soft sm:mt-6">
                Once you know your moment, run the same read an agent makes the
                instant before money moves. Verdict from chain state &mdash; not
                a Ligis server.
              </p>
              <p className="mt-3 font-serif text-sm italic leading-relaxed text-ink-quiet">
                One <code className="font-mono not-italic">isCapable</code>{" "}
                call, returned as{" "}
                <span className="not-italic text-sage">GO</span> or{" "}
                <span className="not-italic text-revoke">STOP</span>.
              </p>
              <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
                <Link
                  href={`/field?chain=${chain.id}&enter=1`}
                  className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                >
                  The field — live registry →
                </Link>
              </p>
            </div>
            <div className="space-y-12">
              <GateStates />
              <VerifyDemo
                capabilities={capOptions}
                defaultSubject={sampleSubject}
                explorerUrl={chain.explorerUrl}
                chainId={chain.id}
              />
            </div>
          </div>
        </section>
      </main>

      <section className="mx-auto max-w-5xl px-5 pt-8 pb-20 sm:px-8 sm:pt-16 sm:pb-32">
        <FieldInvite chainId={chain.id} />

        {/* 02 — Why it compounds. The moat, told editorially: the gate is a
            thin wedge, but every payment gated gives issuers more reason to
            mint credentials, which makes the next gate more trustworthy.
            That feedback loop is the creative monopoly — the gate becomes
            the default the moment money moves between agents. */}
        <section id="compound" className="mt-24 scroll-mt-24 sm:mt-36">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">02 · Why it compounds</p>
            <p className="hidden font-mono text-xs tabular text-ink-quiet sm:block">
              network effect · the moat
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-8 max-w-2xl sm:mt-10">
            <h2 className="display text-3xl text-ink">
              A thin wedge that grows into the default.
            </h2>
            <p className="mt-5 font-serif text-base leading-relaxed text-ink-soft">
              The gate is a single read &mdash; easy to adopt, easy to copy.
              What isn&rsquo;t easy to copy is the loop it starts. Every payment
              an agent gates is a reason for someone to issue a credential;
              every credential issued is a reason for the next agent to trust
              the gate. Issuers, agents, and payments pull one another toward a
              single standard.
            </p>
            <details className="group mt-6 border-t border-rule">
              <summary className="cursor-pointer list-none py-4 font-mono text-xs uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                <span className="group-open:hidden">Read the loop +</span>
                <span className="hidden group-open:inline">
                  Hide the loop −
                </span>
              </summary>
              <div className="border-t border-rule-soft pt-5">
                <p className="font-serif text-base leading-relaxed text-ink-soft">
                  That is the design intent: own the instant before money moves,
                  and the rest of agent identity &mdash; minting, rotation,
                  revocation, cross-chain portability &mdash; becomes the
                  infrastructure that feeds the gate rather than a product that
                  competes on its own.
                </p>
                <ol className="mt-8 space-y-3 font-serif text-base leading-relaxed text-ink-soft">
                  <li className="flex gap-4">
                    <span className="font-mono text-xs tabular text-terra pt-1.5">
                      01
                    </span>
                    <span>
                      An agent calls the gate before paying a stranger. The read
                      is free and stateless &mdash; no Ligis server in the path.
                    </span>
                  </li>
                  <li className="flex gap-4">
                    <span className="font-mono text-xs tabular text-terra pt-1.5">
                      02
                    </span>
                    <span>
                      Merchants and protocols require a credential to pass the
                      gate, so they issue one. The capability set grows with the
                      economy, not with Ligis&rsquo;s roadmap.
                    </span>
                  </li>
                  <li className="flex gap-4">
                    <span className="font-mono text-xs tabular text-terra pt-1.5">
                      03
                    </span>
                    <span>
                      More credentials mean a stranger is more likely to already
                      be verifiable, so more agents gate by default. The loop
                      closes &mdash; the gate becomes the standard the moment
                      money moves.
                    </span>
                  </li>
                </ol>
              </div>
            </details>
          </div>
        </section>

        {/* Secondary paths — full CROO / compose write-ups live on their own
            routes so the landing stays within ~two screens past the gate. */}
        <nav
          aria-label="Also"
          className="mt-20 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-rule pt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet sm:mt-28"
        >
          <span className="text-ink-quiet">Also</span>
          <Link
            href={`/croo?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            CROO · risk before you pay →
          </Link>
          <Link
            href={`/compose?chain=${chain.id}`}
            className="text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            Build the check in →
          </Link>
        </nav>

        {/* 03 — The infrastructure. Demoted; for developers who want the
            architecture, not buyers solving a payment moment. */}
        <section id="system" className="mt-20 scroll-mt-24 sm:mt-28">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">03 · The infrastructure</p>
            <p className="font-mono text-xs tabular text-ink-quiet">
              no admin · no upgrade key · no off-chain dependency
            </p>
          </header>
          <Rule className="mt-4" />
          <p className="mt-8 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">
            Identity and credentials are separate contracts. Neither needs Ligis
            online to answer a verification call.
          </p>
          <div className="mt-8">
            <Diagram className="h-auto w-full" />
          </div>
          <details className="group mt-6 border-t border-rule">
            <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
              <span className="group-open:hidden">
                Inspect deployed contracts +
              </span>
              <span className="hidden group-open:inline">
                Close contract addresses −
              </span>
            </summary>
            <div className="grid grid-cols-1 gap-8 border-t border-rule-soft py-5 sm:grid-cols-2">
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
                      {process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY ??
                        "not configured"}
                    </p>
                  </a>
                </>
              ) : (
                <>
                  <a
                    href={`${chain.explorerUrl}/address/${chainDeployment.agentIdContract}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block space-y-2 py-2"
                  >
                    <p className="eyebrow">AgentID</p>
                    <Rule tone="soft" />
                    <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                      {chainDeployment.agentIdContract}
                    </p>
                  </a>
                  <a
                    href={`${chain.explorerUrl}/address/${chainDeployment.credentialRegistry}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block space-y-2 py-2"
                  >
                    <p className="eyebrow">CredentialRegistry</p>
                    <Rule tone="soft" />
                    <p className="pt-1 font-mono text-sm tabular text-ink group-hover:text-terra">
                      {chainDeployment.credentialRegistry}
                    </p>
                  </a>
                </>
              )}
            </div>
          </details>
        </section>

        {/* 04 — Issue credentials. For issuers — secondary audience. */}
        <section id="issue" className="mt-20 scroll-mt-24 sm:mt-28">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">04 · Issue credentials</p>
            <p className="font-mono text-xs tabular text-ink-quiet">
              for issuers · cli · private key required
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-8 sm:mt-10 sm:gap-y-12 lg:grid-cols-[18rem_1fr]">
            <div>
              <h2 className="display text-3xl text-ink">
                Authorize an agent. From your terminal.
              </h2>
              <p className="mt-6 font-serif text-base leading-relaxed text-ink-soft">
                Grant a credential that any agent can verify. Issuance stays in
                the CLI because only a controller or authorized issuer can sign.
              </p>
              <Link
                href={`/issuers?chain=${chain.id}`}
                className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.16em] text-ink underline decoration-rule underline-offset-4 hover:decoration-terra"
              >
                Open issuer guide →
              </Link>
            </div>
            <details className="group border-y border-rule">
              <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                <span className="group-open:hidden">Show CLI quickstart +</span>
                <span className="hidden group-open:inline">
                  Hide CLI quickstart −
                </span>
              </summary>
              <div className="space-y-6 border-t border-rule-soft py-5">
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">
                  {
                    "bash <(curl -sL https://raw.githubusercontent.com/sneldao/ligis/main/install.sh)"
                  }
                </pre>
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">{`PRIVATE_KEY=0x... ligis issue --token-uri "ipfs://my-agent"

# sign is off-chain — only the issuer key, no PRIVATE_KEY needed
ligis sign \\
  --issuer-key 0x... \\
  --subject 0x... \\
  --capability "agent.commerce.escrow"`}</pre>
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
                  for the full walkthrough.
                </p>
              </div>
            </details>
          </div>
        </section>

        <footer className="mt-24 flex flex-col gap-4 border-t border-rule pt-5 text-xs text-ink-quiet sm:mt-32 sm:flex-row sm:items-baseline sm:justify-between">
          <span className="flex flex-wrap items-baseline gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em]">
            <Link
              href={`/steward?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Steward
            </Link>
            <Link
              href={`/capabilities?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Capabilities
            </Link>
            <Link
              href={`/issuers?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Issuers
            </Link>
            <Link
              href={`/croo?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              CROO
            </Link>
            <Link
              href={`/compose?chain=${chain.id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Compose
            </Link>
            <Link
              href="/embed"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Embed
            </Link>
            <Link
              href="/styleguide"
              className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              Design
            </Link>
          </span>
          <span className="font-mono tabular">
            chain {chain.chainId ?? chain.chainName}
          </span>
        </footer>
      </section>
    </>
  );
}
