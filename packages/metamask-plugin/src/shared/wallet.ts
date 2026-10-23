/**
 * Resolve the payer address. `--from` wins; otherwise the wallet's selected
 * EVM account from `ctx.walletStateManager` (wallet-read capability).
 *
 * `walletStateManager.read()` is an agent-sdk type bundled inside the host —
 * we access it structurally and stay null-safe so a shape change degrades to
 * "pass --from" instead of a crash.
 */
import type { PluginCommandContext } from "@metamask/agent-wallet/plugin";

interface WalletStateLike {
  selectedWallet?: { address?: unknown; namespace?: unknown } | null;
}

export function selectedEvmAddress(ctx: PluginCommandContext): string | null {
  try {
    const manager = ctx.walletStateManager as unknown as {
      read?: () => WalletStateLike;
    };
    const state = manager.read?.();
    const address = state?.selectedWallet?.address;
    return typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address)
      ? address
      : null;
  } catch {
    return null;
  }
}
