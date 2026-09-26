import type { Metadata } from "next";
import { ArenaRunner } from "@/components/arena/ArenaRunner";
import { AttackLab } from "@/components/arena/AttackLab";

export const metadata: Metadata = {
  title: "Arena — watch an agent get tricked, and stopped",
  description:
    "A procurement agent reads a poisoned invoice page and tries to wire $60,000 to an attacker. Ligis stops it before money moves.",
};

export default function ArenaPage() {
  return (
    <main className="night-grid min-h-dvh">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pt-28 pb-20 sm:px-8 sm:pt-32">
        <header className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
            Arena · prompt injection
          </p>
          <h1 className="text-balance font-sans text-4xl font-medium leading-tight tracking-tight text-fog sm:text-5xl">
            Watch an agent get tricked, then stopped.
          </h1>
          <p className="text-pretty text-base leading-relaxed text-fog-quiet sm:text-lg">
            Atlas renews a vendor contract, then reads an invoice page with a
            hidden instruction telling it to wire $60,000 to a new account.
            Every payment goes through the Ligis gate first.
          </p>
        </header>
        <ArenaRunner />
        <AttackLab />
      </div>
    </main>
  );
}
