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
  /** Short label for the dock switcher. */
  shortName: string;
  /**
   * Key into `assets/networks.json` for EVM chains. The public `id` is a UI
   * slug (`pharos-atlantic`) and deliberately does not always match the config
   * key (`atlantic-testnet`), so reads must resolve through this field.
   */
  evmNetwork?: string;
  /**
   * True only when every write path a user can reach from the UI (steward loop,
   * server actions, payment flows) is wired for this chain. Reads and writes are
   * tracked separately because a chain can be readable long before it is
   * writable from the browser.
   */
  writeReady: boolean;
}

export const PHAROS_ATLANTIC: ChainNetwork = {
  id: "pharos-atlantic",
  kind: "evm",
  name: "Pharos Atlantic Testnet",
  chainId: 688689,
  explorerUrl: "https://atlantic.pharosscan.xyz",
  live: true,
  shortName: "pharos",
  evmNetwork: "atlantic-testnet",
  writeReady: true,
};

export const CASPER_TESTNET: ChainNetwork = {
  id: "casper-testnet",
  kind: "casper",
  name: "Casper Testnet",
  chainName: "casper-test",
  explorerUrl: "https://testnet.cspr.live",
  live: true, // Odra contracts deployed + smoke test passed
  shortName: "casper",
  writeReady: true,
};

/**
 * Monad Testnet. Contracts are deployed; public reads and the server-custodied
 * steward write path are wired. Browser wallet connect is still deferred —
 * writes use `LIGIS_STEWARD_KEY` (same pattern as Pharos).
 */
export const MONAD_TESTNET: ChainNetwork = {
  id: "monad-testnet",
  kind: "evm",
  name: "Monad Testnet",
  chainId: 10143,
  explorerUrl: "https://testnet.monadscan.com",
  live: true,
  shortName: "monad",
  evmNetwork: "monad-testnet",
  writeReady: true,
};

/** Key into `assets/networks.json` for a chain's EVM reads. */
export function evmNetworkKey(chain: ChainNetwork): string {
  return chain.evmNetwork ?? chain.id;
}

export const CHAINS: ChainNetwork[] = [
  PHAROS_ATLANTIC,
  CASPER_TESTNET,
  MONAD_TESTNET,
];

/** Chains a user can currently drive writes against from the browser. */
export function isWriteReadyChain(chain: ChainNetwork): boolean {
  return chain.writeReady;
}

/** Look up a chain by its network slug. */
export function chainById(id: string | undefined): ChainNetwork | undefined {
  if (!id) return undefined;
  return CHAINS.find((c) => c.id === id);
}

/** Default chain when no `?chain=` query param is present. */
export const DEFAULT_CHAIN: ChainNetwork = CASPER_TESTNET;

/** Legacy export — kept so existing components don't break. */
export const network = CASPER_TESTNET;

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

/**
 * Accent color classes for a chain — shared by ChainBadge and ChainSelector
 * so the active-chain color is consistent everywhere (terra for EVM/Pharos,
 * sky for Casper).
 */
export function chainAccent(chain: ChainNetwork): { bg: string; text: string } {
  if (chain.kind === "casper") return { bg: "bg-sky", text: "text-paper" };
  if (chain.id === "monad-testnet") return { bg: "bg-ink", text: "text-paper" };
  return { bg: "bg-terra", text: "text-paper" };
}

/** Helper for the ChainSelector UI — a stable string per chain for hrefs. */
export function chainHref(
  currentChainId: string,
  targetChainId: string,
  path: string,
): string {
  // Preserve the path; rewrite only the `chain` param. Caller passes the
  // pathname they want to land on (e.g. "/agent/0xabc" or "/capabilities").
  // Next.js client routing handles the rest.
  void currentChainId; // reserved for future "switch to different chain" logic
  return `${path}?chain=${encodeURIComponent(targetChainId)}`;
}
