"use client";

/**
 * WalletSlot — the wallet tab inside the GlobalDock.
 *
 * Three visual modes:
 *   - Disconnected: a quiet "connect" pill.
 *   - Connecting (just clicked): brief "○ connecting…" hint.
 *   - Connected (sandbox or paste): a sky-blue dot followed by
 *     a truncated public-key prefix, hover reveals the account hash.
 *
 * Click-to-toggle a dropdown anchored beneath the dock. The dropdown is
 * the lazily-loaded `<ConnectWallet>` so the casper-js-sdk / noble crypto
 * bundle (~250 KB gz) only loads on first click.
 *
 * Hidden on Pharos-chain pages via the `chain` query param so the dock
 * stays minimal where the wallet isn't usable.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CASPER_TESTNET } from "@/lib/network";
import { ConnectWallet } from "@/components/ConnectWallet";

export function WalletSlot() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchParams = useSearchParams();

  // Hide entirely on Pharos chain pages — wallet is for Casper.
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
      if (!t || !t.closest?.("[data-wallet-slot-root]")) setOpen(false);
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

  if (!isCasperPage) return null;

  const connected = wallet.pair !== null;
  const pubkeyPrefix = wallet.pair?.publicKeyHex.slice(0, 4);
  const acctHashSuffix = wallet.pair?.accountHashHex.slice(-4);

  return (
    <div data-wallet-slot-root className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={connected ? "Wallet connected" : "Connect wallet"}
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80 transition-colors hover:text-paper"
      >
        {connected ? (
          <span className="inline-flex items-baseline gap-2">
            <span className="inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full bg-sky" aria-hidden />
            <span className="font-mono tabular">
              {pubkeyPrefix}…{acctHashSuffix}
            </span>
          </span>
        ) : open ? (
          <span>close</span>
        ) : (
          <span>connect</span>
        )}
      </button>

      <AnimatePresence>
        {open && anchor ? (
          <motion.div
            key="connect-dropdown"
            initial={reducedMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="fixed z-50 -translate-x-1/2"
            style={{ left: anchor.left + anchor.width / 2, top: anchor.top, maxWidth: "min(92vw, 30rem)" }}
          >
            <ConnectWallet />
            {connected ? (
              <p
                className="mt-3 px-1 text-center font-serif text-[11px] italic leading-relaxed text-ink-quiet"
                style={{ color: "var(--color-ink-quiet)" }}
              >
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
