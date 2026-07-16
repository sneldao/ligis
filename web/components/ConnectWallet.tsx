"use client";

/**
 * ConnectWallet — the dropdown anchored from the GlobalDock.
 *
 * Lazy-loads `<ConnectWalletInner />` (which is in its own module so the
 * casper-js-sdk + noble crypto bundle only lands after the user clicks)
 * via `next/dynamic({ ssr: false })`. Until then, this file's only
 * runtime cost is the React `Suspense` overhead.
 */

import dynamic from "next/dynamic";

export const ConnectWallet = dynamic(
  () => import("./ConnectWalletInner").then((m) => m.ConnectWalletInner),
  {
    ssr: false,
    loading: () => (
      <div
        className="border border-rule bg-paper px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet"
        role="status"
      >
        Loading wallet…
      </div>
    ),
  },
);
