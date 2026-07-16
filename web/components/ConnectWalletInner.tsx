"use client";

/**
 * ConnectWalletInner — the actual connect menu body.
 *
 * Lives in its own file so its parent `ConnectWallet.tsx` can
 * `next/dynamic({ ssr: false })` it. Splitting this out keeps the
 * casper-js-sdk + noble crypto deps from being evaluated when the user
 * is on a Pharos-chain page (where the wallet is never reachable).
 *
 * Three connection paths, ordered by likelihood-of-success for a
 * Casper hackathon judge:
 *
 *   1. Sandbox Session — generate a secp256k1 keypair in the browser,
 *      store it in sessionStorage. Zero install.
 *   2. Paste a hex private key — for developers running
 *      `scripts/setup-casper-wallets.ts`.
 *
 * Both paths produce a key the user must fund via the Casper Testnet
 * faucet. While we wait for funding, the panel polls balance every
 * ~6s and flips green when the faucet delivers CSPR.
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
      <div className="border border-rule bg-paper px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        Loading wallet…
      </div>
    );
  }

  if (wallet.pair) {
    return <ConnectedPanel wallet={wallet} onDisconnect={wallet.disconnect} />;
  }

  return (
    <div
      className="space-y-5 border border-rule bg-paper p-5"
      style={{ borderRadius: 0 }}
      role="dialog"
      aria-label="Connect a Casper wallet"
    >
      <header className="flex items-baseline justify-between">
        <p className="eyebrow">Connect · Casper Testnet</p>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
          secp256k1
        </span>
      </header>
      <p className="font-serif text-sm leading-relaxed text-ink-soft">
        Ligis credentials are signed with secp256k1 so they can be verified
        across both Casper and Pharos. The official Casper Wallet extension
        defaults new accounts to ed25519, which is why the sandbox key below
        is the quickest path: it's a fresh secp256k1 wallet generated in your
        browser, lives only in this tab, and disappears when you close it.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            wallet.connectSandbox();
            setPoll(true);
          }}
          className="flex flex-col items-baseline gap-2 border border-rule bg-paper-deep px-4 py-3 text-left transition-colors hover:border-terra hover:bg-paper"
          style={{ borderRadius: 0 }}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            ● Sandbox session
          </span>
          <span className="font-serif text-xs leading-relaxed text-ink-soft">
            Generate a secp256k1 key in this browser. Zero install.
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById("connect-paste-input");
            el?.focus();
          }}
          className="flex flex-col items-baseline gap-2 border border-rule bg-paper-deep px-4 py-3 text-left transition-colors hover:border-terra hover:bg-paper"
          style={{ borderRadius: 0 }}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            ○ Paste hex key
          </span>
          <span className="font-serif text-xs leading-relaxed text-ink-soft">
            Import a 32-byte hex key from your shell.
          </span>
        </button>
      </div>

      <div className="space-y-2">
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
              {typeof wallet.error === "string" ? wallet.error : JSON.stringify(wallet.error)}
            </span>
          ) : null}
        </div>
      </div>

      <p className="font-serif text-xs italic leading-relaxed text-ink-quiet">
        Why secp256k1? Because <span className="font-mono not-italic">capabilityHash(&quot;…&quot;)</span> produces
        the same 32 bytes on Casper and Pharos, and the on-chain{" "}
        <span className="font-mono not-italic">CredentialRegistry</span>{" "}
        recovers the EVM-style issuer address via{" "}
        <span className="font-mono not-italic">k256</span>. Casper Wallet&apos;s
        default ed25519 keys can&apos;t sign for that path.
      </p>
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
  if (!pair) return null;
  return (
    <div
      className="space-y-5 border border-rule bg-paper p-5"
      style={{ borderRadius: 0 }}
      role="dialog"
      aria-label="Wallet connected"
    >
      <header className="flex items-baseline justify-between">
        <p className="eyebrow text-sky">● Connected · Casper Testnet</p>
        <button
          type="button"
          onClick={onDisconnect}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-revoke hover:decoration-revoke"
        >
          disconnect
        </button>
      </header>

      <div className="space-y-3">
        <Field label="public key">
          <span className="font-mono tabular text-ink">{pair.publicKeyHex}</span>
          <CopyButton value={pair.publicKeyHex} label="copy pubkey" />
        </Field>
        <Field label="account hash">
          <span className="font-mono tabular text-ink">{pair.accountHash}</span>
          <CopyButton value={pair.accountHash} label="copy hash" />
        </Field>
        <Field label="kind">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
            {wallet.kind === "sandbox" ? "ephemeral session key" : "imported · 64-hex secp256k1"}
          </span>
        </Field>
        <Field label="balance">
          <span className="font-mono tabular text-ink">
            {formatMotes(wallet.balanceMotes)}
          </span>
          <BalanceStatus status={wallet.balanceStatus} error={wallet.error} />
        </Field>
      </div>

      <FaucetPanel
        pair={pair}
        balanceMotes={wallet.balanceMotes}
        onPoll={async () => {
          await wallet.refreshBalance();
        }}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-4 border-t border-rule pt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-3">{children}</div>
    </div>
  );
}

function BalanceStatus({
  status,
  error,
}: {
  status: "idle" | "polling" | "ok" | "error";
  error: string | null;
}) {
  if (status === "polling") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
        polling…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-revoke">
        rpc error · click refresh below
      </span>
    );
  }
  if (error) {
    return <span className="font-mono text-[10px] tabular text-revoke">{error}</span>;
  }
  return null;
}

function FaucetPanel({
  pair,
  balanceMotes,
  onPoll,
}: {
  pair: { publicKeyHex: string };
  balanceMotes: string | null;
  onPoll: () => Promise<void>;
}) {
  const funded = balanceMotes !== null && balanceMotes !== "0";
  return (
    <div
      className={`space-y-3 border border-rule px-4 py-3 ${funded ? "border-sage" : ""}`}
      style={{ borderRadius: 0 }}
    >
      <header className="flex items-baseline justify-between">
        <span className="eyebrow">{funded ? "ready · funded" : "awaiting funding"}</span>
        <button
          type="button"
          onClick={() => void onPoll()}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
        >
          refresh
        </button>
      </header>
      {!funded ? (
        <>
          <p className="font-serif text-sm leading-relaxed text-ink-soft">
            Sign deploys from this browser wallet cost testnet CSPR. Copy
            the public key above, paste it into the Casper Testnet Faucet,
            and click refresh once it lands. The faucet usually fills in
            under 30 seconds.
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
            <CopyButton value={pair.publicKeyHex} label="copy pubkey for faucet" />
          </div>
        </>
      ) : (
        <p className="font-serif text-sm italic leading-relaxed text-sage">
          You have testnet CSPR. The Steward loop will sign and submit
          every transaction from this browser wallet — no server custodian
          involved.
        </p>
      )}
    </div>
  );
}
