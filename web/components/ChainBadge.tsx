"use client";

import { type ChainNetwork, chainAccent } from "@/lib/network";

export function ChainBadge({ chain }: { chain: ChainNetwork }) {
  const isCasper = chain.kind === "casper";
  const label = isCasper ? "Casper Testnet" : "Pharos Atlantic";

  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${chainAccent(chain).bg}`} aria-hidden />
      {label}
    </span>
  );
}
