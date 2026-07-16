import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { Rule } from "@/components/Rule";
import { capabilities, network } from "@/lib/chain";
import { truncateHash } from "@/lib/format";

export const metadata = {
  title: "Capabilities — Ligis",
  description:
    "The reference capability set used by Ligis to compose verifiable credentials.",
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
  { id: "kyc.basic", typicalExpiry: 15_552_000 },
  { id: "trade.cex-retail", typicalExpiry: 7_776_000 },
  { id: "rwa.accredited", typicalExpiry: 31_536_000 },
  { id: "agent.commerce.escrow", typicalExpiry: 15_552_000 },
  { id: "agent.commerce.swap", typicalExpiry: 7_776_000 },
  { id: "agent.commerce.bridge", typicalExpiry: 7_776_000 },
];

// Three editorial groups that organise the reference set by prefix
// taxonomy. The categories also drive the three-step staggered reveal
// via the .animate-triptych-reveal utility (hoisted to globals.css).
// Live users of the pattern, in order:
//   1. /steward — StewardTriptych (genesis / synthesis / stasis)
//   2. /capabilities (this page) — IDENTITY / FINANCE / COMMERCE
//   3. /embed — URL / iframe / Preview numbered sections
const CATEGORIES = [
  {
    name: "IDENTITY",
    gloss: "Proves who the agent is.",
    delayMs: 0,
    ids: ["kyc.basic"],
  },
  {
    name: "FINANCE",
    gloss: "Authorises how the agent handles assets.",
    delayMs: 120,
    ids: ["trade.cex-retail", "rwa.accredited"],
  },
  {
    name: "COMMERCE",
    gloss: "What the agent is permitted to do on chain.",
    delayMs: 280,
    ids: [
      "agent.commerce.escrow",
      "agent.commerce.swap",
      "agent.commerce.bridge",
    ],
  },
] as const;

function expiryFor(id: string): number {
  return REFERENCE.find((r) => r.id === id)?.typicalExpiry ?? 0;
}

export default function CapabilitiesPage() {
  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · capabilities 00</p>
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
          The reference set.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Capabilities are strings the registry treats as opaque bytes32 hashes.
          The names below are the reference set used across the docs, the CLI,
          and the Steward&rsquo;s reasoning. An issuer can sign any capability
          — these are simply the ones this project ships with as defaults.
        </p>
        <p className="mt-6 max-w-prose font-serif text-base italic leading-relaxed text-ink-quiet">
          {capabilities.length} capabilities in the reference set. Hashes are
          keccak256 of the human name and are stable across chains.
        </p>
      </section>

      <section className="mt-20 space-y-12">
        {CATEGORIES.map((cat) => {
          const caps = cat.ids
            .map((id) => capabilities.find((c) => c.id === id))
            .filter((c): c is (typeof capabilities)[number] => c !== undefined);
          return (
            <section
              key={cat.name}
              className="animate-triptych-reveal"
              data-anim-delay={String(cat.delayMs)}
              aria-labelledby={`cat-${cat.name.toLowerCase()}`}
            >
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
                          <div className="flex items-baseline gap-3">
                            <span className="font-mono text-[12px] tabular text-ink-quiet">
                              {truncateHash(cap.hash, 14, 8)}
                            </span>
                            <CopyButton value={cap.hash} />
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

      <section className="mt-24">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Composing a new capability</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            keccak256
          </p>
        </header>
        <Rule className="mt-4" />
        <p className="mt-8 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Pick a name. Hash it with keccak256. That is the capability — there
          is no central registry to ask. The convention is{" "}
          <span className="font-mono text-ink">domain.subject.verb</span>{" "}
          (lowercase, dot-separated). Anything else is fine; consistency makes
          composition easier.
        </p>
        <pre className="mt-8 overflow-x-auto bg-paper-deep px-6 py-5 font-mono text-[13px] leading-relaxed tabular text-ink">
          {`ligis hash agent.commerce.escrow
# → 0x17775e488d090dd8527e0139b3472d4d03c3372525b10a7c1449f04027a3ebf8`}
        </pre>
      </section>

      <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
        <Link
          href="/"
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          ← Return to the index
        </Link>
        <span className="font-mono tabular">
          {network.name.toLowerCase()} · chain {network.chainId}
        </span>
      </footer>
    </main>
  );
}
