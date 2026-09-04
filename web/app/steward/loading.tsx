export default function StewardLoading() {
  return (
    <main className="route-shell max-w-5xl">
      <header className="route-header text-xs">
        <p className="eyebrow">Ligis · autonomous bootstrap demo</p>
        <div className="skeleton h-3 w-24" aria-hidden />
      </header>

      <section className="mt-14 max-w-3xl sm:mt-20">
        <div className="skeleton display h-[56px] w-full max-w-md sm:h-[72px]" aria-hidden />
        <div className="mt-7 space-y-3">
          <div className="skeleton h-5 w-full max-w-prose" aria-hidden />
          <div className="skeleton h-5 w-4/5 max-w-prose" aria-hidden />
        </div>
      </section>

      <section className="mt-12 max-w-3xl sm:mt-16">
        <div className="space-y-4">
          <div className="skeleton h-3 w-28" aria-hidden />
          <div className="skeleton h-10 w-full" aria-hidden />
          <div className="skeleton h-3 w-20" aria-hidden />
        </div>
      </section>

      <section className="mt-10 space-y-8">
        <div className="skeleton h-3 w-full" aria-hidden />
        <div className="space-y-3">
          <div className="skeleton h-4 w-24" aria-hidden />
          <div className="skeleton h-6 w-full max-w-md" aria-hidden />
        </div>
        <div className="space-y-3">
          <div className="skeleton h-4 w-16" aria-hidden />
          <div className="skeleton h-24 w-full" aria-hidden />
        </div>
      </section>
    </main>
  );
}
