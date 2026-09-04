import Link from "next/link";
import { Rule } from "@/components/Rule";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-8 py-32">
      <p className="eyebrow">404 · not in the index</p>
      <Rule className="mt-4" />
      <h1 className="display mt-10 text-5xl text-ink">
        This page isn&rsquo;t in the catalog.
      </h1>
      <p className="mt-6 max-w-prose font-serif text-lg leading-relaxed text-ink-soft">
        Nothing is filed under this address. Check the link, or start from the
        index — every agent, capability, and issuer is reachable from there.
      </p>
      <div className="mt-12 flex flex-wrap items-baseline gap-x-6 gap-y-3">
        <Link
          href="/"
          className="text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
        >
          ← Return to the index
        </Link>
        <Link
          href="/gate"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
        >
          Try the gate →
        </Link>
        <Link
          href="/capabilities"
          className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
        >
          Browse capabilities →
        </Link>
      </div>
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        Tip: press ⌘K or / to search for any agent by address
      </p>
    </main>
  );
}
