"use client";

/**
 * WalletGate — the wallet entry point on /steward.
 *
 * The wallet was previously a tiny "connect" pill inside GlobalDock (a
 * fixed-position chrome bar on every page). That placement made it
 * invisible to judges who landed on / first, and confused the dock's
 * chain-toggle chrome with a wallet action surface that actually
 * belonged on the page where writes happen.
 *
 * WalletGate fixes both:
 *   - On Pharos pages, returns null (no Casper UI clutter, no wallet
 *     UI blocking the dock).
 *   - On Casper pages, sits in a dedicated section between the page
 *     intro and the Steward loop, with five distinct visual states
 *     keyed off `useWallet()` (see {@link WalletApi}):
 *
 *       1. Loading SDK chunk:  "Loading wallet SDK…" (appears for the
 *          ~3s of `next/dynamic` resolution on first wallet click)
 *       2. Not hydrated yet:   "○ reading wallet state…" mono-italic
 *          indicator pill. WalletProvider is rehydrating from
 *          sessionStorage.
 *       3. Disconnected:       full-width button-shaped CTA
 *          "Connect Wallet →" with terra accent border, terra fill
 *          on hover. State of default for Casper visits.
 *       4. Connected-not-funded: sky-dot status pill with truncated
 *          pubkey prefix + acct-hash suffix, click toggles the
 *          Connect panel beneath.
 *       5. Connected-funded:   sage-dot status pill showing the
 *          formatted CSPR balance, click toggles the panel.
 *
 *   - Click on any state toggles a panel anchored beneath the button.
 *     The panel is the lazily-loaded `<ConnectWallet>` (casper-js-sdk
 *     only resolves on first click) — see `web/components/ConnectWallet.tsx`.
 *
 * The WalletProvider comes from {@link WalletTree} which is itself
 * mounted by {@link ConditionalProviders} only when `?chain=casper-testnet`.
 * On Pharos pages, `useWallet()` returns a disconnected stub so this
 * component can short-circuit before reading wallet state.
 */

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CASPER_TESTNET } from "@/lib/network";
import { ConnectWallet } from "@/components/ConnectWallet";

export function WalletGate() {
  const wallet = useWallet();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const isCasperPage =
    (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;

  useEffect(() => {
    if (!open) return;
    const capture = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      setAnchor({ left: rect.left, top: rect.bottom + 8, width: rect.width });
    };
    capture();
    window.addEventListener("scroll", capture, { passive: true });
    window.addEventListener("resize", capture);
    return () => {
      window.removeEventListener("scroll", capture);
      window.removeEventListener("resize", capture);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDismiss = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest?.("[data-wallet-gate-root]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isCasperPage) {
    return (
      <div
        className="flex flex-col gap-3 border border-terra/30 bg-terra/5 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:justify-between"
        data-wallet-gate-root
      >
        <div className="space-y-1">
          <p className="eyebrow text-terra">
            Casper Buildathon · wallet unlocks in Casper mode
          </p>
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            Ligis credentials are signed with secp256k1 keys generated in
            your browser, then funded via the testnet faucet. Toggle the
            chain above, or land directly on Casper below.
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
  const pubkeyPrefix = wallet.pair?.publicKeyHex.slice(0, 6);
  const acctHashSuffix = wallet.pair?.accountHashHex.slice(-4);
  const isHydrating = !wallet.hydrated;

  const hydrationLabel = isHydrating
    ? "○ reading wallet state…"
    : !connected
      ? "○ disconnected"
      : funded
        ? `● ready · ${formatMotes(wallet.balanceMotes)}`
        : "○ awaiting funding";

  return (
    <div data-wallet-gate-root className="relative">
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Wallet · Casper Testnet</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          secp256k1 · you sign
        </span>
      </header>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose font-serif text-base leading-relaxed text-ink-soft">
          The Steward loop signs every transaction with a secp256k1 key
          generated in this browser — no server custodian, no signing
          relayer.{" "}
          {!connected ? (
            <>
              <span className="text-ink">Connect a wallet</span> to fund it
              once at the testnet faucet, then run the loop below.
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

        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (isHydrating) return;
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-busy={isHydrating || undefined}
          aria-disabled={isHydrating || undefined}
          aria-label={connected ? "Wallet details" : "Connect wallet"}
          className={`group inline-flex shrink-0 items-center justify-center gap-2 px-6 py-3 transition-colors ${
            isHydrating
              ? "cursor-progress border border-rule bg-paper text-ink-quiet opacity-60"
              : !connected
                ? "border border-terra bg-paper text-ink hover:bg-terra hover:text-paper"
                : funded
                  ? "border border-sage bg-paper text-ink hover:bg-sage hover:text-paper"
                  : "border border-sky bg-paper text-ink hover:bg-sky hover:text-paper"
          }`}
          style={{ borderRadius: 0 }}
        >
          {!connected ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
              {isHydrating ? "Connect Wallet · loading…" : "Connect Wallet →"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]">
              <span
                className={`inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full ${
                  funded ? "bg-sage" : "bg-sky"
                } group-hover:bg-paper`}
                aria-hidden
              />
              <span className="font-mono tabular">
                {funded
                  ? formatMotes(wallet.balanceMotes)
                  : pubkeyPrefix && acctHashSuffix
                    ? `${pubkeyPrefix}…${acctHashSuffix}`
                    : "connected"}
              </span>
              <span aria-hidden className="text-ink-quiet group-hover:text-paper">
                {open ? "▴" : "▾"}
              </span>
            </span>
          )}
        </button>
      </div>

      <p
        className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet"
        aria-live="polite"
      >
        {hydrationLabel}
      </p>

      <AnimatePresence>
        {open && anchor ? (
          <motion.div
            key="connect-dashboard"
            initial={reducedMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="fixed z-50 -translate-x-1/2"
            style={{
              left: anchor.left + anchor.width / 2,
              top: anchor.top,
              maxWidth: "min(92vw, 30rem)",
            }}
          >
            <ConnectWallet />
            {connected ? (
              <p className="mt-3 px-1 text-center font-serif text-[11px] italic leading-relaxed text-ink-quiet">
                {wallet.balanceMotes
                  ? `ready · ${formatMotes(wallet.balanceMotes)}`
                  : "checking balance — refresh above if the faucet funded you"}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
