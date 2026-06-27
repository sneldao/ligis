/**
 * Chain network metadata for client-safe components.
 *
 * The web/ app today reads Pharos Atlantic live; the Casper entry is shown
 * in the UI but its on-chain reads are gated on the Casper contracts being
 * deployed. See `docs/casper-buildathon.md` for the rollout plan.
 */

export interface ChainNetwork {
  id: string;
  kind: "evm" | "casper";
  name: string;
  chainId?: number;
  chainName?: string;
  explorerUrl: string;
  /** True if the web/ app talks to this chain live today. */
  live: boolean;
}

export const PHAROS_ATLANTIC: ChainNetwork = {
  id: "pharos-atlantic",
  kind: "evm",
  name: "Pharos Atlantic Testnet",
  chainId: 688689,
  explorerUrl: "https://atlantic.pharosscan.xyz",
  live: true,
};

export const CASPER_TESTNET: ChainNetwork = {
  id: "casper-testnet",
  kind: "casper",
  name: "Casper Testnet",
  chainName: "casper-test",
  explorerUrl: "https://testnet.cspr.live",
  live: true, // Odra contracts deployed + smoke test passed
};

export const CHAINS: ChainNetwork[] = [PHAROS_ATLANTIC, CASPER_TESTNET];

/** Default chain when no `?chain=` query param is present. */
export const DEFAULT_CHAIN: ChainNetwork = PHAROS_ATLANTIC;

/** Legacy export — kept so existing components don't break. */
export const network = PHAROS_ATLANTIC;

/**
 * Resolve the chain from a Next.js `searchParams` object (or any `{ chain?: string }` shape).
 *
 * Defaults to {@link DEFAULT_CHAIN} when the param is missing or unknown.
 * Safe to call from server components (no client-only APIs).
 */
export function getChain(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): ChainNetwork {
  const raw = searchParams?.chain;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return DEFAULT_CHAIN;
  return CHAINS.find((c) => c.id === id) ?? DEFAULT_CHAIN;
}

/** Helper for the ChainSelector UI — a stable string per chain for hrefs. */
export function chainHref(currentChainId: string, targetChainId: string, path: string): string {
  // Preserve the path; rewrite only the `chain` param. Caller passes the
  // pathname they want to land on (e.g. "/agent/0xabc" or "/capabilities").
  // Next.js client routing handles the rest.
  void currentChainId; // reserved for future "switch to different chain" logic
  return `${path}?chain=${encodeURIComponent(targetChainId)}`;
}
