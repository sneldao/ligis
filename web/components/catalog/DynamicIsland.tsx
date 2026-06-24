"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { rigState, setActiveId, useCatalogUi, CATALOG_CONFIG } from "./catalogState";
import { truncateAddress } from "@/lib/format";

export function DynamicIsland({ totalCount }: { totalCount: number }) {
  const ui = useCatalogUi();
  const active = ui.activeId;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-30 flex justify-center px-4">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
        className="pointer-events-auto flex items-center gap-x-6 bg-ink/85 px-5 py-3 text-ivory backdrop-blur-md sm:gap-x-8 sm:px-7"
        style={{ color: "#F4F1EC", borderRadius: 999 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {active ? (
            <motion.div
              key="focused"
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-x-6"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80">
                focused
              </span>
              <span className="font-mono text-sm tabular text-paper">
                {truncateAddress(active, 6, 4)}
              </span>
              <a
                href={`/agent/${active}`}
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-terra hover:text-paper"
              >
                open ↗
              </a>
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  rigState.target.set(0, 0, 0);
                  rigState.zoom = CATALOG_CONFIG.zoomOut;
                }}
                aria-label="Clear focus"
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/70 hover:text-paper"
              >
                esc
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-x-6"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80">
                Ligis · catalog
              </span>
              <span className="font-mono text-sm tabular text-paper">
                {totalCount.toString().padStart(2, "0")} agents
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/70">
                drag · scroll · click
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export function EscListener() {
  const ui = useCatalogUi();
  useEffect(() => {
    if (!ui.activeId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveId(null);
        rigState.target.set(0, 0, 0);
        rigState.zoom = CATALOG_CONFIG.zoomOut;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ui.activeId]);
  return null;
}

export function ScrollHint() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const onScroll = () => setHidden(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (hidden) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8, duration: 0.6 }}
      className="pointer-events-none fixed inset-x-0 bottom-8 z-20 flex justify-center"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-quiet">
        scroll for the spec sheet ↓
      </span>
    </motion.div>
  );
}
