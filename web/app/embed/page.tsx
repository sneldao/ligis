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
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
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

      <section className="mt-20">
        <h1 className="display text-5xl text-ink sm:text-6xl">
          Drop a verification
          <br />
          into any page.
        </h1>
        <p className="mt-10 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
          Any site can ask Ligis whether an agent holds a capability. The badge
          is a server-rendered iframe — no JavaScript, no SDK, no tracking.
          Click it and the visitor lands on the full agent page.
        </p>
      </section>

      <section className="mt-24 space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">01 · The URL</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">GET</p>
        </header>
        <Rule />
        <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          One endpoint, two query parameters. Capability accepts either the
          human-readable id or the 32-byte hash.
        </p>
        <Snippet code={directLink} lang="url" />
      </section>

      <section className="mt-24 space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">02 · The iframe</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">html</p>
        </header>
        <Rule />
        <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          Recommended size is 520 × 120. Background is transparent so the badge
          reads against any page.
        </p>
        <Snippet code={iframeCode} lang="html" />
      </section>

      <section className="mt-24 space-y-6">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">03 · Preview</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">live</p>
        </header>
        <Rule />
        <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          A live badge for {EXAMPLE_SUBJECT.slice(0, 8)}··{EXAMPLE_SUBJECT.slice(-4)}{" "}
          on {EXAMPLE_CAP}. Reads {network.name.toLowerCase()} every request.
        </p>
        <div className="mt-4">
          <iframe
            src={`/embed/verify?subject=${EXAMPLE_SUBJECT}&capability=${EXAMPLE_CAP}`}
            width="520"
            height="120"
            style={{ border: 0, background: "transparent" }}
            loading="lazy"
            title="Ligis verification badge preview"
          />
        </div>
      </section>        <footer className="mt-32 flex items-baseline justify-between text-xs text-ink-quiet">
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
