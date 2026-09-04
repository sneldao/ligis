export default function StyleguideLoading() {
  return (
    <main className="route-shell max-w-3xl px-8 py-24">
      <header className="space-y-6">
        <div className="skeleton h-3 w-40" aria-hidden />
        <div className="skeleton display h-12 w-72" aria-hidden />
      </header>

      {[0, 1, 2].map((i) => (
        <section key={i} className="mt-14 space-y-4">
          <div className="skeleton h-3 w-24" aria-hidden />
          <div className="skeleton h-px w-full" aria-hidden />
          <div className="skeleton h-4 w-full max-w-md" aria-hidden />
          <div className="skeleton h-4 w-2/3 max-w-md" aria-hidden />
        </section>
      ))}
    </main>
  );
}
