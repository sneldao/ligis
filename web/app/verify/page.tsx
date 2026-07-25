import type { Address } from "viem";
import { CHAINS, getChain, type ChainNetwork } from "@/lib/network";
import { isCasperChain } from "@/lib/chain-router";
import { verifySubject } from "@/lib/verify";
import { monthYear, truncateAddress } from "@/lib/format";
import { Rule } from "@/components/Rule";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ subject?: string; capability?: string; chain?: string }>;

export const metadata = {
  title: "Verify · Ligis",
  description:
    "Self-host verification for any agent wallet. One URL, one hash, one decision.",
  robots: { index: true, follow: true },
};

const DEMO_SUBJECTS: Record<string, { label: string; value: string }[]> = {
  "casper-testnet": [
    {
      label: "deployer account",
      value: "account-hash-d8b79439bf227b255f478242c3398dd8a8dbd2ad8a8d47ef6281fc8f3c634ac1",
    },
    {
      label: "issuer account",
      value: "account-hash-6edde3cf38a6ff3f74c3fb1f7512b36c641a911d1494742efc10ef711262aa37",
    },
  ],
  "pharos-atlantic": [
    {
      label: "sample agent",
      value: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    },
  ],
};

const DEMO_CAPABILITIES = ["kyc.basic", "rwa.accredited", "data.premium", "agent.commerce.x402"];

function verifyHref(chain: ChainNetwork, subject: string, capability: string): string {
  return `/verify?chain=${chain.id}&subject=${subject}&capability=${capability}`;
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { subject: rawSubject, capability: rawCap } = params;
  const chain = getChain(params);
  const demoSubjects = DEMO_SUBJECTS[chain.id] ?? DEMO_SUBJECTS["pharos-atlantic"];
  const casper = isCasperChain(chain);

  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · verify</p>
        <span className="font-mono tabular text-ink-quiet">
          {chain.name.toLowerCase()}
          {chain.chainId ? ` · chain ${chain.chainId}` : ""}
        </span>
      </header>

      <section className="mt-12 sm:mt-16">
        <h1 className="display text-4xl text-ink sm:text-5xl">
          Verify any agent wallet.
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-lg leading-relaxed text-ink-soft">
          One URL. One keccak256 capability hash. One on-chain read.
          The answer comes from {chain.name} state, not from a Ligis server.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          {CHAINS.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? " · " : ""}
              {c.id === chain.id ? (
                <span className="text-ink">{c.name.toLowerCase()}</span>
              ) : (
                <a
                  href={`/verify?chain=${c.id}`}
                  className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                >
                  {c.name.toLowerCase()}
                </a>
              )}
            </span>
          ))}
        </p>
      </section>

      <section className="mt-12">
        <h2 className="eyebrow">Demo</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          Pick a subject and a capability. The page rebuilds the URL with the
          proper query params and re-renders against the live chain.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Subject</p>
            <Rule className="mt-3" />
            <ul className="mt-4 space-y-2 font-mono text-xs">
              {demoSubjects.map((s) => (
                <li key={s.value}>
                  <a
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                    href={verifyHref(chain, s.value, rawCap ?? "kyc.basic")}
                  >
                    {s.label}
                  </a>
                  <p className="mt-1 pl-2 text-[11px] text-ink-quiet">{truncateAddress(s.value, 12, 6)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Capability</p>
            <Rule className="mt-3" />
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
              {DEMO_CAPABILITIES.map((c) => (
                <li key={c}>
                  <a
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                    href={verifyHref(chain, rawSubject ?? demoSubjects[0].value, c)}
                  >
                    {c}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {rawSubject && rawCap ? (
        <section className="mt-16">
          <h2 className="eyebrow">Result</h2>
          <div className="mt-6">
            <Result chain={chain} subject={rawSubject} capability={rawCap} />
          </div>
        </section>
      ) : (
        <section className="mt-16">
          <h2 className="eyebrow">Result</h2>
          <p className="mt-4 font-serif text-base italic text-ink-quiet">
            Click a subject and capability above to run the check.
          </p>
        </section>
      )}

      <section className="mt-16">
        <h2 className="eyebrow">API</h2>
        <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
          The same path works as a shareable, self-verifying URL for
          programmatic checks and audit trails.
        </p>
        <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
{`GET /verify?chain=${chain.id}&subject=${casper ? "account-hash-..." : "0x..."}&capability=kyc.basic`}
        </pre>
      </section>

      <footer className="route-footer mt-16 text-xs text-ink-quiet">
        <a href="/" className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">← Index</a>
        <a href={chain.explorerUrl} target="_blank" rel="noreferrer" className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">
          {casper ? "cspr.live" : "pharosscan"} ↗
        </a>
      </footer>
    </main>
  );
}

async function Result({
  chain,
  subject,
  capability,
}: {
  chain: ChainNetwork;
  subject: string;
  capability: string;
}) {
  const outcome = await verifySubject(chain, subject, capability);

  if (!outcome.ok) {
    return <p className="font-serif text-base text-revoke">{outcome.error}</p>;
  }

  return (
    <div className={`border-l-2 pl-6 ${outcome.capable ? "border-sage" : "border-revoke"}`}>
      <p className="font-mono text-sm tabular text-ink-soft">
        subject: {truncateAddress(outcome.subject as Address, 8, 8)}
      </p>
      <p className="mt-1 font-mono text-sm tabular text-ink-soft">
        capability: {outcome.capabilityId}
      </p>
      <p className="mt-4 display text-3xl">
        {outcome.capable ? (
          <span className="text-sage">✓ Capable</span>
        ) : (
          <span className="text-revoke">✗ Not capable</span>
        )}
      </p>
      {outcome.issuer ? (
        <p className="mt-3 font-serif text-base leading-relaxed text-ink-soft">
          Issued by <code className="font-mono text-ink">{truncateAddress(outcome.issuer, 6, 4)}</code>
          {outcome.expiresAt && outcome.expiresAt > 0n
            ? `, expires ${monthYear(outcome.expiresAt)}`
            : ", no expiry"}
          .
        </p>
      ) : null}
      <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        Source: {chain.name} state, read on request. On-chain. Not a Ligis server.
      </p>
    </div>
  );
}
