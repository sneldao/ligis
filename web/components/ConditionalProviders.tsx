"use client";

/**
 * ConditionalProviders — mounts the wallet context around the app.
 *
 * The name is historical: this used to gate `WalletProvider` on
 * `?chain=casper-testnet` via `next/dynamic({ ssr: false })`. That made the
 * entire page bail out of server rendering on the default (Casper) chain —
 * every URL without an explicit EVM `?chain=` shipped no HTML at all.
 *
 * It is unconditional now because:
 *   - `WalletProvider` is SSR-safe: it renders `INITIAL` state on the server
 *     and hydrates the persisted wallet inside an effect, so server markup
 *     and first client render agree.
 *   - The store is already in the shared bundle: `UnifiedWalletChip` in the
 *     dock statically imports `@/lib/casper-browser/store` on every page, so
 *     lazy-loading the provider bought nothing.
 */

import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/casper-browser/store";

export function ConditionalProviders({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
