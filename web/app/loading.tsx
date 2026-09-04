export default function HomeLoading() {
  return (
    <main className="mx-auto max-w-5xl px-5 pt-24 pb-12 sm:px-8 sm:pt-36 sm:pb-24">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Ligis · the trust gate for autonomous payments</p>
        <div className="skeleton h-3 w-32" aria-hidden />
      </header>

      <section className="mt-14 sm:mt-16">
        <div className="skeleton display h-[56px] w-full max-w-3xl sm:h-[72px] lg:h-[84px]" aria-hidden />
        <div className="mt-7 space-y-3">
          <div className="skeleton h-5 w-full max-w-xl" aria-hidden />
          <div className="skeleton h-5 w-4/5 max-w-lg" aria-hidden />
        </div>
        <div className="mt-5 skeleton h-3 w-64" aria-hidden />
      </section>

      <section className="mt-12 max-w-2xl sm:mt-16">
        <div className="space-y-3">
          <div className="skeleton h-4 w-full" aria-hidden />
          <div className="skeleton h-4 w-full" aria-hidden />
          <div className="skeleton h-4 w-3/4" aria-hidden />
        </div>
      </section>

      <section className="mt-16">
        <div className="skeleton h-3 w-32" aria-hidden />
        <div className="mt-4 space-y-6">
          <div className="skeleton h-10 w-full" aria-hidden />
          <div className="skeleton h-24 w-full" aria-hidden />
        </div>
      </section>
    </main>
  );
}
