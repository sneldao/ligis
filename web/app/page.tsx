import Link from "next/link";
import { CatalogHero } from "@/components/catalog/CatalogHero";
import { HomeField } from "@/components/catalog/HomeField";
import { ChainBadge } from "@/components/ChainBadge";
import { Diagram } from "@/components/Diagram";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { VerifyDemo } from "@/components/VerifyDemo";
import { capabilities, addresses } from "@/lib/chain";
import {
  readBlockNumber,
  readTotalSupply,
  isCasperChain,
} from "@/lib/chain-router";
import { getChain, type ChainNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

const SNIPPET = `import { readContract } from "viem";

// One on-chain read. No SDK. Any contract or agent can do this.
const ok = await readContract({
  address: credentialRegistry,
  abi: CREDENTIAL_REGISTRY_ABI,
  functionName: "isCapable",
  args: [subject, capabilityHash],
});

if (!ok) throw new Error("Counterparty not authorized. Aborting.");`;

const CROO_SNIPPET = [
  'import { LigisCrooRequester } from "@ligis/croo-adapter";',
  "",
  "// Before your agent pays a stranger, ask Ligis if it's safe.",
  'const ligis = new LigisCrooRequester({ sdkKey: "croo_sk_..." });',
  "",
  'const report = await ligis.request("ligis.risk", {',
  '  subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",',
  '  capabilities: ["kyc.basic", "agent.commerce.escrow"],',
  "  minTtlSeconds: 86400, // require 24h remaining",
  "});",
  "",
  'if (report.overallVerdict === "fail") {',
  "  // Hard stop. The counterparty can't prove it's authorized.",
  '  throw new Error("Counterparty failed risk check: " + report.summary);',
  "}",
  "",
  "// report.riskScore      -> 0-100 (higher is safer)",
  "// report.breakdown      -> { capabilityWeighted, ttlHealth, ... }",
  "// report.signals        -> [{ code, detail }, ...]",
].join("\n");

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
    ? "account-hash-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"
    : "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

  return (
    <>
      {/* The home route earns attention with a live check first. The rest of
          the protocol is available on intent, rather than competing with it. */}
      <HomeField>
        <main
          id="how"
          className="pointer-events-auto mx-auto max-w-5xl scroll-mt-24 px-5 pt-24 pb-12 sm:px-8 sm:pt-36 sm:pb-24"
        >
          <header className="flex items-baseline justify-between text-xs">
            <p className="eyebrow">Ligis · trust layer for autonomous agents</p>
            <ChainBadge chain={chain} />
          </header>

          <section className="mt-14 sm:mt-16">
            <h1 className="display max-w-3xl text-[2.8rem] text-ink sm:text-7xl">
              Know who your agent is about to pay.
            </h1>
            <p className="mt-7 max-w-xl font-serif text-lg leading-relaxed text-ink-soft sm:mt-10 sm:text-xl">
              Verify an agent&rsquo;s authorization on-chain before money moves.
              One read; no API, no intermediary.
            </p>
            <p className="mt-5 max-w-2xl font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet">
              {stats.ok ? (
                <>
                  <span className="tabular text-ink">
                    {stats.supply.toLocaleString("en")}
                  </span>{" "}verifiable {stats.supply === 1 ? "agent" : "agents"} · {chain.name} · block{" "}
                  <span className="tabular text-ink">
                    {Number(stats.block).toLocaleString("en")}
                  </span>
                </>
              ) : stats.preview ? (
                <>
                  <span className="text-ink">{chain.name}</span> · live registry read
                </>
              ) : (
                <>Live index temporarily unreachable.</>
              )}
            </p>
          </section>

          <section id="verify" className="mt-16 scroll-mt-24 sm:mt-28">
            <header className="flex items-baseline justify-between">
              <p className="eyebrow">01 · Is this agent authorized?</p>
              <p className="font-mono text-[11px] tabular text-ink-quiet">
                live · {chain.name.toLowerCase()}
              </p>
            </header>
            <Rule className="mt-4" />
            <div className="mt-8 grid grid-cols-1 gap-x-16 gap-y-8 sm:mt-10 sm:gap-y-12 lg:grid-cols-[18rem_1fr]">
              <div>
                <h2 className="display text-3xl text-ink">
                  Check before it acts.
                </h2>
                <p className="mt-5 font-serif text-base leading-relaxed text-ink-soft sm:mt-6">
                  Choose a wallet and a capability. The answer comes from chain
                  state, signed by the issuer.
                </p>
                <p className="mt-3 font-serif text-sm italic leading-relaxed text-ink-quiet">
                  This is the read an agent makes before sending a transaction.
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
        </main>

        {/* The catalog — 3D agent scene. A visual breather between the
          interactive verify demo and the distribution story. */}
        <section id="catalog" className="scroll-mt-24">
          <CatalogHero chain={chain} />
        </section>
      </HomeField>

      <section className="mx-auto max-w-5xl px-5 pt-20 pb-20 sm:px-8 sm:pt-32 sm:pb-32">
        <section id="croo" className="scroll-mt-24">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">02 · Counterparty risk</p>
            <p className="hidden font-mono text-[11px] tabular text-ink-quiet sm:block">CROO Agent Store · x402</p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-8 sm:mt-10">
            <h2 className="display max-w-xl text-3xl text-ink">Spend cents before you send thousands.</h2>
            <div className="mt-8 grid gap-4 border-y border-rule py-5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet sm:grid-cols-3 sm:gap-8">
              <span><b className="mr-2 font-mono font-normal text-terra">01</b>find a counterparty</span>
              <span><b className="mr-2 font-mono font-normal text-terra">02</b>check its credentials</span>
              <span><b className="mr-2 font-mono font-normal text-terra">03</b>pay or stop</span>
            </div>
            <p className="mt-6 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">
              Ask Ligis for a counterparty risk report before your agent pays. It returns a score, verdict, and the reasons behind it.
            </p>
            <details className="group mt-6 border-t border-rule">
              <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
                <span className="group-open:hidden">See CROO services, pricing &amp; integration +</span><span className="hidden group-open:inline">Close integration details −</span>
              </summary>
              <div className="border-t border-rule-soft pb-6 pt-5">
                <p className="font-serif text-sm leading-relaxed text-ink-soft"><code className="font-mono text-ink">ligis.risk</code> $0.75 · <code className="font-mono text-ink">ligis.verify</code> $0.50 · <code className="font-mono text-ink">ligis.issue</code> $1.00</p>
                <div className="mt-6"><Snippet code={CROO_SNIPPET} lang="ts" /></div>
                <p className="mt-5 max-w-2xl font-serif text-sm italic leading-relaxed text-ink-quiet">Critical capabilities count more heavily; short-lived or newly issued credentials lower confidence. A critical credential below the required TTL is a hard stop.</p>
              </div>
            </details>
          </div>
        </section>

        {/* 03 — One read. Anywhere. The composability story for
            developers who want to build the check into their own
            contracts or agents. */}
        <section id="compose" className="mt-24 scroll-mt-24 sm:mt-36">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">03 · Build the check in</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              viem · ethers · cast · any caller
            </p>
          </header>
          <Rule className="mt-4" />
          <div className="mt-8 max-w-2xl sm:mt-10">
            <h2 className="display text-3xl text-ink">One read. Anywhere.</h2>
            <p className="mt-5 font-serif text-base leading-relaxed text-ink">Call <code className="font-mono">isCapable</code> from any contract, agent, or script. No Ligis account, SDK, or API key.</p>
            <details className="group mt-6 border-y border-rule">
              <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Show the viem example +</span><span className="hidden group-open:inline">Hide the viem example −</span></summary>
              <div className="border-t border-rule-soft py-5"><Snippet code={SNIPPET} /></div>
            </details>
          </div>
        </section>

        {/* 04 — The infrastructure. Demoted from section 03 to section 04.
            This is for developers who want to understand the architecture,
            not for buyers who want to solve a problem. */}
        <section id="system" className="mt-24 scroll-mt-24 sm:mt-36">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">04 · The infrastructure</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              no admin · no upgrade key · no off-chain dependency
            </p>
          </header>
          <Rule className="mt-4" />
          <p className="mt-8 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">Identity and credentials are separate contracts. Neither needs Ligis online to answer a verification call.</p>
          <div className="mt-8">
            <Diagram className="h-auto w-full" />
          </div>
          <details className="group mt-6 border-t border-rule">
            <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Inspect deployed contracts +</span><span className="hidden group-open:inline">Close contract addresses −</span></summary>
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
          </details>
        </section>

        {/* 05 — Issue credentials. For issuers — a secondary audience.
            Demoted to the last section. */}
        <section id="issue" className="mt-24 scroll-mt-24 sm:mt-36">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">05 · Issue credentials</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
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
              <Link href="/issuers" className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.16em] text-ink underline decoration-rule underline-offset-4 hover:decoration-terra">Open issuer guide →</Link>
            </div>
            <details className="group border-y border-rule">
              <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Show CLI quickstart +</span><span className="hidden group-open:inline">Hide CLI quickstart −</span></summary>
              <div className="space-y-6 border-t border-rule-soft py-5">
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">{"bash <(curl -sL https://raw.githubusercontent.com/sneldao/ligis/main/install.sh)"}</pre>
                <pre className="overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">{`PRIVATE_KEY=0x... ligis issue --token-uri "ipfs://my-agent"

# sign is off-chain — only the issuer key, no PRIVATE_KEY needed
ligis sign \\
  --issuer-key 0x... \\
  --subject 0x... \\
  --capability "agent.commerce.escrow"`}</pre>
                <p className="font-serif text-xs italic leading-relaxed text-ink-quiet">See the <a href="https://github.com/sneldao/ligis?tab=readme-ov-file#quickstart" target="_blank" rel="noreferrer" className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">README</a> for the full walkthrough.</p>
              </div>
            </details>
          </div>
        </section>

        <footer className="mt-24 flex flex-col gap-4 border-t border-rule pt-5 text-xs text-ink-quiet sm:mt-32 sm:flex-row sm:items-baseline sm:justify-between">
          <span>MIT licensed. Read{" "}
            <Link
              href="/styleguide"
              className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              the design system
            </Link>
            .</span>
          <span className="font-mono tabular">
            chain {chain.chainId ?? chain.chainName}
          </span>
        </footer>
      </section>
    </>
  );
}
