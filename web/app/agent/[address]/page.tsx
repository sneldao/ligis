import { getAddress, type Address } from "viem";
import { notFound } from "next/navigation";
import { AddressDisplay } from "@/components/AddressDisplay";
import { AgentHero } from "@/components/catalog/AgentHero";
import { ChainBadge } from "@/components/ChainBadge";
import { Rule } from "@/components/Rule";
import { ShareRow } from "@/components/ShareRow";
import { Snippet } from "@/components/Snippet";
import { capabilities } from "@/lib/chain";
import {
  readAgentSnapshot,
  readCapabilityHistory,
  isCasperChain,
} from "@/lib/chain-router";
import { getChain, type ChainNetwork } from "@/lib/network";
import { isCasperAddress } from "@/lib/chain-casper";
import { monthYear, truncateAddress, truncateHash } from "@/lib/format";
import { SITE_URL } from "@/lib/site";

type Params = { address: string };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

function normalizeForChain(raw: string, chain: ChainNetwork): string | null {
  if (isCasperChain(chain)) {
    return isCasperAddress(raw) ? raw : null;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  try {
    return getAddress(raw) as Address;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: SearchParams;
}) {
  const { address } = await params;
  const chain = getChain(await searchParams);
  const normal = normalizeForChain(address, chain);
  if (!normal) return { title: "Unknown address — Ligis" };
  return {
    title: `Agent ${truncateAddress(normal)} — Ligis`,
    description: `Identity, credentials, and evidence for agent ${normal} on ${chain.name}.`,
  };
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: SearchParams;
}) {
  const { address: raw } = await params;
  const chain = getChain(await searchParams);
  const address = normalizeForChain(raw, chain);
  if (!address) notFound();

  const isCasper = isCasperChain(chain);

  const snap = await readAgentSnapshot(chain, address);
  const heldCount = snap.held.length;

  const capMap = new Map(capabilities.map((c) => [c.hash.toLowerCase(), c.id]));
  const history = snap.exists
    ? await readCapabilityHistory(chain, address)
    : [];

  return (
    <>
      <AgentHero address={address} heldCount={heldCount} />

      <main className="mx-auto max-w-5xl px-8 pt-16 pb-16 sm:pb-24">
        <header className="flex items-baseline justify-between text-xs text-ink-quiet">
          <p className="eyebrow">
            {snap.exists ? "Agent · in the index" : "Agent · not in the index"}
          </p>
          <div className="flex items-baseline gap-6">
            <ChainBadge chain={chain} />
            <span className="font-mono tabular">
              {chain.name.toLowerCase()} · chain {chain.chainId}
            </span>
          </div>
        </header>

        <section className="mt-12">
          <h1 className="display text-5xl text-ink sm:text-[5rem]">
            {truncateAddress(address, 6, 4)}
          </h1>
          <p className="mt-8 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
            {snap.exists
              ? `Held by a single controller on ${chain.name}. Three reads from chain compose this page: ownership of the agent token, the controller, and the credential ledger.`
              : "This address has not minted an agent. It has no portable identity, no credentials, no evidence trail. To bootstrap one, use the Steward loop or the CLI."}
          </p>
          <div className="mt-10">
            <AddressDisplay address={address} variant="block" />
          </div>
        </section>

        <section className="mt-24">
          <div className="grid grid-cols-2 gap-y-6 gap-x-10 text-sm sm:grid-cols-4">
            <Fact label="status">{snap.exists ? "active" : "no agent"}</Fact>
            <Fact label="token">
              {snap.exists ? `#${snap.tokenId.toString()}` : "—"}
            </Fact>
            <Fact label="controller">
              {snap.controller ? (
                <AddressDisplay
                  address={snap.controller}
                  copy={false}
                  head={5}
                  tail={3}
                />
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="credentials held">
              <span className="font-mono tabular text-ink">{heldCount}</span>
            </Fact>
          </div>
        </section>

        <section className="mt-24">
          <header className="flex items-baseline justify-between">
            <p className="eyebrow">Credentials</p>
            <p className="font-mono text-[11px] tabular text-ink-quiet">
              scanned against {chain.name.toLowerCase()} reference set
            </p>
          </header>
          <div className="mt-6">
            <div className="hidden grid-cols-[1fr_auto_auto] items-baseline gap-x-8 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet sm:grid">
              <span>capability</span>
              <span>issuer</span>
              <span className="w-28 text-right">expires</span>
            </div>
            <Rule />
            {snap.held.length === 0 ? (
              <div className="py-12 text-center text-sm text-ink-quiet">
                <p className="font-serif text-base italic">
                  No credentials held against the reference set.
                </p>
              </div>
            ) : (
              snap.held.map(({ capability, view }) => (
                <div key={capability.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-5 text-sm sm:grid-cols-[1fr_auto_auto] sm:gap-x-8">
                    <div className="space-y-1">
                      <span className="font-mono tabular text-ink">
                        {capability.id}
                      </span>
                      <p className="font-serif text-xs italic text-ink-quiet">
                        {capability.label.toLowerCase()}
                      </p>
                    </div>
                    <span className="col-span-2 font-mono tabular text-ink-soft sm:col-span-1">
                      <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-ink-quiet sm:hidden">
                        issuer
                      </span>
                      {truncateAddress(view.issuer, 5, 3)}
                    </span>
                    <span className="w-28 text-right font-mono tabular text-ink-soft">
                      {view.expiresAt === 0n
                        ? "no expiry"
                        : view.expiresAt < BigInt(Math.floor(Date.now() / 1000))
                          ? "expired"
                          : monthYear(view.expiresAt)}
                    </span>
                  </div>
                  <Rule tone="soft" />
                </div>
              ))
            )}
          </div>
        </section>

        {snap.exists ? (
          <section className="mt-24">
            <header className="flex items-baseline justify-between">
              <p className="eyebrow">Capability history</p>
              <p className="font-mono text-[11px] tabular text-ink-quiet">
                {history.length} {history.length === 1 ? "event" : "events"} ·
                AgentCapabilityChanged
              </p>
            </header>
            <Rule className="mt-4" />
            {history.length > 0 ? (
              <div className="mt-6">
                <div className="hidden grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-8 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet sm:grid">
                  <span>capability</span>
                  <span className="w-20">status</span>
                  <span className="w-20 text-right">block</span>
                  <span className="w-32 text-right">tx</span>
                </div>
                <Rule />
                {history.slice(0, 20).map((h, i) => {
                  const capName =
                    capMap.get(h.capabilityHash.toLowerCase()) ??
                    truncateHash(h.capabilityHash, 8, 6);
                  return (
                    <div key={`${h.txHash}-${h.logIndex}-${i}`}>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-4 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:gap-x-8">
                        <span className="font-mono tabular text-ink">
                          {capName}
                        </span>
                        <span
                          className={`w-20 text-right font-mono text-[11px] uppercase tracking-[0.16em] sm:text-left ${h.capable ? "text-sage" : "text-revoke"}`}
                        >
                          {h.capable ? "gained" : "lost"}
                        </span>
                        <span className="col-span-2 font-mono tabular text-ink-soft sm:col-span-1 sm:w-20 sm:text-right">
                          <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-ink-quiet sm:hidden">
                            block
                          </span>
                          {h.blockNumber.toString()}
                        </span>
                        <span className="col-span-2 font-mono tabular text-ink-soft sm:col-span-1 sm:w-32 sm:text-right">
                          <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-ink-quiet sm:hidden">
                            tx
                          </span>
                          <a
                            href={`${chain.explorerUrl}/tx/${h.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                          >
                            {truncateHash(h.txHash, 8, 6)}
                          </a>
                        </span>
                      </div>
                      <Rule tone="soft" />
                    </div>
                  );
                })}
                {history.length > 20 ? (
                  <p className="py-4 text-center font-serif text-xs italic text-ink-quiet">
                    Showing 20 of {history.length} events.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-6 font-serif text-base italic text-ink-quiet">
                No capability changes recorded yet. Run the Steward loop or
                issue credentials via the CLI to populate this history.
              </p>
            )}
          </section>
        ) : null}

        {!snap.exists ? (
          <section className="mt-24 max-w-2xl">
            <p className="eyebrow">To mint into the index</p>
            <Rule className="mt-3" />
            <p className="mt-6 font-serif text-lg leading-relaxed text-ink">
              Run the Trust Steward against this wallet and it will mint its own
              agent token, then issue the credentials its reasoning calls for.
            </p>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
              <a
                href="/steward?chain=casper-testnet"
                className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
              >
                Watch the simulation →
              </a>
              <a
                href="https://github.com/sneldao/ligis#trust-steward-agent"
                target="_blank"
                rel="noreferrer"
                className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
              >
                Read the setup ↗
              </a>
            </div>
            <p className="mt-10 eyebrow">Or run it yourself locally</p>
            <Rule tone="soft" className="mt-2" />
            <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">
              {`PRIVATE_KEY=0x... ligis agent run \\\n  --goal "operate on Pharos as a portable agent"`}
            </pre>
          </section>
        ) : null}

        <ShareSection
          address={address}
          heldCount={heldCount}
          firstCapability={
            snap.held[0]?.capability.id ?? capabilities[0]?.id ?? "kyc.basic"
          }
          chainId={chain.id}
        />

        <footer className="mt-24 flex items-baseline justify-between text-xs">
          <a
            href="/"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
          >
            ← Return to the index
          </a>
          <a
            href={`${chain.explorerUrl}/${isCasper ? "account" : "address"}/${address}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
          >
            On {isCasper ? "cspr.live" : "PharosScan"} ↗
          </a>
        </footer>
      </main>
    </>
  );
}

function ShareSection({
  address,
  heldCount,
  firstCapability,
  chainId,
}: {
  address: string;
  heldCount: number;
  firstCapability: string;
  chainId: string;
}) {
  const url = `${SITE_URL}/agent/${address}?chain=${chainId}`;
  const heldLine =
    heldCount > 0
      ? `${heldCount} verified ${heldCount === 1 ? "capability" : "capabilities"}`
      : "verifiable identity";
  const text = `${truncateAddress(address)} · ${heldLine} on Ligis.`;

  const iframeCode = `<iframe
  src="${SITE_URL}/embed/verify?subject=${address}&capability=${firstCapability}"
  width="520" height="120"
  style="border: 0; background: transparent;"
  loading="lazy"
  title="Ligis verification badge">
</iframe>`;

  return (
    <>
      <section className="mt-24">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Share this agent</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            opengraph card included
          </p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-6 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Posting the link renders an opengraph card with the agent&rsquo;s
          generated portrait and credential count.
        </p>
        <div className="mt-6">
          <ShareRow url={url} text={text} agentAddress={address} />
        </div>
      </section>

      <section className="mt-16">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Embed verification</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            iframe · no JS
          </p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-6 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Drop this snippet into any page to render a live{" "}
          <span className="font-mono text-ink">isCapable</span> badge for{" "}
          <span className="font-mono text-ink">{firstCapability}</span>.
        </p>
        <div className="mt-6">
          <Snippet code={iframeCode} lang="html" />
        </div>
      </section>
    </>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="eyebrow">{label}</p>
      <Rule tone="soft" />
      <div className="pt-1 text-sm text-ink">{children}</div>
    </div>
  );
}
