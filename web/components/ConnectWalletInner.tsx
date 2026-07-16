"use client";

/**
 * ConnectWalletInner — the actual connect menu body.
 *
 * Lives in its own file so its parent `ConnectWallet.tsx` can
 * `next/dynamic({ ssr: false })` it. Splitting this out keeps the
 * casper-js-sdk + noble crypto deps from being evaluated when the user
 * is on a Pharos-chain page (where the wallet is never reachable).
 *
 * Composition (DESIGN.md compliant — no card/tile/panel chrome):
 *   - One full-width primary CTA: "Generate sandbox key". That's the
 *     path that unblocks a judge in 30 seconds.
 *   - Paste-a-hex-key sits inside a `<details>` disclosure so the prose
 *     weight is gone by default.
 *   - Once connected, two visible things: the pubkey (copy-able) and
 *     the balance + faucet CTA. Account hash + key kind hide behind a
 *     disclosure for the rare case anyone cares.
 *   - The secp256k1 rationale is gone from this surface; the
 *     /steward WalletGate companion carries it where prose belongs.
 */

import { useEffect, useRef, useState } from "react";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CopyButton } from "@/components/CopyButton";

export function ConnectWalletInner() {
  return <ConnectPanel />;
}

function ConnectPanel() {
  const wallet = useWallet();
  const [pasteValue, setPasteValue] = useState("");
  const [poll, setPoll] = useState(false);
  const stopPollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!poll) {
      stopPollRef.current?.();
      stopPollRef.current = null;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await wallet.refreshBalance();
    };
    void tick();
    const id = setInterval(tick, 6_000);
    stopPollRef.current = () => {
      cancelled = true;
      clearInterval(id);
    };
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [poll, wallet]);

  useEffect(() => {
    if (!poll) return;
    if (wallet.balanceMotes && wallet.balanceMotes !== "0") {
      setPoll(false);
    }
  }, [poll, wallet.balanceMotes]);

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
        onDisconnect={wallet.disconnect}
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
          judge in under 30 seconds. Full-width, terra edge, sits above
          everything else. Hover applies a terra tint (not a full bg
          flip) so the title + description stay readable as-is. */}
      <button
        type="button"
        onClick={() => {
          wallet.connectSandbox();
          setPoll(true);
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

      {/* Paste a hex key — collapsed disclosure. The prose weight is gone
          unless a developer explicitly opens it. */}
      <details className="border border-rule">
        <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:text-ink">
          ○ Paste a hex key
        </summary>
        <div className="space-y-3 border-t border-rule p-4">
          <label htmlFor="connect-paste-input" className="eyebrow block">
            hex private key · 64 chars
          </label>
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
                wallet.connectPaste(pasteValue.trim());
                setPasteValue("");
                setPoll(true);
              }}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors disabled:text-ink-quiet hover:decoration-terra"
            >
              connect →
            </button>
            {wallet.error ? (
              <span className="font-serif text-xs italic text-revoke">
                {typeof wallet.error === "string"
                  ? wallet.error
                  : JSON.stringify(wallet.error)}
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
}: {
  wallet: ReturnType<typeof useWallet>;
  onDisconnect: () => void;
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

      {/* Two-line primary surface: pubkey (copy) + balance. Everything
          else hides behind one disclosure so the visual footprint is
          one row, not four. */}
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
        onPoll={async () => {
          await wallet.refreshBalance();
        }}
      />

      {/* Rare-need disclosure: account hash + key kind. Most judges will
          never open this. */}
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
              : "imported · 64-hex secp256k1"}
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
  onPoll,
}: {
  pair: { publicKeyHex: string };
  balanceMotes: string | null;
  balanceStatus: "idle" | "polling" | "ok" | "error";
  onPoll: () => Promise<void>;
}) {
  const funded = balanceMotes !== null && balanceMotes !== "0";
  const balanceLabel = balanceMotes ? formatMotes(balanceMotes) : "—";

  return (
    <div
      className={`space-y-3 border px-4 py-3 ${
        funded ? "border-sage bg-sage/5" : "border-terra bg-terra/5"
      }`}
      style={{ borderRadius: 0 }}
      data-state={funded ? "funded" : "awaiting-funding"}
    >
      <header className="flex items-baseline justify-between">
        <span className="eyebrow">
          {funded ? "✓ funded" : "awaiting funding"}
        </span>
        <span className="font-mono tabular text-ink">
          {balanceLabel}
          {funded ? " cspr" : ""}
          {balanceStatus === "polling" ? (
            <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
              polling…
            </span>
          ) : null}
        </span>
      </header>

      {!funded ? (
        <div className="space-y-2">
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            Copy the public key, paste it into the Casper Testnet Faucet,
            and click refresh once CSPR lands. Usually under 30 seconds.
          </p>
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
              refresh
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
