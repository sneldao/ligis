import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { RevealOnView } from "@/components/RevealOnView";
import { Rule } from "@/components/Rule";
import { capabilities } from "@/lib/chain";
import { truncateHash } from "@/lib/format";

export const metadata = {
  title: "Capabilities — Ligis",
  description:
    "What an agent can prove. The capability set Ligis checks before you trust a counterparty — from KYC to escrow to data access, weighted by criticality.",
};

function humanExpiry(seconds: number): string {
  const days = Math.round(seconds / 86_400);
  if (days >= 365) {
    const years = Math.round(days / 365);
    return years === 1 ? "one year" : `${years} years`;
  }
  if (days >= 30) {
    const months = Math.round(days / 30);
    return months === 1 ? "one month" : `${months} months`;
  }
  return `${days} days`;
}

const REFERENCE = [
  { id: "kyc.basic", typicalExpiry: 15_552_000, weight: 4, criticality: "critical" },
  { id: "rwa.accredited", typicalExpiry: 31_536_000, weight: 4, criticality: "critical" },
  { id: "agent.commerce.escrow", typicalExpiry: 15_552_000, weight: 3, criticality: "high" },
  { id: "agent.commerce.swap", typicalExpiry: 7_776_000, weight: 3, criticality: "high" },
  { id: "agent.commerce.bridge", typicalExpiry: 7_776_000, weight: 3, criticality: "high" },
  { id: "agent.commerce.recurring", typicalExpiry: 7_776_000, weight: 2, criticality: "medium" },
  { id: "agent.commerce.x402", typicalExpiry: 7_776_000, weight: 2, criticality: "medium" },
  { id: "trade.cex-retail", typicalExpiry: 7_776_000, weight: 2, criticality: "medium" },
  { id: "data.premium", typicalExpiry: 86_400, weight: 1, criticality: "low" },
] as const;

// Three editorial groups that organise the reference set by what's
// at stake. The category sections drive the three-step staggered
// reveal via `RevealOnView` — a client component that uses
// IntersectionObserver to flip `data-revealed="true"` on the wrapper
// only when the section scrolls into view.
const CATEGORIES = [
  {
    name: "IDENTITY",
    gloss: "Who the agent claims to be. Lose these and the transaction should stop.",
    delayMs: 0,
    ids: ["kyc.basic", "rwa.accredited"],
  },
  {
    name: "MONEY",
    gloss: "What the agent is allowed to do with funds. Direct exposure if it goes wrong.",
    delayMs: 120,
    ids: [
      "agent.commerce.escrow",
      "agent.commerce.swap",
      "agent.commerce.bridge",
      "agent.commerce.recurring",
      "agent.commerce.x402",
      "trade.cex-retail",
    ],
  },
  {
    name: "ACCESS",
    gloss: "What the agent can read. No direct fund risk, but data has value.",
    delayMs: 280,
    ids: ["data.premium"],
  },
] as const;

function refFor(id: string) {
  return REFERENCE.find((r) => r.id === id);
}

function expiryFor(id: string): number {
  return refFor(id)?.typicalExpiry ?? 0;
}

function weightFor(id: string): number {
  return refFor(id)?.weight ?? 2;
}

function criticalityFor(id: string): string {
  return refFor(id)?.criticality ?? "medium";
}

export default function CapabilitiesPage() {
  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · what an agent can prove</p>
        <div className="flex items-baseline gap-6">
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            &larr; Index
          </Link>
        </div>
      </header>

      <section className="mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          What an agent
          <br />
          can prove.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Before you trust an agent with a transaction, you need to know
          what it&rsquo;s authorized to do. These are the capabilities an
          agent can hold &mdash; each one is a verifiable, on-chain claim
          that an issuer has vouched for. The risk check weighs them by
          criticality: a missing <code className="font-mono text-ink">kyc.basic</code>{" "}
          (weight 4) is a hard stop. A missing{" "}
          <code className="font-mono text-ink">data.premium</code>{" "}
          (weight 1) is a footnote.
        </p>
        <p className="mt-6 max-w-prose font-serif text-base italic leading-relaxed text-ink-quiet">
          {capabilities.length} capabilities in the reference set. Hashes are
          keccak256 of the human name and are stable across chains &mdash; the
          same capability has the same hash on Casper and Pharos.
        </p>
      </section>

      <section className="mt-20 space-y-12">
        {CATEGORIES.map((cat) => {
          const caps = cat.ids
            .map((id) => capabilities.find((c) => c.id === id))
            .filter((c): c is (typeof capabilities)[number] => c !== undefined);
          return (
            <RevealOnView key={cat.name} delayMs={cat.delayMs}>
              <section aria-labelledby={`cat-${cat.name.toLowerCase()}`}>
                <header className="flex items-baseline justify-between">
                  <h2
                    id={`cat-${cat.name.toLowerCase()}`}
                    className="eyebrow text-ink"
                  >
                    {cat.name}
                  </h2>
                  <span className="font-mono text-[11px] tabular text-ink-quiet">
                    {caps.length}{" "}
                    {caps.length === 1 ? "capability" : "capabilities"}
                  </span>
                </header>
                <Rule className="mt-4" />
                <p className="mt-6 max-w-prose font-serif text-base italic leading-relaxed text-ink-soft">
                  {cat.gloss}
                </p>
                <div className="mt-2 space-y-0">
                  {caps.map((cap) => {
                    const exp = expiryFor(cap.id);
                    const weight = weightFor(cap.id);
                    const criticality = criticalityFor(cap.id);
                    return (
                      <div key={cap.id}>
                        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-6">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-baseline gap-x-4">
                              <span className="font-mono text-sm tabular text-ink">
                                {cap.id}
                              </span>
                              <span className="font-serif text-sm italic text-ink-soft">
                                {cap.label.toLowerCase()}
                              </span>
                            </div>
                            <p className="max-w-prose font-serif text-sm leading-relaxed text-ink-soft">
                              {cap.description}
                            </p>
                            <div className="flex flex-wrap items-baseline gap-3">
                              <span className="font-mono text-[12px] tabular text-ink-quiet">
                                {truncateHash(cap.hash, 14, 8)}
                              </span>
                              <CopyButton value={cap.hash} />
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
                                {criticality} &middot; w{weight}
                              </span>
                            </div>
                          </div>
                          <span className="whitespace-nowrap font-mono text-xs tabular text-ink-soft">
                            {exp > 0 ? humanExpiry(exp) : "no default"}
                          </span>
                        </div>
                        <Rule tone="soft" />
                      </div>
                    );
                  })}
                </div>
              </section>
            </RevealOnView>
          );
        })}
      </section>

      <section className="mt-24">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Define a new capability</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            keccak256
          </p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-8 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Need to check something that isn&rsquo;t in this list? Pick a name,
          hash it with keccak256, and that&rsquo;s the capability. There is no
          central registry to ask. The convention is{" "}
          <span className="font-mono text-ink">domain.subject.verb</span>{" "}
          (lowercase, dot-separated). Anything else works; consistency just
          makes it easier for other agents to check the same thing.
        </p>
        <pre className="mt-8 overflow-x-auto bg-paper-deep px-6 py-5 font-mono text-[13px] leading-relaxed tabular text-ink">
          {`ligis hash agent.commerce.escrow
# -> 0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8`}
        </pre>
      </section>

      <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          &larr; Return to the index
        </Link>
        <span className="font-mono tabular">
          hashes stable across chains
        </span>
      </footer>
    </main>
  );
}
