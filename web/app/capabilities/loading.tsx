import { Rule } from "@/components/Rule";

export default function CapabilitiesLoading() {
  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · what an agent can prove</p>
        <div className="skeleton h-3 w-20" aria-hidden />
      </header>

      <section className="mt-14 max-w-3xl sm:mt-20">
        <div className="skeleton display h-[56px] w-full max-w-md sm:h-[72px]" aria-hidden />
        <div className="mt-7 space-y-3">
          <div className="skeleton h-5 w-full max-w-prose" aria-hidden />
          <div className="skeleton h-5 w-4/5 max-w-prose" aria-hidden />
        </div>
      </section>

      <section className="mt-16 sm:mt-20">
        <div className="skeleton h-3 w-32" aria-hidden />
        <Rule className="mt-4" />
        <div className="mt-8 space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton h-5 w-48" aria-hidden />
              <div className="skeleton h-3 w-full max-w-lg" aria-hidden />
              <div className="skeleton h-3 w-32" aria-hidden />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
