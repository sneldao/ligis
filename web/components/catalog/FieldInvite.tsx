import Link from "next/link";
import { Rule } from "@/components/Rule";
import { QuietField } from "./QuietField";

/** Specimen strip — the whole field is the affordance. */
export function FieldInvite({ chainId }: { chainId: string }) {
  const href = `/field?chain=${encodeURIComponent(chainId)}&enter=1`;

  return (
    <section id="field" className="scroll-mt-24">
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Field</p>
        <p className="hidden font-mono text-xs tabular text-ink-quiet sm:block">
          live registry
        </p>
      </header>
      <Rule className="mt-4" />
      <div className="mt-6 max-w-md sm:mt-8">
        <h2 className="display text-2xl text-ink sm:text-3xl">
          Fly the registry.
        </h2>
        <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
          Zoom in — specimens. Zoom out — a map. Strangers until you check.
        </p>
      </div>

      <Link
        href={href}
        className="group relative mt-6 block h-[16rem] overflow-hidden border-y border-rule transition-colors sm:mt-8 sm:h-[22rem]"
        aria-label="Enter the field — live registry"
      >
        <QuietField />
        <div className="pointer-events-none absolute inset-0 bg-paper/30 transition-colors group-hover:bg-paper/10 group-focus-visible:bg-paper/10" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 py-4 sm:px-8 sm:py-5">
          <p className="hidden max-w-sm font-serif text-sm italic leading-relaxed text-ink-soft sm:block">
            Drag, scroll, or pinch. Esc or Ligis leaves.
          </p>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-terra">
            Enter the field →
          </span>
        </div>
      </Link>
    </section>
  );
}
