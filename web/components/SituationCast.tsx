import Link from "next/link";
import { Rule } from "@/components/Rule";
import { SITUATIONS, type Situation } from "@/lib/situations";

/**
 * Role casting for first-time visitors: named situations before the mechanism.
 * Ledger rows + hairlines — not cards.
 */
export function SituationCast({
  chainId,
  activeId,
}: {
  chainId: string;
  /** When set (e.g. on /gate), highlight the active situation */
  activeId?: string;
}) {
  return (
    <section id="situations" className="scroll-mt-24">
      <header className="flex items-baseline justify-between gap-4">
        <p className="eyebrow">This is you if…</p>
        <p className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-quiet sm:block">
          pick a moment · then run the gate
        </p>
      </header>
      <Rule className="mt-4" />
      <p className="mt-6 max-w-2xl font-serif text-base leading-relaxed text-ink-soft">
        Ligis matters at one instant: the second before money moves to a wallet
        your software has never met. If none of these are your job, you&rsquo;re
        not the buyer yet — you may still be an issuer, or just curious.
      </p>

      <ol className="mt-10">
        {SITUATIONS.map((s, i) => (
          <SituationRow
            key={s.id}
            situation={s}
            index={i + 1}
            chainId={chainId}
            active={activeId === s.id}
          />
        ))}
      </ol>
    </section>
  );
}

function SituationRow({
  situation: s,
  index,
  chainId,
  active,
}: {
  situation: Situation;
  index: number;
  chainId: string;
  active: boolean;
}) {
  const href = `/gate?chain=${chainId}&situation=${s.id}&capability=${s.capability}`;

  return (
    <li className="border-t border-rule py-6 first:border-t-0 sm:py-7">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[11rem_1fr_auto] lg:gap-8 lg:items-baseline">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs tabular text-terra">
            {String(index).padStart(2, "0")}
          </span>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
              {s.role}
            </p>
            {active ? (
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-sage">
                active
              </p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 max-w-2xl">
          <p className="font-serif text-base leading-relaxed text-ink">
            {s.check}
          </p>
          <p className="mt-2 font-serif text-sm leading-relaxed text-ink-soft">
            <span className="text-ink-quiet">Moment · </span>
            {s.moment}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-revoke">
                Without Ligis
              </dt>
              <dd className="mt-1 font-serif text-sm leading-relaxed text-ink-soft">
                {s.without}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-sage">
                With Ligis
              </dt>
              <dd className="mt-1 font-serif text-sm leading-relaxed text-ink-soft">
                {s.withLigis}
              </dd>
            </div>
          </dl>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
            {s.integrator}
            <span className="mx-2 text-rule">·</span>
            <code className="normal-case tracking-normal text-ink-soft">
              {s.capability}
            </code>
          </p>
        </div>

        <div className="lg:text-right">
          <Link
            href={href}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-terra hover:decoration-terra"
          >
            {active ? "Run this gate →" : "Try this gate →"}
          </Link>
        </div>
      </div>
    </li>
  );
}
