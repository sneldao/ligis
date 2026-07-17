import { Rule } from "@/components/Rule";

export default function AgentLoading() {
  return (
    <main className="mx-auto max-w-5xl px-8 py-16 sm:py-24">
      <header className="flex items-baseline justify-between text-xs">
        <p className="eyebrow">Agent · reading from chain…</p>
        <span className="font-mono text-[11px] tabular text-ink-quiet">
          waiting on the rpc
        </span>
      </header>

      <section className="mt-16 grid grid-cols-1 gap-x-12 gap-y-12 sm:grid-cols-[14rem_1fr]">
        <div className="order-2 sm:order-1">
          <div
            className="aspect-[4/5] w-full max-w-[14rem] bg-paper-deep"
            aria-hidden
          />
          <p className="mt-3 font-mono text-[11px] tabular text-ink-quiet">
            portrait pending
          </p>
        </div>
        <div className="order-1 sm:order-2 sm:pt-2">
          <div
            className="display h-[64px] w-[18rem] bg-paper-deep sm:h-[80px] sm:w-[22rem]"
            aria-hidden
          />
          <div className="mt-6 space-y-3">
            <div className="h-3 w-full max-w-md bg-paper-deep" aria-hidden />
            <div className="h-3 w-full max-w-sm bg-paper-deep" aria-hidden />
            <div className="h-3 w-3/4 max-w-sm bg-paper-deep" aria-hidden />
          </div>
        </div>
      </section>

      <section className="mt-24">
        <div className="grid grid-cols-2 gap-y-6 gap-x-10 sm:grid-cols-4">
          {["status", "token", "controller", "credentials held"].map((l) => (
            <div key={l} className="space-y-2">
              <p className="eyebrow">{l}</p>
              <Rule tone="soft" />
              <div className="h-3 w-12 bg-paper-deep" aria-hidden />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-24">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">Credentials</p>
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            scanning…
          </p>
        </header>
        <div className="mt-6">
          <Rule />
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-5 sm:grid-cols-[1fr_auto_auto] sm:gap-x-8">
                <div className="h-3 w-48 bg-paper-deep" aria-hidden />
                <div
                  className="col-span-2 h-3 w-20 bg-paper-deep sm:col-span-1"
                  aria-hidden
                />
                <div className="h-3 w-16 bg-paper-deep" aria-hidden />
              </div>
              <Rule tone="soft" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
