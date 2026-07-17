import Link from "next/link";
import { Rule } from "@/components/Rule";
import { Snippet } from "@/components/Snippet";
import { capabilities, network } from "@/lib/chain";
import { SITE_URL } from "@/lib/site";

const EXAMPLE_SUBJECT = "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";
const EXAMPLE_CAP = capabilities[0]?.id ?? "kyc.basic";

export const metadata = {
  title: "Embed — Ligis",
  description: "Drop a Ligis verification badge into any page.",
};

export default function EmbedPage() {
  const iframeCode = `<iframe
  src="${SITE_URL}/embed/verify?subject=${EXAMPLE_SUBJECT}&capability=${EXAMPLE_CAP}"
  width="520" height="120"
  style="border: 0; background: transparent;"
  loading="lazy"
  title="Ligis verification badge">
</iframe>`;

  const directLink = `${SITE_URL}/embed/verify?subject={SUBJECT}&capability={CAPABILITY}`;

  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · embed 00</p>
        <div className="flex items-baseline gap-6">
          <Link
            href="/"
            className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            ← Index
          </Link>
        </div>
      </header>

      <section className="mt-14 max-w-3xl sm:mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Drop a verification
          <br />
          into any page.
        </h1>
        <p className="mt-7 max-w-prose font-serif text-lg leading-relaxed text-ink-soft sm:mt-10">
          A live, server-rendered verification badge for any page. No client
          SDK, no tracking, and no database between the visitor and chain state.
        </p>
      </section>

      <section className="mt-16 max-w-5xl sm:mt-20">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Live preview</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">{network.name.toLowerCase()}</p>
        </header>
        <Rule className="mt-4" />
        <div className="mt-6 overflow-hidden border-y border-rule-soft py-3 sm:max-w-[520px]">
          <iframe className="h-[120px] w-full max-w-[520px]" src={`/embed/verify?subject=${EXAMPLE_SUBJECT}&capability=${EXAMPLE_CAP}`} width="520" height="120" style={{ border: 0, background: "transparent" }} loading="lazy" title="Ligis verification badge preview" />
        </div>
        <p className="mt-4 max-w-prose font-serif text-sm italic leading-relaxed text-ink-quiet">Live for {EXAMPLE_SUBJECT.slice(0, 8)}··{EXAMPLE_SUBJECT.slice(-4)} · {EXAMPLE_CAP}</p>
      </section>

      <section className="mt-12 max-w-3xl sm:mt-16">
        <details className="group border-y border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Get the iframe code +</span><span className="hidden group-open:inline">Hide iframe code −</span></summary>
          <div className="border-t border-rule-soft py-5"><p className="mb-5 font-serif text-sm leading-relaxed text-ink-soft">Recommended size is 520 × 120. Its transparent background works on any page.</p><Snippet code={iframeCode} lang="html" /></div>
        </details>
        <details className="group border-b border-rule">
          <summary className="cursor-pointer list-none py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink"><span className="group-open:hidden">Use the verification URL directly +</span><span className="hidden group-open:inline">Hide URL format −</span></summary>
          <div className="border-t border-rule-soft py-5"><p className="mb-5 font-serif text-sm leading-relaxed text-ink-soft">Pass a subject and capability. The capability can be a human-readable id or 32-byte hash.</p><Snippet code={directLink} lang="url" /></div>
        </details>
      </section>
      <footer className="route-footer mt-20 text-xs text-ink-quiet sm:mt-32">
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
