"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/lib/arena/scenario";

function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);

  return <>{formatUsd(shown)}</>;
}

export function TreasuryMeter({
  balance,
  pending,
  blocked,
}: {
  balance: number;
  pending: number;
  blocked: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
          Treasury
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 whitespace-nowrap">
        <span className="tabular font-sans text-xl font-medium text-fog sm:text-2xl">
          <CountUp value={balance} />
        </span>
        <AnimatePresence mode="wait" initial={false}>
          {blocked > 0 ? (
            <motion.span
              key="blocked"
              initial={reduce ? false : { opacity: 0, scale: 1.6, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 16 }}
              className="tabular font-mono text-xs font-medium text-go"
            >
              {formatUsd(blocked)} saved
            </motion.span>
          ) : pending > 0 ? (
            <motion.span
              key="pending"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: [1, 0.45, 1] }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 1.1, repeat: Infinity }}
              className="tabular font-mono text-xs text-stop"
            >
              −{formatUsd(pending)} at the gate
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
