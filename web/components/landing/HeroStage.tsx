import Link from "next/link";
import { HeroWire } from "@/components/landing/HeroWire";
import { HeroCtaCounter } from "@/components/landing/HeroCtaCounter";

export function HeroStage() {
  return (
    <section
      data-mode="incident"
      className="night-grid relative overflow-hidden"
      aria-labelledby="hero-title"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-32 pb-20 sm:px-8 sm:pt-40 sm:pb-28 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="landing-cascade flex flex-col gap-6">
          <p
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal"
            style={{ ["--cascade-step" as string]: 0 }}
          >
            Ligis · trust gate for agent payments
          </p>
          <h1
            id="hero-title"
            className="text-balance font-sans text-5xl font-medium leading-[1.02] tracking-tight text-fog sm:text-6xl lg:text-7xl"
            style={{ ["--cascade-step" as string]: 1 }}
          >
            Your agent can be talked into anything.
          </h1>
          <p
            className="max-w-md text-pretty text-lg leading-relaxed text-fog-quiet"
            style={{ ["--cascade-step" as string]: 2 }}
          >
            Ligis checks every payment against what the agent was actually hired
            to do: right payee, right amount, in scope, plus a verified-payee
            credential read. <span className="text-go">GO</span> or{" "}
            <span className="text-stop">STOP</span> before money moves.
          </p>
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2"
            style={{ ["--cascade-step" as string]: 3 }}
          >
            <HeroCtaCounter
              bucket="hero:gate"
              href="#gate"
              className="font-mono text-xs uppercase tracking-[0.14em] text-fog underline decoration-terra decoration-2 underline-offset-8 transition-colors hover:text-terra-soft hover:decoration-terra-soft"
            >
              Try the gate →
            </HeroCtaCounter>
            <HeroCtaCounter
              bucket="hero:arena"
              href="/arena"
              className="font-mono text-xs uppercase tracking-[0.14em] text-fog-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-fog hover:decoration-terra"
            >
              Watch an attack stopped
            </HeroCtaCounter>
            <HeroCtaCounter
              bucket="hero:zcash"
              href="/zcash"
              className="font-mono text-xs uppercase tracking-[0.14em] text-fog-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-fog hover:decoration-terra"
            >
              Pay a shielded Zcash payee privately
            </HeroCtaCounter>
          </div>
          <p
            className="pt-4 font-mono text-[11px] leading-relaxed text-fog-quiet"
            style={{ ["--cascade-step" as string]: 4 }}
          >
            Judged by Jev (TypeSafe) and Vultr Inference · measured live under
            <Link
              href="/gate"
              className="ml-1 underline decoration-rule decoration-1 underline-offset-4 hover:decoration-fog"
            >
              /gate
            </Link>
          </p>
        </div>
        <div className="landing-cascade">
          <div style={{ ["--cascade-step" as string]: 3 }}>
            <HeroWire />
          </div>
        </div>
      </div>
    </section>
  );
}
