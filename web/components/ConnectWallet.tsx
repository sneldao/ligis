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
        aria-label="Loading wallet"
      >
        <span className="inline-flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="spinner">
            <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" />
          </svg>
          Loading wallet…
        </span>
      </div>
    ),
  },
);
