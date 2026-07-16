"use client";

/**
 * ConditionalProviders — gates the wallet tree on `?chain=casper-testnet`.
 *
 * Why this is needed: `WalletProvider` lives in `web/lib/casper-browser/store`
 * which imports casper-js-sdk + @noble/curves at module load. If we put it
 * in the root layout, the heavy crypto bundle lands on EVERY page
 * (home, agent profiles, capabilities, etc.) — even Pharos-only pages
 * where no wallet feature is reachable.
 *
 * Conditional mounting via `next/dynamic({ ssr: false })`:
 *   - Server render: returns the children unmodified. No casper-js-sdk
 *     module evaluates server-side either.
 *   - Client hydration: a tiny client check on `?chain=...` decides
 *     whether to dynamically import the WalletTree. The dynamic import
 *     only fires when the URL actually requests Casper — on Pharos
 *     pages the wallet chunk is never fetched.
 *
 * The trade-off is a small client-side flicker (~16ms) when toggling
 * chains, but that's invisible against the page navigation.
 */

import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { CASPER_TESTNET } from "@/lib/network";

/** Lazy-loaded wallet subtree. Only resolves when the URL is Casper. */
const WalletTree = dynamic(
  () => import("./WalletTree").then((m) => m.WalletTree),
  { ssr: false, loading: () => null },
);

export function ConditionalProviders({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const isCasper =
    (params.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;

  if (!isCasper) return <>{children}</>;
  return <WalletTree>{children}</WalletTree>;
}
