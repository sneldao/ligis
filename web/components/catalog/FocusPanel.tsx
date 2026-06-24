"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import { useCatalogUi } from "./catalogState";

type Snapshot = {
  address: string;
  exists: boolean;
  tokenId: string;
  controller: string | null;
  heldCount: number;
  held: Array<{ id: string; label: string }>;
};

export function FocusPanel() {
  const ui = useCatalogUi();
  const active = ui.activeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setSnap(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/${active}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSnap(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "failed to read");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <AnimatePresence>
      {active ? (
        <motion.aside
          key={active}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="pointer-events-auto fixed bottom-6 right-6 top-24 z-30 hidden w-[22rem] flex-col bg-paper/95 px-7 py-8 backdrop-blur-md sm:flex"
          style={{ borderLeft: "1px solid #D9D3CB" }}
        >
          <header className="flex items-baseline justify-between text-xs">
            <p className="eyebrow">Focused · live read</p>
            <span className="font-mono text-[11px] tabular text-ink-quiet">
              {loading ? "reading…" : error ? "offline" : "atlantic"}
            </span>
          </header>

          <h2 className="display mt-6 text-3xl text-ink">
            {truncateAddress(active, 6, 4)}
          </h2>

          <p className="mt-4 max-w-prose font-serif text-sm leading-relaxed italic text-ink-soft">
            {error
              ? error
              : snap?.exists
                ? `Token #${snap.tokenId} on Pharos Atlantic. ${snap.heldCount} of ${6} reference capabilities held.`
                : loading
                  ? "Reading walletOfAgent and credential ledger…"
                  : "Address has not minted an agent yet. The full dossier explains how to."}
          </p>

          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
            <Fact label="status">
              {loading ? "…" : snap?.exists ? "active" : "not minted"}
            </Fact>
            <Fact label="token">
              {loading ? "…" : snap?.exists ? `#${snap.tokenId}` : "—"}
            </Fact>
            <Fact label="credentials">
              {loading ? "…" : snap?.heldCount ?? 0}
            </Fact>
            <Fact label="origin">
              {ui.hoveredId === active ? "hover" : "click"}
            </Fact>
          </div>

          {snap?.held && snap.held.length > 0 ? (
            <div className="mt-8 space-y-3">
              <p className="eyebrow">Held capabilities</p>
              <ul className="space-y-2">
                {snap.held.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-baseline gap-3 font-mono text-[12px] tabular text-ink"
                  >
                    <span className="inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-sage" />
                    {h.id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-3 pt-10">
            <Link
              href={`/agent/${active}`}
              className="text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
            >
              Open the dossier →
            </Link>
            <Link
              href="/capabilities"
              className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              Browse the reference set
            </Link>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-quiet">{label}</p>
      <div className="font-mono tabular text-sm text-ink">{children}</div>
    </div>
  );
}
