"use client";

/**
 * UnifiedWalletChip — single dock pill for both chains' wallets.
 *
 * The dock pill uses backdrop-blur-md + framer-motion transforms, both
 * of which make it a CSS containing block for position:fixed descendants.
 * Portaling the panel to document.body avoids this entirely — coordinates
 * from getBoundingClientRect() are true viewport-relative, and the panel
 * renders at the correct position regardless of which ancestor chain the
 * dock lives in.
 *
 * Active chain: shows its wallet UI prominently.
 * Inactive chain: visible as a switch-chain footer so users discover
 * both options from a single entry point.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { ConnectWallet } from "@/components/ConnectWallet";
import { CASPER_TESTNET } from "@/lib/network";

// ── Pharos (EVM) wallet logic ──────────────────────────────────────

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

const PHAROS = {
  chainId: 688689,
  chainIdHex: "0xa8231",
  chainName: "Pharos Atlantic Testnet",
  rpcUrls: ["https://atlantic.dplabs-internal.com"],
  blockExplorerUrls: ["https://atlantic.pharosscan.xyz"],
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
} as const;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}··${address.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Wallet connection was cancelled.";
}

async function switchToPharos(provider: Eip1193): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: PHAROS.chainIdHex }] });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 4902)) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: PHAROS.chainIdHex,
        chainName: PHAROS.chainName,
        nativeCurrency: PHAROS.nativeCurrency,
        rpcUrls: [...PHAROS.rpcUrls],
        blockExplorerUrls: [...PHAROS.blockExplorerUrls],
      }],
    });
  }
}

// ── Main component ─────────────────────────────────────────────────

export function UnifiedWalletChip() {
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  const isCasper = (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;
  const casperWallet = useWallet();

  // Pharos EVM state
  const [pharosAccount, setPharosAccount] = useState<string | null>(null);
  const [pharosChainId, setPharosChainId] = useState<string | null>(null);
  const [pharosBusy, setPharosBusy] = useState(false);
  const [pharosError, setPharosError] = useState<string | null>(null);

  const hasProvider = typeof window !== "undefined" && Boolean(window.ethereum);
  const onPharos = pharosChainId === PHAROS.chainIdHex;

  // Sync EVM wallet state on Pharos pages
  useEffect(() => {
    if (isCasper) return;
    const provider = window.ethereum;
    if (!provider) return;
    const sync = async () => {
      try {
        const [accounts, activeChain] = await Promise.all([
          provider.request({ method: "eth_accounts" }) as Promise<string[]>,
          provider.request({ method: "eth_chainId" }) as Promise<string>,
        ]);
        setPharosAccount(accounts[0] ?? null);
        setPharosChainId(activeChain);
      } catch {
        // Wallet extension failing must never affect a read-only page.
      }
    };
    void sync();
    const onAccounts = (accounts: unknown) => {
      setPharosAccount(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null);
      setPharosError(null);
    };
    const onChain = (next: unknown) => {
      setPharosChainId(typeof next === "string" ? next : null);
      setPharosError(null);
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [isCasper]);

  // Capture anchor position relative to viewport
  const capture = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const panelWidth = Math.min(window.innerWidth * 0.92, 480);
    const buttonCenter = rect.left + rect.width / 2;
    // Left edge of panel, clamped to stay within viewport margins.
    const left = Math.max(
      12,
      Math.min(buttonCenter - panelWidth / 2, window.innerWidth - panelWidth - 12),
    );
    setAnchor({ left, top: rect.bottom + 8 });
  }, []);

  useEffect(() => {
    if (!open) return;
    capture();
    window.addEventListener("scroll", capture, { passive: true });
    window.addEventListener("resize", capture);
    return () => {
      window.removeEventListener("scroll", capture);
      window.removeEventListener("resize", capture);
    };
  }, [open, capture]);

  // Dismiss: click outside or Escape
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest?.("[data-unified-wallet-root]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [searchParams]);

  // Pharos connect
  const pharosConnect = async () => {
    const provider = window.ethereum;
    if (!provider) {
      setPharosError("No browser wallet found. Install or enable an EVM wallet to use Pharos.");
      return;
    }
    setPharosBusy(true);
    setPharosError(null);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setPharosAccount(accounts[0] ?? null);
      const activeChain = (await provider.request({ method: "eth_chainId" })) as string;
      setPharosChainId(activeChain);
      if (activeChain !== PHAROS.chainIdHex) {
        await switchToPharos(provider);
        setPharosChainId((await provider.request({ method: "eth_chainId" })) as string);
      }
    } catch (nextError) {
      setPharosError(errorMessage(nextError));
    } finally {
      setPharosBusy(false);
    }
  };

  const pharosSwitchNetwork = async () => {
    const provider = window.ethereum;
    if (!provider) return;
    setPharosBusy(true);
    setPharosError(null);
    try {
      await switchToPharos(provider);
      setPharosChainId((await provider.request({ method: "eth_chainId" })) as string);
    } catch (nextError) {
      setPharosError(errorMessage(nextError));
    } finally {
      setPharosBusy(false);
    }
  };

  // ── Chip label + state ──

  let dot: string;
  let label: string;
  let ariaLabel: string;

  if (isCasper) {
    const connected = casperWallet.pair !== null;
    const funded = casperWallet.balanceMotes !== null && casperWallet.balanceMotes !== "0";
    const isHydrating = !casperWallet.hydrated;

    dot = isHydrating
      ? "bg-paper-deep/60"
      : !connected
        ? "bg-terra"
        : funded
          ? "bg-sage"
          : "bg-sky";

    label = isHydrating
      ? "—"
      : !connected
        ? "connect"
        : funded
          ? `${formatMotes(casperWallet.balanceMotes)} cspr`
          : "fund →";

    ariaLabel = isHydrating
      ? "Casper wallet — reading state"
      : !connected
        ? "Connect a Casper wallet"
        : funded
          ? `Casper wallet — ${formatMotes(casperWallet.balanceMotes)} CSPR, funded`
          : "Casper wallet — fund the testnet faucet to continue";
  } else {
    dot = !pharosAccount ? "bg-terra" : onPharos ? "bg-sage" : "bg-sky";

    label = pharosBusy ? "…" : !pharosAccount ? "connect" : !onPharos ? "switch network" : shortAddress(pharosAccount);

    ariaLabel = !pharosAccount
      ? "Connect a Pharos wallet"
      : !onPharos
        ? "Switch connected wallet to Pharos Atlantic Testnet"
        : `Pharos wallet: ${pharosAccount}`;
  }

  return (
    <div data-unified-wallet-root className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper transition-colors hover:text-terra"
      >
        <span
          className={`inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full ${dot}`}
          aria-hidden
        />
        <span className="tabular">{label}</span>
        <span aria-hidden className="text-paper-deep/50 transition-colors group-hover:text-paper/80">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && anchor && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              <motion.div
                key="wallet-panel"
                initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="fixed z-50 max-h-[calc(100vh-8rem)] overflow-y-auto"
                style={{
                  left: anchor.left,
                  top: anchor.top,
                  width: "min(92vw, 30rem)",
                }}
              >
                {isCasper ? (
                  <ConnectWallet />
                ) : (
                  <PharosPanelContent
                    account={pharosAccount}
                    onPharos={onPharos}
                    busy={pharosBusy}
                    error={pharosError}
                    hasProvider={hasProvider}
                    onConnect={pharosConnect}
                    onSwitchNetwork={pharosSwitchNetwork}
                  />
                )}
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

// ── Pharos (EVM) panel ────────────────────────────────────────────

function PharosPanelContent({
  account,
  onPharos,
  busy,
  error,
  hasProvider,
  onConnect,
  onSwitchNetwork,
}: {
  account: string | null;
  onPharos: boolean;
  busy: boolean;
  error: string | null;
  hasProvider: boolean;
  onConnect: () => void;
  onSwitchNetwork: () => void;
}) {
  return (
    <div className="border border-rule bg-paper p-5 text-ink" role="dialog" aria-label="Pharos wallet">
      <header className="flex items-baseline justify-between gap-4">
        <p className="eyebrow text-terra">Wallet · Pharos Atlantic</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          {PHAROS.nativeCurrency.symbol} · {PHAROS.chainId}
        </span>
      </header>

      {!account ? (
        <>
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">
            {hasProvider
              ? "Connect an EVM wallet to identify your account and switch it to Pharos. Browsing and verification never require a wallet."
              : "No browser wallet was detected. Enable an EVM wallet to identify your account; browsing and verification never require one."}
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="mt-4 border border-terra px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50"
            style={{ borderRadius: 0 }}
          >
            Connect wallet →
          </button>
        </>
      ) : (
        <>
          <div className="mt-4 border-y border-rule py-3">
            <span className="eyebrow block">Connected account</span>
            <span className="mt-1 block break-all font-mono text-xs tabular text-ink">{account}</span>
          </div>
          {!onPharos ? (
            <>
              <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">
                This account is connected on another network. Switch before using Pharos-specific actions.
              </p>
              <button
                type="button"
                onClick={onSwitchNetwork}
                disabled={busy}
                className="mt-4 border border-terra px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50"
                style={{ borderRadius: 0 }}
              >
                Switch to Pharos →
              </button>
            </>
          ) : (
            <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">
              Connected to Pharos Atlantic. Ligis reads remain public; any signature is always requested by your wallet.
            </p>
          )}
        </>
      )}
      {error ? <p className="mt-3 font-serif text-xs leading-relaxed text-revoke" role="alert">{error}</p> : null}
    </div>
  );
}
