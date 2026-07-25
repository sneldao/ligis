"use client";

/**
 * ConnectWalletInner — the actual connect menu body.
 *
 * Lives in its own file so its parent `ConnectWallet.tsx` can
 * `next/dynamic({ ssr: false })` it. Splitting this out keeps the
 * casper-js-sdk + noble crypto deps from being evaluated when the user
 * is on a Pharos-chain page (where the wallet is never reachable).
 *
 * Polling strategy:
 *   Progressive backoff — 4s, 6s, 10s, 15s (capped) — with a 5-minute
 *   session timeout. After 3 consecutive RPC errors, polling pauses
 *   and surfaces a "connection issue" status. The user can manually
 *   retry by clicking the refresh button.
 */

import { useEffect, useRef, useState } from "react";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CopyButton } from "@/components/CopyButton";

const POLL_INTERVALS = [4_000, 6_000, 10_000, 15_000];
const POLL_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_CONSECUTIVE_ERRORS = 3;

export function ConnectWalletInner() {
  return <ConnectPanel />;
}

function ConnectPanel() {
  const wallet = useWallet();
  const { refreshBalance, connectExtension, connectSandbox, connectPaste, disconnect } = wallet;
  const [pasteValue, setPasteValue] = useState("");
  const [poll, setPoll] = useState(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [pollPaused, setPollPaused] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);

  // Refs so the polling loop can read the latest values without
  // depending on them in the effect deps (which would re-trigger
  // the effect on every state change and cause an infinite loop).
  const balanceStatusRef = useRef(wallet.balanceStatus);
  balanceStatusRef.current = wallet.balanceStatus;
  const pollPausedRef = useRef(pollPaused);
  pollPausedRef.current = pollPaused;

  // Detect whether the Casper Wallet extension is installed.
  const [hasExtension, setHasExtension] = useState(false);
  useEffect(() => {
    setHasExtension(typeof window !== "undefined" && Boolean((window as any).CasperWalletProvider));
  }, []);

  // Progressive backoff polling.
  // Deps: [poll, pollPaused, refreshBalance] — refreshBalance is stable
  // (module-scoped), pollPaused only changes on error/retry. We do NOT
  // depend on wallet.balanceStatus because it changes on every tick,
  // which would re-trigger the effect and cause an infinite loop.
  useEffect(() => {
    if (!poll || pollPaused) {
      stopPollRef.current?.();
      stopPollRef.current = null;
      return;
    }
    let cancelled = false;
    let attempt = 0;
    let errorCount = 0;
    const startTime = Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        setPoll(false);
        return;
      }
      const prevStatus = balanceStatusRef.current;
      await refreshBalance();
      if (cancelled) return;
      const nextStatus = balanceStatusRef.current;
      if (nextStatus === "error" && prevStatus !== "error") {
        errorCount++;
        setConsecutiveErrors(errorCount);
        if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
          setPollPaused(true);
          return;
        }
      } else if (nextStatus === "ok") {
        errorCount = 0;
        setConsecutiveErrors(0);
      }
    };

    void tick();
    const scheduleNext = () => {
      if (cancelled || pollPausedRef.current) return;
      const delay = POLL_INTERVALS[Math.min(attempt, POLL_INTERVALS.length - 1)];
      attempt++;
      const timeoutId = setTimeout(async () => {
        if (cancelled || pollPausedRef.current) return;
        await tick();
        if (!cancelled && !pollPausedRef.current) scheduleNext();
      }, delay);
      stopPollRef.current = () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    };
    scheduleNext();

    return () => {
      cancelled = true;
      stopPollRef.current?.();
    };
  }, [poll, pollPaused, refreshBalance]);

  // Stop polling once funded.
  useEffect(() => {
    if (!poll) return;
    if (wallet.balanceMotes && wallet.balanceMotes !== "0") {
      setPoll(false);
      setConsecutiveErrors(0);
      setPollPaused(false);
    }
  }, [poll, wallet.balanceMotes]);

  // Manual retry from error-paused state.
  const handleManualRefresh = async () => {
    setPollPaused(false);
    setConsecutiveErrors(0);
    await refreshBalance();
  };

  if (!wallet.hydrated) {
    return (
      <div
        className="border border-rule bg-paper px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet"
        role="status"
      >
        Loading wallet…
      </div>
    );
  }

  if (wallet.pair) {
    return (
      <ConnectedPanel
        wallet={wallet}
        onDisconnect={disconnect}
        onManualRefresh={handleManualRefresh}
        pollPaused={pollPaused}
        consecutiveErrors={consecutiveErrors}
      />
    );
  }

  return (
    <div
      className="space-y-4 border border-rule bg-paper p-5"
      style={{ borderRadius: 0 }}
      role="dialog"
      aria-label="Connect a Casper wallet"
    >
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Connect · Casper Testnet</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          secp256k1 · ephemeral
        </span>
      </header>

      {/* Primary CTA — the sandbox key is the path that unblocks a
          judge in under 30 seconds. */}
      <button
        type="button"
        onClick={() => {
          connectSandbox();
          setPoll(true);
          setConsecutiveErrors(0);
          setPollPaused(false);
        }}
        className="w-full border border-terra bg-paper px-4 py-3 text-left transition-colors hover:bg-terra/10"
        style={{ borderRadius: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-terra">
          ● Generate sandbox key
        </span>
        <span className="block pt-1 font-serif text-xs leading-relaxed text-ink-soft">
          A secp256k1 key generated in this browser. Zero install. Fund
          it at the faucet once generated.
        </span>
      </button>

      {/* Casper Wallet extension — disabled when not installed, shows
          loading state while the extension popup is open. */}
      <button
        type="button"
        disabled={!hasExtension || wallet.connecting}
        onClick={() => {
          void connectExtension().then(() => setPoll(true));
        }}
        className="w-full border border-rule bg-paper px-4 py-3 text-left transition-colors hover:bg-paper-deep disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderRadius: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
          {wallet.connecting ? "○ Connecting…" : "○ Connect Casper Wallet extension"}
        </span>
        <span className="block pt-1 font-serif text-xs leading-relaxed text-ink-soft">
          {!hasExtension
            ? "Casper Wallet extension not detected. Install from casperwallet.io."
            : "Use your Casper Wallet browser extension for reads and balance checks. Signing operations require sandbox mode."}
        </span>
      </button>

      {/* Paste a hex key — collapsed disclosure. */}
      <details className="border border-rule">
        <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:text-ink">
          ○ Paste a hex key
        </summary>
        <div className="space-y-3 border-t border-rule p-4">
          <div className="flex items-baseline justify-between">
            <label htmlFor="connect-paste-input" className="eyebrow block">
              hex private key · 64 chars
            </label>
            {pasteValue.length > 0 ? (
              <span className="font-mono text-[10px] tabular text-ink-quiet">
                {pasteValue.replace(/^0x/, "").length}/64
              </span>
            ) : null}
          </div>
          <input
            id="connect-paste-input"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="0x... or hex"
            className="block w-full border border-rule bg-paper px-3 py-2 font-mono text-xs tabular text-ink outline-none focus:border-terra"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-baseline gap-3">
            <button
              type="button"
              disabled={pasteValue.trim().length === 0}
              onClick={() => {
                connectPaste(pasteValue.trim());
                setPasteValue("");
                setPoll(true);
                setConsecutiveErrors(0);
                setPollPaused(false);
              }}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors disabled:text-ink-quiet hover:decoration-terra"
            >
              connect →
            </button>
            {wallet.error ? (
              <span className="font-serif text-xs italic text-revoke">
                {typeof wallet.error === "string"
                  ? wallet.error
                  : "Invalid key format — expected 64 hex chars (with or without 0x prefix)"}
              </span>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}

function ConnectedPanel({
  wallet,
  onDisconnect,
  onManualRefresh,
  pollPaused,
  consecutiveErrors,
}: {
  wallet: ReturnType<typeof useWallet>;
  onDisconnect: () => void;
  onManualRefresh: () => Promise<void>;
  pollPaused: boolean;
  consecutiveErrors: number;
}) {
  const pair = wallet.pair;
  const funded = wallet.balanceMotes !== null && wallet.balanceMotes !== "0";
  if (!pair) return null;
  return (
    <div
      className="space-y-4 border border-rule bg-paper p-5"
      style={{ borderRadius: 0 }}
      role="dialog"
      aria-label="Wallet connected"
    >
      <header className="flex items-baseline justify-between">
        <p className="eyebrow text-sky">● Connected</p>
        <button
          type="button"
          onClick={onDisconnect}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-revoke hover:decoration-revoke"
        >
          disconnect
        </button>
      </header>

      <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-4 border-t border-rule pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          public key
        </span>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono tabular text-ink">
            {pair.publicKeyHex}
          </span>
          <CopyButton value={pair.publicKeyHex} label="copy pubkey" />
        </div>
      </div>

      <FaucetPanel
        pair={pair}
        balanceMotes={wallet.balanceMotes}
        balanceStatus={wallet.balanceStatus}
        pollPaused={pollPaused}
        consecutiveErrors={consecutiveErrors}
        onPoll={onManualRefresh}
      />

      <details className="border-t border-rule pt-3">
        <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet transition-colors hover:text-ink">
          account hash + key kind
        </summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono tabular text-ink">
              {pair.accountHash}
            </span>
            <CopyButton value={pair.accountHash} label="copy hash" />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
            {wallet.kind === "sandbox"
              ? "ephemeral session key"
              : wallet.kind === "paste"
              ? "imported · 64-hex secp256k1"
              : "Casper Wallet extension · read-only"}
          </p>
        </div>
      </details>
    </div>
  );
}

function FaucetPanel({
  pair,
  balanceMotes,
  balanceStatus,
  pollPaused,
  consecutiveErrors,
  onPoll,
}: {
  pair: { publicKeyHex: string };
  balanceMotes: string | null;
  balanceStatus: "idle" | "polling" | "ok" | "error";
  pollPaused: boolean;
  consecutiveErrors: number;
  onPoll: () => Promise<void>;
}) {
  const funded = balanceMotes !== null && balanceMotes !== "0";
  const balanceLabel = balanceMotes ? formatMotes(balanceMotes) : "—";

  return (
    <div
      className={`space-y-3 border px-4 py-3 ${
        funded
          ? "border-sage bg-sage/5"
          : pollPaused
            ? "border-revoke bg-revoke/5"
            : "border-terra bg-terra/5"
      }`}
      style={{ borderRadius: 0 }}
      data-state={funded ? "funded" : pollPaused ? "error" : "awaiting-funding"}
    >
      <header className="flex items-baseline justify-between">
        <span className="eyebrow">
          {funded ? "✓ funded" : pollPaused ? "⚠ connection issue" : "awaiting funding"}
        </span>
        <span className="font-mono tabular text-ink">
          {balanceLabel}
          {funded ? " cspr" : ""}
          {balanceStatus === "polling" && !pollPaused ? (
            <span className="ml-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-terra" />
              polling
            </span>
          ) : null}
        </span>
      </header>

      {!funded ? (
        <div className="space-y-2">
          {pollPaused ? (
            <p className="font-serif text-sm leading-relaxed text-revoke">
              Balance check failed {consecutiveErrors} times. The RPC
              endpoint may be temporarily unavailable.
            </p>
          ) : (
            <p className="font-serif text-sm leading-relaxed text-ink-soft">
              Copy the public key, paste it into the Casper Testnet Faucet,
              and click refresh once CSPR lands. Usually under 30 seconds.
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a
              href="https://testnet.cspr.live/tools/faucet"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
            >
              testnet.cspr.live/tools/faucet ↗
            </a>
            <CopyButton value={pair.publicKeyHex} label="copy pubkey" />
            <button
              type="button"
              onClick={() => void onPoll()}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              {pollPaused ? "retry →" : "refresh"}
            </button>
          </div>
        </div>
      ) : (
        <p className="font-serif text-sm italic leading-relaxed text-sage">
          The Steward loop will sign and submit every transaction from
          this browser wallet — no server custodian.
        </p>
      )}
    </div>
  );
}
