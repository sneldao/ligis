"use client";

/**
 * WalletGate — the wallet entry point on /steward.
 *
 * Self-contained: carries the connect/fund/disconnect action inline so
 * the user never has to look up at the dock to proceed. The dock
 * WalletChip remains as a secondary status indicator for when you've
 * scrolled past this gate.
 *
 *   Pharos mode  → "Switch to Casper" CTA (the action is the link).
 *   Casper mode  → inline "Connect wallet" button that opens the
 *                  ConnectWallet panel directly below. Once connected,
 *                  the panel shows balance + faucet. Once funded, a
 *                  one-line "ready" status.
 *
 * The ConnectWallet panel is lazy-loaded via next/dynamic so the
 * casper-js-sdk + noble crypto bundle only lands after the user clicks.
 */

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CASPER_TESTNET } from "@/lib/network";
import { ConnectWallet } from "@/components/ConnectWallet";

export function WalletGate() {
  const wallet = useWallet();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const isCasperPage =
    (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;

  if (!isCasperPage) {
    return (
      <div className="flex flex-col gap-3 border border-terra/30 bg-terra/5 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:justify-between">
        <div className="space-y-1">
          <p className="eyebrow text-terra">
            Casper Buildathon · wallet unlocks in Casper mode
          </p>
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            Ligis credentials are signed with secp256k1 keys generated in
            your browser, then funded via the testnet faucet. Switch to
            Casper to connect and run the live loop.
          </p>
        </div>
        <Link
          href="/steward?chain=casper-testnet"
          className="shrink-0 border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper"
          style={{ borderRadius: 0 }}
        >
          Switch to Casper →
        </Link>
      </div>
    );
  }

  const connected = wallet.pair !== null;
  const funded = wallet.balanceMotes !== null && wallet.balanceMotes !== "0";
  const isHydrating = !wallet.hydrated;
  const balanceLabel = wallet.balanceMotes ? formatMotes(wallet.balanceMotes) : "—";

  return (
    <div className="relative space-y-4" data-wallet-gate-root>
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Wallet · Casper Testnet</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          secp256k1 · you sign
        </span>
      </header>

      <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
        The Steward loop signs every transaction with a secp256k1 key
        generated in this browser — no server custodian, no signing
        relayer.{" "}
        {!connected ? (
          <>
            Connect below to generate a key, fund it once at the testnet
            faucet, then run the loop.
          </>
        ) : funded ? (
          <>Funded. Run the loop below — the wallet signs every step.</>
        ) : (
          <>
            <span className="text-ink">Fund it once</span> at the testnet
            faucet, then come back here and run the loop.
          </>
        )}
      </p>

      {/* Inline action — the connect button lives here, not in the dock. */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {!connected ? (
          <button
            type="button"
            disabled={isHydrating}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50"
            style={{ borderRadius: 0 }}
          >
            {isHydrating ? "reading state…" : open ? "close" : "Connect wallet →"}
          </button>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.16em] ${funded ? "text-sage" : "text-sky"}`}
              aria-live="polite"
            >
              {funded ? `● ready · ${balanceLabel} cspr` : "○ awaiting funding"}
            </span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              {open ? "hide wallet" : "manage wallet"}
            </button>
          </div>
        )}
      </div>

      {/* Inline panel — renders directly in the page flow, not as a
          floating popover. Lazy-loads the crypto bundle on first open. */}
      {open ? (
        <div className="mt-2 max-w-lg">
          <ConnectWallet />
        </div>
      ) : null}
    </div>
  );
}
