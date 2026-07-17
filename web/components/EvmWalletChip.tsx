"use client";

/**
 * Pharos account control for the global dock.
 *
 * This is deliberately an injected-wallet connection, not a promise that the
 * Steward's server-owned write flow signs through the browser account. It
 * gives visitors a real, chain-validated account they can use to identify
 * themselves while keeping public verification entirely wallet-free.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CASPER_TESTNET } from "@/lib/network";

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

export function EvmWalletChip() {
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const hasProvider = typeof window !== "undefined" && Boolean(window.ethereum);
  const onPharos = chainId === PHAROS.chainIdHex;
  const isCasper = (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;

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
        setAccount(accounts[0] ?? null);
        setChainId(activeChain);
      } catch {
        // A wallet extension failing must never affect a read-only page.
      }
    };
    void sync();

    const accountsChanged = (accounts: unknown) => {
      setAccount(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null);
      setError(null);
    };
    const chainChanged = (nextChainId: unknown) => {
      setChainId(typeof nextChainId === "string" ? nextChainId : null);
      setError(null);
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [isCasper]);

  useEffect(() => {
    if (isCasper || !open) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest("[data-evm-wallet-root]")) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [isCasper, open]);

  const connect = async () => {
    const provider = window.ethereum;
    if (!provider) {
      setError("No browser wallet found. Install or enable an EVM wallet to use Pharos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts[0] ?? null);
      const activeChain = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(activeChain);
      if (activeChain !== PHAROS.chainIdHex) {
        await switchToPharos(provider);
        setChainId((await provider.request({ method: "eth_chainId" })) as string);
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const switchNetwork = async () => {
    const provider = window.ethereum;
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      await switchToPharos(provider);
      setChainId((await provider.request({ method: "eth_chainId" })) as string);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? "…" : !account ? "connect" : !onPharos ? "switch network" : shortAddress(account);
  const statusTone = !account ? "bg-terra" : onPharos ? "bg-sage" : "bg-sky";
  const ariaLabel = !account
    ? "Connect a Pharos wallet"
    : !onPharos
      ? "Switch connected wallet to Pharos Atlantic Testnet"
      : `Wallet connected: ${account}`;

  if (isCasper) return null;

  return (
    <div data-evm-wallet-root className="relative flex items-center">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-busy={busy || undefined}
        onClick={() => setOpen((value) => !value)}
        className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper transition-colors hover:text-terra disabled:cursor-progress"
        disabled={busy}
      >
        <span className={`inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full ${statusTone}`} aria-hidden />
        <span className="tabular">{label}</span>
        <span aria-hidden className="text-paper-deep/50 transition-colors group-hover:text-paper/80">{open ? "▴" : "▾"}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-16 z-50 w-[min(92vw,28rem)] -translate-x-1/2 border border-rule bg-paper p-5 text-ink sm:left-auto sm:right-4 sm:translate-x-0"
            role="dialog"
            aria-label="Pharos wallet"
          >
            <header className="flex items-baseline justify-between gap-4">
              <p className="eyebrow text-terra">Wallet · Pharos Atlantic</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">{PHAROS.nativeCurrency.symbol} · {PHAROS.chainId}</span>
            </header>

            {!account ? (
              <>
                <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">
                  {hasProvider
                    ? "Connect an EVM wallet to identify your account and switch it to Pharos. Browsing and verification never require a wallet."
                    : "No browser wallet was detected. Enable an EVM wallet to identify your account; browsing and verification never require one."}
                </p>
                <button type="button" onClick={() => void connect()} className="mt-4 border border-terra px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper">
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
                    <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">This account is connected on another network. Switch before using Pharos-specific actions.</p>
                    <button type="button" onClick={() => void switchNetwork()} className="mt-4 border border-terra px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper">
                      Switch to Pharos →
                    </button>
                  </>
                ) : (
                  <p className="mt-3 font-serif text-sm leading-relaxed text-ink-soft">Connected to Pharos Atlantic. Ligis reads remain public; any signature is always requested by your wallet.</p>
                )}
              </>
            )}
            {error ? <p className="mt-3 font-serif text-xs leading-relaxed text-revoke" role="alert">{error}</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
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
