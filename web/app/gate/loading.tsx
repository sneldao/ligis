import { Rule } from "@/components/Rule";

export default function GateLoading() {
  return (
    <main className="route-shell max-w-3xl">
      <header className="route-header text-xs text-ink-quiet">
        <p className="eyebrow">Ligis · verify</p>
        <span className="font-mono tabular text-ink-quiet">
          reading chain…
        </span>
      </header>

      <section className="mt-12 sm:mt-16">
        <div className="skeleton display h-[48px] w-72 sm:h-[60px] sm:w-96" aria-hidden />
        <div className="mt-6 space-y-3">
          <div className="skeleton h-4 w-full max-w-2xl" aria-hidden />
          <div className="skeleton h-4 w-3/4 max-w-xl" aria-hidden />
        </div>
      </section>

      <section className="mt-16">
        <p className="eyebrow">Check a counterparty</p>
        <Rule className="mt-4" />
        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr] sm:items-end">
          <div className="space-y-2">
            <div className="skeleton h-3 w-24" aria-hidden />
            <div className="skeleton h-10 w-full" aria-hidden />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-3 w-24" aria-hidden />
            <div className="skeleton h-10 w-full" aria-hidden />
          </div>
        </div>
      </section>

      <section className="mt-16">
        <p className="eyebrow">Verdict</p>
        <div className="mt-6 space-y-4">
          <div className="skeleton h-8 w-32" aria-hidden />
          <div className="skeleton h-4 w-full max-w-lg" aria-hidden />
          <div className="skeleton h-4 w-2/3 max-w-md" aria-hidden />
        </div>
      </section>
    </main>
  );
}
