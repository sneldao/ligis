"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ScrollHint } from "./DynamicIsland";
import { type ChainNetwork } from "@/lib/network";

type Card = {
  icon: string;
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
};

export function CatalogHero({ chain }: { chain?: ChainNetwork }) {
  const reducedMotion = useReducedMotion();

  const cards: Card[] = [
    {
      icon: "🛠️",
      title: "I build contracts",
      description:
        "Gate any function with one read: isCapable(subject, hash). No SDK, no oracle.",
      action: () => {
        document
          .getElementById("compose")
          ?.scrollIntoView({ behavior: "smooth" });
      },
      actionLabel: "See the snippet →",
    },
    {
      icon: "🤖",
      title: "I run an agent",
      description:
        "Hire Ligis to check your counterparty before you pay. Risk score, breakdown, signals.",
      action: () => {
        document.getElementById("croo")?.scrollIntoView({ behavior: "smooth" });
      },
      actionLabel: "See the risk check →",
    },
    {
      icon: "👀",
      title: "I'm just looking",
      description:
        "Verify a live credential against the registry right now. No wallet, no install.",
      action: () => {
        document
          .getElementById("verify")
          ?.scrollIntoView({ behavior: "smooth" });
      },
      actionLabel: "Try the demo →",
    },
  ];

  return (
    <section className="pointer-events-none relative min-h-[78vh] w-full sm:min-h-[90vh]">
      {/* Section headline + audience routing */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center px-6 pt-12 sm:pt-20">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="pointer-events-auto text-center"
        >
          <h2 className="display max-w-3xl text-4xl text-ink sm:text-5xl">
            Every agent is a stranger
            <br />
            until you check.
          </h2>
          <p className="mt-3 font-serif text-base italic leading-relaxed text-ink-soft sm:text-lg">
            Ligis gives every agent a portable identity and verifiable
            credentials &mdash; so you can know who you&rsquo;re paying before
            you pay, in one on-chain read.
          </p>
          {chain ? (
            <p className="mt-4 hidden font-serif text-sm italic text-ink-quiet sm:block">
              Same credential, verified on either chain.
            </p>
          ) : null}
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
              className="group flex flex-col gap-1.5 border-t border-rule bg-paper/35 px-1 py-4 text-left backdrop-blur-[1px] transition-colors hover:border-terra hover:bg-paper/55 sm:gap-2 sm:px-4 sm:py-5"
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
        className="pointer-events-none absolute inset-x-0 bottom-12 z-10 flex flex-col items-center gap-3 px-6 text-center sm:bottom-16"
      >
        <p className="hidden max-w-xl font-serif text-base italic leading-relaxed text-ink-soft sm:block">
          Click any tile to open an agent dossier.
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
