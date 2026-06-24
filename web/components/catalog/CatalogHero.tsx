"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { DynamicIsland, EscListener, ScrollHint } from "./DynamicIsland";
import { seedCatalog } from "./agentSeed";

const CatalogScene = dynamic(
  () => import("./CatalogScene").then((m) => m.CatalogScene),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-paper">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
          composing the catalog…
        </p>
      </div>
    ),
  }
);

export function CatalogHero() {
  const agents = seedCatalog(49);

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden">
      <div className="absolute inset-0">
        <CatalogScene agents={agents} />
      </div>

      <DynamicIsland totalCount={agents.length} />
      <EscListener />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex flex-col items-center gap-3 px-6 text-center sm:bottom-28"
      >
        <p className="font-serif text-2xl italic text-ink sm:text-3xl">
          A trust layer for autonomous agents.
        </p>
        <p className="max-w-md font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft">
          drag to wander · scroll to zoom · click to focus, again to open
        </p>
      </motion.div>

      <ScrollHint />
    </section>
  );
}
