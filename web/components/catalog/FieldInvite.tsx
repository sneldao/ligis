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
      <div className="mt-8 max-w-2xl sm:mt-10">
        <h2 className="display text-3xl text-ink">
          Every agent is a stranger until you check.
        </h2>
        <p className="mt-5 font-serif text-base leading-relaxed text-ink-soft">
          The field is the live registry as a place you can fly through. Zoom in
          and identities resolve as specimens. Zoom out and they remain a map
          &mdash; they do not disappear.
        </p>
      </div>
      <div className="relative mt-10 h-[22rem] overflow-hidden border-y border-rule sm:h-[28rem]">
        <QuietField />
        <div className="pointer-events-none absolute inset-0 bg-paper/25" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 py-5 sm:px-8 sm:py-6">
          <p className="hidden max-w-sm font-serif text-sm italic leading-relaxed text-ink-soft sm:block">
            Drag, scroll, or pinch. Esc or Ligis leaves.
          </p>
          <Link
            href={href}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra underline decoration-rule underline-offset-4 hover:decoration-terra"
          >
            Enter the field →
          </Link>
        </div>
      </div>
    </section>
  );
}
