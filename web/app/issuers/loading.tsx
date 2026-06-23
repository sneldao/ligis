import { Rule } from "@/components/Rule";

export default function IssuersLoading() {
  return (
    <main className="mx-auto max-w-3xl px-8 pt-12 pb-32 sm:pt-20">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · scanning logs…</p>
        <span className="font-mono text-[11px] tabular text-ink-quiet">getLogs</span>
      </header>

      <section className="mt-20">
        <div className="display h-[72px] w-[14rem] bg-paper-deep sm:h-[88px] sm:w-[16rem]" aria-hidden />
        <div className="mt-10 space-y-3">
          <div className="h-3 w-full max-w-prose bg-paper-deep" aria-hidden />
          <div className="h-3 w-4/5 max-w-prose bg-paper-deep" aria-hidden />
        </div>
      </section>

      <section className="mt-20">
        <Rule />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i}>
            <div className="grid grid-cols-[2rem_1fr_auto_auto] items-baseline gap-x-8 py-4">
              <div className="h-3 w-6 bg-paper-deep" aria-hidden />
              <div className="h-3 w-48 bg-paper-deep" aria-hidden />
              <div className="h-3 w-10 bg-paper-deep" aria-hidden />
              <div className="h-3 w-16 bg-paper-deep" aria-hidden />
            </div>
            <Rule tone="soft" />
          </div>
        ))}
      </section>
    </main>
  );
}
