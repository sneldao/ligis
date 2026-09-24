import Link from "next/link";
import { Rule } from "@/components/Rule";
import { QuietField } from "./QuietField";

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
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 sm:mt-8">
        <div className="max-w-md">
          <h2 className="display text-2xl text-ink sm:text-3xl">
            Fly the registry.
          </h2>
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft sm:text-base">
            Zoom in — specimens. Zoom out — a map. Strangers until you check.
          </p>
        </div>
        <Link
          href={href}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra underline decoration-rule underline-offset-4 hover:decoration-terra"
        >
          Enter the field →
        </Link>
      </div>
      <div className="relative mt-6 h-[16rem] overflow-hidden border-y border-rule sm:mt-8 sm:h-[22rem]">
        <QuietField />
        <div className="pointer-events-none absolute inset-0 bg-paper/25" />
        <p className="pointer-events-none absolute inset-x-0 bottom-0 hidden px-5 py-4 font-serif text-sm italic text-ink-soft sm:block sm:px-8">
          Drag, scroll, or pinch. Esc or Ligis leaves.
        </p>
      </div>
    </section>
  );
}
