"use client";

/**
 * WalletChip — the wallet pill in the GlobalDock.
 *
 * Extracted from `WalletGate` so the dock pill and the /steward companion
 * share the same `useWallet()`-driven state and the same click-to-anchor
 * panel. Auto-renders null on Pharos pages (gated on `?chain=casper-testnet`)
 * so Pharos visitors see no Casper chrome competing for attention.
 *
 * Colour treatment (DESIGN.md compliant — no chrome competing for
 * attention with the page slug or the chain tabs):
 *   - The 5-state mono label sits at the same hierarchy as the dock's
 *     ChainSelector + nav links.
 *   - The leading dot picks the state colour: terra (needs connection),
 *     sage (funded), sky (connected-not-funded), paper-deep/60 (hydrating).
 *   - Hovers shift colour (signalled via `aria-busy` / class swaps), no scale
 *     or translate; respects `prefers-reduced-motion`.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CASPER_TESTNET } from "@/lib/network";
import { ConnectWallet } from "@/components/ConnectWallet";

export function WalletChip() {
  const wallet = useWallet();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const isCasperPage =
    (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;

  const capture = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + 8, width: rect.width });
  };

  useEffect(() => {
    if (!open) return;
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
      if (!t || !t.closest?.("[data-wallet-chip-root]")) setOpen(false);
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
  const funded = wallet.balanceMotes !== null && wallet.balanceMotes !== "0";
  const isHydrating = !wallet.hydrated;

  // Visible label carries only the action-or-value, not the noun. The
  // dot + aria-label provide identity for screen-readers and colour-vision.
  const label = isHydrating
    ? "—"
    : !connected
      ? "connect"
      : funded
        ? `${formatMotes(wallet.balanceMotes)} cspr`
        : "fund →";

  const ariaLabel = isHydrating
    ? "Wallet — reading state"
    : !connected
      ? "Connect wallet"
      : funded
        ? `Wallet — ${formatMotes(wallet.balanceMotes)} CSPR, funded`
        : "Wallet — fund the Casper testnet faucet to continue";

  const dot = isHydrating
    ? "bg-paper-deep/60"
    : !connected
      ? "bg-terra"
      : funded
        ? "bg-sage"
        : "bg-sky";

  const tone = isHydrating
    ? "cursor-progress text-paper-deep/60"
    : !connected
      ? "text-paper hover:text-terra"
      : "text-paper hover:text-terra";

  return (
    <div
      data-wallet-chip-root
      data-wallet-state={
        isHydrating
          ? "hydrating"
          : !connected
            ? "disconnected"
            : funded
              ? "funded"
              : "pending"
      }
      className="relative flex items-center gap-x-1.5"
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={isHydrating}
        onClick={() => {
          if (isHydrating) return;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-busy={isHydrating || undefined}
        aria-label={ariaLabel}
        className={`group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${tone}`}
      >
        <span
          className={`inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full ${dot}`}
          aria-hidden
        />
        <span className="tabular">{label}</span>
        <span
          aria-hidden
          className="text-paper-deep/50 transition-colors group-hover:text-paper/80"
        >
          {open ? "▴" : "▾"}
        </span>
      </button>

      <AnimatePresence>
        {open && anchor ? (
          <motion.div
            key="wallet-chip-panel"
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
