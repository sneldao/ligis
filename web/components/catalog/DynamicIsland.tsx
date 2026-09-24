"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  CATALOG_CONFIG,
  fieldChainId,
  rigState,
  setActiveId,
  useCatalogUi,
} from "./catalogState";
import { getFieldLiveAgents } from "./catalogState";
import { isInteractiveAgent } from "./agentSeed";
import { truncateAddress } from "@/lib/format";

export function DynamicIsland() {
  const ui = useCatalogUi();
  const active = ui.activeId;
  const liveCount = ui.liveCount;
  const chainQs = fieldChainId
    ? `?chain=${encodeURIComponent(fieldChainId)}`
    : "";
  const liveAgent = active
    ? getFieldLiveAgents().find(
        (a) => a.address.toLowerCase() === active.toLowerCase(),
      )
    : undefined;
  const canOpen = Boolean(liveAgent && isInteractiveAgent(liveAgent));

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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-x-6"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80">
                {canOpen ? "focused" : "ghost"}
              </span>
              <span className="font-mono text-sm tabular text-paper">
                {truncateAddress(active, 6, 4)}
              </span>
              {canOpen ? (
                <a
                  href={`/agent/${encodeURIComponent(active)}${chainQs}`}
                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-terra hover:text-paper"
                >
                  open ↗
                </a>
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/70">
                  not minted
                </span>
              )}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-x-6"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80">
                Ligis · field
              </span>
              <span className="font-mono text-sm tabular text-paper">
                {liveCount.toString().padStart(2, "0")} live
              </span>
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/70 sm:inline">
                drag · scroll · click a live specimen
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
        e.preventDefault();
        setActiveId(null);
        rigState.target.set(0, 0, 0);
        rigState.zoom = CATALOG_CONFIG.zoomDefault;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ui.activeId]);
  return null;
}
