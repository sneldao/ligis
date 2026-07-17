import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
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

// Three editorial groups organise the reference set by what's at stake.
// Core reference content renders immediately; its supporting hash material is
// available on intent so the page remains useful as a field guide on phones.
const CATEGORIES = [
  {
    name: "IDENTITY",
    gloss: "Who the agent claims to be. Lose these and the transaction should stop.",
    ids: ["kyc.basic", "rwa.accredited"],
  },
  {
    name: "MONEY",
    gloss: "What the agent is allowed to do with funds. Direct exposure if it goes wrong.",
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
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
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

      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          What an agent
          <br />
          can prove.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          Capabilities are the claims an agent can prove on-chain. Critical
          claims stop a transaction when missing; low-stakes claims only lower
          confidence.
        </p>
        <p className="mt-4 max-w-prose font-serif text-sm italic leading-relaxed text-ink-quiet">
          {capabilities.length} reference capabilities. Their hashes are stable
          across Casper and Pharos.
        </p>
      </section>

      <section className="mt-16 max-w-5xl space-y-12 sm:mt-20">
        {CATEGORIES.map((cat) => {
          const caps = cat.ids
            .map((id) => capabilities.find((c) => c.id === id))
            .filter((c): c is (typeof capabilities)[number] => c !== undefined);
          return (
            <section key={cat.name} aria-labelledby={`cat-${cat.name.toLowerCase()}`}>
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
                <p className="mt-5 max-w-prose font-serif text-sm italic leading-relaxed text-ink-soft sm:mt-6 sm:text-base">
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
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
                                {criticality} &middot; w{weight}
                              </span>
                              <details className="group">
                                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-ink-quiet marker:hidden hover:text-ink">
                                  <span className="group-open:hidden">hash +</span><span className="hidden group-open:inline">hide hash −</span>
                                </summary>
                                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                                  <span className="font-mono text-[12px] tabular text-ink-quiet">{truncateHash(cap.hash, 14, 8)}</span>
                                  <CopyButton value={cap.hash} />
                                </div>
                              </details>
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
          );
        })}
      </section>

      <section className="mt-20 max-w-3xl sm:mt-24">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Define a new capability</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            keccak256
          </p>
        </header>
        <Rule className="mt-4" />
        <details className="group mt-6 border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">How to define one +</span><span className="hidden group-open:inline">Close naming guidance −</span></summary>
          <div className="border-t border-rule-soft py-5">
            <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">Pick a name, hash it with keccak256, and that&rsquo;s the capability. The convention is <span className="font-mono text-ink">domain.subject.verb</span>; consistency helps other agents check the same thing.</p>
            <pre className="mt-6 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[13px] leading-relaxed tabular text-ink">{`ligis hash agent.commerce.escrow
# -> 0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8`}
            </pre>
          </div>
        </details>
      </section>

      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
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
