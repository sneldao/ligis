"use client";

import { type ChainNetwork, chainAccent } from "@/lib/network";
import { LiveDot } from "@/components/LiveDot";

/** Chain chip with a living pulse when the registry is reachable. */
export function ChainBadge({
  chain,
  live = true,
}: {
  chain: ChainNetwork;
  /** When false, show a quiet dot (offline / preview). */
  live?: boolean;
}) {
  const accent = chainAccent(chain);

  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
      {live ? (
        <LiveDot />
      ) : (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${accent.bg} opacity-50`}
          aria-hidden
        />
      )}
      <span className="text-ink-quiet">{live ? "live ·" : "offline ·"}</span>
      <span className="text-ink-soft">{chain.name}</span>
    </span>
  );
}
