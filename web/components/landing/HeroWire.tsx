"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

interface WireItem {
  vendor: string;
  amount: string;
  note: string;
  verdict: "GO" | "STOP";
}

const TRAFFIC: WireItem[] = [
  {
    vendor: "Northwind Data",
    amount: "$1,200",
    note: "Contracted payee, in budget",
    verdict: "GO",
  },
  {
    vendor: "Kestrel Compute",
    amount: "$340",
    note: "GPU hours, matches quote",
    verdict: "GO",
  },
  {
    vendor: "“Northwind Data”",
    amount: "$60,000",
    note: "Payee differs from contract",
    verdict: "STOP",
  },
  {
    vendor: "Helio Oracle",
    amount: "$0.02",
    note: "Per-call price feed",
    verdict: "GO",
  },
  {
    vendor: "Atlas Freight",
    amount: "$4,800",
    note: "40× the usual amount",
    verdict: "STOP",
  },
  {
    vendor: "Vantage API",
    amount: "$89",
    note: "Monthly plan renewal",
    verdict: "GO",
  },
];

const CYCLE_MS = 2600;

export function HeroWire() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setTick((n) => n + 1), CYCLE_MS);
    return () => clearInterval(t);
  }, [reduce]);

  const current = TRAFFIC[tick % TRAFFIC.length];
  const history = Array.from({ length: 4 }, (_, i) => {
    const n = tick - 1 - i;
    return n >= 0 ? { n, item: TRAFFIC[n % TRAFFIC.length] } : null;
  }).filter((x): x is { n: number; item: WireItem } => x !== null);
  const stop = current.verdict === "STOP";

  return (
    <div
      className="beam flex flex-col gap-5 p-5 sm:p-6"
      data-state={stop ? "stop" : "go"}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
          Agent payments · sample traffic
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
          <span
            className="size-1.5 animate-pulse rounded-full bg-signal"
            aria-hidden
          />
          Gate
        </span>
      </div>

      <div className="relative h-36 overflow-hidden" aria-live="off">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={tick}
            initial={
              reduce ? false : { opacity: 0, y: 24, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -24, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.215, 0.61, 0.355, 1] }}
            className="absolute inset-0 flex items-end justify-between gap-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm text-fog-quiet">
                {current.vendor}
              </span>
              <span className="tabular font-sans text-4xl font-medium text-fog sm:text-5xl">
                {current.amount}
              </span>
              <span className="truncate font-mono text-xs text-fog-quiet">
                {current.note}
              </span>
            </div>
            <span
              className={`shrink-0 font-mono text-5xl font-medium tracking-tight sm:text-6xl ${
                stop ? "text-stop" : "text-go"
              }`}
            >
              {current.verdict}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      <ul className="flex flex-col border-t border-night-rule">
        {history.map(({ n, item }) => (
          <li
            key={n}
            className="flex items-baseline justify-between gap-3 border-b border-night-rule py-2 font-mono text-[11px] last:border-b-0"
          >
            <span className="truncate text-fog-quiet">
              {item.vendor} ·{" "}
              <span className="tabular text-fog">{item.amount}</span>
            </span>
            <span className={item.verdict === "STOP" ? "text-stop" : "text-go"}>
              {item.verdict}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
