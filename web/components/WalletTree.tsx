"use client";

/**
 * WalletTree — the actual subtree that mounts the WalletProvider.
 *
 * Lives in its own file so `next/dynamic({ ssr: false })` in
 * ConditionalProviders only fetches THIS module's bundle when the
 * chain query param says Casper. None of the wallet/crypto deps
 * (casper-js-sdk, @noble/curves, @noble/hashes, casper-eip-712)
 * end up in the static bundle for Pharos-chain pages.
 *
 * Once mounted, this component is invisible — it just supplies the
 * wallet Context for whatever children need it (GlobalDock's
 * WalletSlot, StewardRunner, the connect menu).
 */

import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/casper-browser/store";

export function WalletTree({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
