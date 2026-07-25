import { Rule } from "@/components/Rule";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-8 py-32">
      <p className="eyebrow">Not in the index</p>
      <Rule className="mt-4" />
      <h1 className="display mt-10 text-5xl text-ink">
        This page isn&rsquo;t in the catalog.
      </h1>
      <p className="mt-6 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
        Nothing is filed under this address. Check the link, or start from the
        index — every agent, capability, and issuer is reachable from there.
      </p>
      <a
        href="/"
        className="mt-12 inline-block text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
      >
        ← Return to the index
      </a>
    </main>
  );
}
