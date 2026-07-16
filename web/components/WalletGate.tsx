"use client";

/**
 * WalletGate — the contextual wallet companion on /steward.
 *
 * After this commit, the GlobalDock carries a WalletChip pill on the
 * right edge (top-right chrome), so the connect / fund / disconnect
 * action lives next to ChainSelector instead of buried on /steward.
 * WalletGate shrinks accordingly: it is now the on-page narrative
 * companion that pairs a one-line status with the contextual sentence
 * "you sign every step" — no button or floating panel of its own
 * (those live on the WalletChip in the dock).
 *
 * Behaviour preserved:
 *   - Pharos-mode "Switch to Casper" nudge when the page is hit in
 *     default-Pharos mode (handy safety net for direct deep links).
 *   - Casper-mode rendering of the connect state status + sentence.
 *   - 5-state reading (hydrating / disconnected / pending / funded).
 *
 * The single source of truth for the connection action is now the
 * dock WalletChip — see `web/components/WalletChip.tsx`.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet, formatMotes } from "@/lib/casper-browser/store";
import { CASPER_TESTNET } from "@/lib/network";

export function WalletGate() {
  const wallet = useWallet();
  const searchParams = useSearchParams();

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
            your browser, then funded via the testnet faucet. Toggle the
            chain above, or land directly on Casper below — the wallet
            chip in the top nav will surface once Casper is active.
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

  const hydrationLabel = isHydrating
    ? "○ reading wallet state…"
    : !connected
      ? "○ connect the chip in the top nav →"
      : funded
        ? `● ready · ${balanceLabel}`
        : "○ awaiting funding from the testnet faucet";

  return (
    <div className="relative space-y-4">
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
            <span className="text-ink">Connect the wallet chip</span> in
            the top nav to fund it once at the testnet faucet, then run
            the loop below.
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

      <p
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet"
        aria-live="polite"
      >
        {hydrationLabel}
      </p>
    </div>
  );
}
