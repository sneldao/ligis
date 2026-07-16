"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { PHASES } from "@/lib/steward-events";
import { Rule } from "./Rule";

const CYCLE_MS = 1200;
const HOLD_MS = 1600;

const PHASE_THOUGHTS: Record<string, string> = {
  BOOT: "I need to know who I am.",
  REASON: "What does this goal require of me?",
  GATE: "Checking what I already hold…",
  ACT: "Issuing what I'm missing.",
  RECORD: "Anchoring my proof to 0G.",
};

export function StewardTeaser() {
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const total = PHASES.length;

    const tick = () => {
      step = (step + 1) % (total + 1);
      setActiveIndex(step);
      timer = setTimeout(tick, step === total ? HOLD_MS : CYCLE_MS);
    };

    timer = setTimeout(tick, CYCLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section
      id="steward"
      className="mx-auto max-w-5xl scroll-mt-24 px-8 pt-32 sm:pt-44"
    >
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Watch an agent boot itself</p>
        <p className="font-mono text-[11px] tabular text-ink-quiet">
          0G compute + 0G storage
        </p>
      </header>
      <Rule className="mt-4" />

      <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[18rem_1fr]">
        <div>
          <h2 className="display text-3xl text-ink">The autonomous loop.</h2>
          <p className="mt-6 max-w-prose font-serif text-base leading-relaxed text-ink-soft">
            Given a goal, the Trust Steward ensures its own identity, reasons
            about which capabilities the goal needs (via 0G Compute, TEE-verified),
            gates on the credential registry, self-issues anything missing, and
            anchors a manifest of the evidence into 0G Storage. End to end.
          </p>
          {activeIndex > 0 && activeIndex <= PHASES.length ? (
            <blockquote
              key={activeIndex}
              className="animate-fadeInUp mt-6 border-l border-terra pl-4 font-serif text-lg italic leading-snug text-ink"
            >
              {PHASE_THOUGHTS[PHASES[activeIndex - 1].key]}
            </blockquote>
          ) : null}
          <Link
            href="/steward?chain=casper-testnet"
            className="mt-8 inline-block text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
          >
            Try on Casper · connect a wallet →
          </Link>
        </div>

        <ol className="space-y-0">
          {PHASES.map((p, i) => {
            const status =
              activeIndex === PHASES.length
                ? "done"
                : i < activeIndex
                  ? "done"
                  : i === activeIndex
                    ? "running"
                    : "idle";
            return (
              <PhasePill
                key={p.key}
                index={i + 1}
                label={p.label}
                gloss={p.gloss}
                status={status}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function PhasePill({
  index,
  label,
  gloss,
  status,
  reducedMotion,
}: {
  index: number;
  label: string;
  gloss: string;
  status: "idle" | "running" | "done";
  reducedMotion: boolean | null;
}) {
  const dotColor =
    status === "running"
      ? "bg-terra animate-pulse"
      : status === "done"
        ? "bg-sage"
        : "bg-rule";
  const labelColor = status === "idle" ? "text-ink-quiet" : "text-ink";

  return (
    <li>
      <motion.div
        layout
        className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-6 py-4"
        animate={status === "running" && !reducedMotion ? { x: [0, 2, 0] } : { x: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div className="flex items-center gap-3">
          <span className={`block h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />
          <span className="font-mono text-[11px] tabular text-ink-quiet">
            {String(index).padStart(2, "0")}
          </span>
        </div>
        <span className={`font-mono text-sm tabular ${labelColor}`}>{label}</span>
        <span className="font-serif text-xs italic text-ink-quiet">{gloss}</span>
      </motion.div>
      <Rule tone="soft" />
    </li>
  );
}
