"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { EscListener, ScrollHint } from "./DynamicIsland";
import { FocusPanel } from "./FocusPanel";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

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

type Card = {
  icon: string;
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
};

export function CatalogHero() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const cards: Card[] = [
    {
      icon: "🛠️",
      title: "I build contracts",
      description: "Gate any function with one read: isCapable(subject, hash). No SDK, no oracle.",
      action: () => {
        document.getElementById("compose")?.scrollIntoView({ behavior: "smooth" });
      },
      actionLabel: "See the snippet →",
    },
    {
      icon: "🤖",
      title: "I run an agent",
      description: "CLI & MCP server for identity minting, credential issuance, and the autonomous boot loop.",
      action: () => router.push("/steward"),
      actionLabel: "Watch the steward →",
    },
    {
      icon: "👀",
      title: "I'm just looking",
      description: "Verify a live credential against the registry right now. No wallet, no install.",
      action: () => {
        document.getElementById("verify")?.scrollIntoView({ behavior: "smooth" });
      },
      actionLabel: "Try the demo →",
    },
  ];

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden">
      <div className="absolute inset-0">
        <SceneErrorBoundary>
          <CatalogScene />
        </SceneErrorBoundary>
      </div>

      <EscListener />
      <FocusPanel />

      {/* Hero headline + audience routing */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center px-6 pt-[8vh] sm:pt-[15vh]">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="pointer-events-auto text-center"
        >
          <h1 className="display max-w-3xl text-4xl text-ink sm:text-6xl">
            Permissions for AI agents.
          </h1>
          <p className="mt-3 font-serif text-lg italic leading-relaxed text-ink-soft sm:text-xl">
            Issue. Verify. Gate. One read on Pharos.
          </p>
        </motion.div>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="pointer-events-auto mt-6 grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:mt-10 sm:grid-cols-3 sm:gap-4"
        >
          {cards.map((card) => (
            <button
              key={card.title}
              type="button"
              onClick={card.action}
              className="group flex flex-col gap-1.5 bg-paper/80 px-5 py-4 text-left backdrop-blur-sm transition-colors hover:bg-paper hover:border-terra sm:gap-2 sm:px-6 sm:py-6"
              style={{ border: "1px solid #D9D3CB" }}
            >
              <span className="text-lg" aria-hidden>
                {card.icon}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft group-hover:text-ink">
                {card.title}
              </span>
              <p className="font-serif text-sm leading-relaxed text-ink-quiet group-hover:text-ink-soft">
                {card.description}
              </p>
              <span className="mt-auto pt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-terra opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {card.actionLabel}
              </span>
            </button>
          ))}
        </motion.div>
      </div>

      {/* Bottom controls hint */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex flex-col items-center gap-3 px-6 text-center sm:bottom-24"
      >
        <p className="hidden max-w-xl font-serif text-base italic leading-relaxed text-ink-soft sm:block">
          Click any tile to verify a live credential.
        </p>
        <p className="hidden max-w-md font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet sm:mt-2 sm:block">
          drag · scroll · WASD · click
        </p>
        <p className="max-w-md font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet sm:hidden">
          drag · pinch · tap
        </p>
      </motion.div>

      <ScrollHint />
    </section>
  );
}
