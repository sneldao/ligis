/**
 * Browser-side wallet store.
 *
 * Holds the in-memory copy of the user's Casper secp256k1 keypair plus
 * derived public addresses, balance, and connect/disconnect state.
 * Cross-component sync is handled with a tiny module-scoped event bus.
 *
 * The context is split into two parts to minimize re-renders:
 *   - WalletStateCtx: the reactive state (pair, balance, status, etc.)
 *   - WalletActionsCtx: stable action functions (connect, disconnect,
 *     refreshBalance) — these never change identity, so components that
 *     only need actions don't re-render when state changes.
 *
 * Persistence:
 *   - The full keypair is stored in `sessionStorage` so the user does not
 *     have to re-paste a key on tab refresh within the same browsing
 *     session. Closing the tab purges the storage and the key is gone.
 *   - We DO NOT persist the key across browser sessions.
 *
 * Sensitive keys never touch localStorage, never travel over the network,
 * and never reach the server.
 */
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  generateKeyPair,
  keyPairFromHexPrivateKey,
  accountHashFromPublicKeyHex,
  type CasperKeyPair,
} from "./keypair";
import { getBalanceMotes } from "./rpc";

const STORAGE_KEY = "ligis:casper:session-v1";

/** THe wallet kind — `sandbox` for ephemeral in-browser generation,
 *  `paste` for an imported hex key, `extension` for Casper Wallet browser extension. */
export type WalletKind = "sandbox" | "paste" | "extension";

export interface WalletState {
  kind: WalletKind | null;
  pair: CasperKeyPair | null;
  /** Mote balance (decimal string). Updated by polling. */
  balanceMotes: string | null;
  /** "polling" while a balance check is in flight, "ok" if last fetch succeeded. */
  balanceStatus: "idle" | "polling" | "ok" | "error";
  /** Latest error from balance polling or connect attempts. */
  error: string | null;
  /** True from createContext until we have rehydrated from sessionStorage. */
  hydrated: boolean;
  /** Connection in flight — true while connectExtension is awaiting the extension popup. */
  connecting: boolean;
}

const INITIAL: WalletState = {
  kind: null,
  pair: null,
  balanceMotes: null,
  balanceStatus: "idle",
  error: null,
  hydrated: false,
  connecting: false,
};

// ---------- module-scoped event bus ----------

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      void err;
    }
  }
}

/** Subscribe to wallet state changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------- internal helpers ----------

function persist(pair: CasperKeyPair | null, kind: WalletKind | null): void {
  if (typeof window === "undefined") return;
  if (pair && kind) {
    const json = JSON.stringify({ kind, privateKeyHex: pair.privateKeyHex });
    window.sessionStorage.setItem(STORAGE_KEY, json);
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}

function rehydrate(): { kind: WalletKind; pair: CasperKeyPair } | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { kind?: WalletKind; privateKeyHex?: string };
    if (
      (parsed.kind === "sandbox" || parsed.kind === "paste") &&
      typeof parsed.privateKeyHex === "string"
    ) {
      const pair = keyPairFromHexPrivateKey(parsed.privateKeyHex);
      return { kind: parsed.kind, pair };
    }
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

// ---------- module-scoped state + actions ----------

let stateInternal: WalletState = INITIAL;
let balanceInFlight = false;

function setState(next: WalletState): void {
  stateInternal = next;
  notify();
}

const connectSandbox = (): void => {
  const pair = generateKeyPair();
  const next: WalletState = {
    kind: "sandbox",
    pair,
    balanceMotes: null,
    balanceStatus: "idle",
    error: null,
    hydrated: true,
    connecting: false,
  };
  persist(pair, "sandbox");
  setState(next);
};

const connectPaste = (hex: string): void => {
  try {
    const pair = keyPairFromHexPrivateKey(hex);
    const next: WalletState = {
      kind: "paste",
      pair,
      balanceMotes: null,
      balanceStatus: "idle",
      error: null,
      hydrated: true,
      connecting: false,
    };
    persist(pair, "paste");
    setState(next);
  } catch (err) {
    setState({
      ...stateInternal,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const connectExtension = async (): Promise<void> => {
  if (typeof window === "undefined" || !(window as any).CasperWalletProvider) {
    setState({ ...stateInternal, error: "Casper Wallet extension not detected. Install from casperwallet.io" });
    return;
  }
  setState({ ...stateInternal, connecting: true, error: null });
  try {
    const provider = (window as any).CasperWalletProvider();
    const connected = await provider.requestConnection();
    if (!connected) {
      setState({ ...stateInternal, connecting: false, error: "Connection rejected by user" });
      return;
    }
    const publicKeyHex = await provider.getActivePublicKey();
    // Derive the account hash from the public key — the extension
    // doesn't expose the private key, but we can still compute the
    // account hash for display and read operations.
    let accountHash: string;
    try {
      accountHash = accountHashFromPublicKeyHex(publicKeyHex);
    } catch {
      accountHash = "";
    }
    const pair = {
      publicKeyHex,
      privateKeyHex: "",
      accountHash,
    } as CasperKeyPair;
    setState({
      kind: "extension",
      pair,
      balanceMotes: null,
      balanceStatus: "idle",
      error: null,
      hydrated: true,
      connecting: false,
    });
  } catch (err) {
    setState({
      ...stateInternal,
      connecting: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const disconnect = (): void => {
  persist(null, null);
  setState({ ...INITIAL, hydrated: true });
};

const refreshBalance = async (): Promise<void> => {
  const current = stateInternal;
  if (!current.pair) return;
  // Guard against concurrent refresh calls — if a balance check is
  // already in flight, skip this one.
  if (balanceInFlight) return;
  balanceInFlight = true;
  setState({ ...current, balanceStatus: "polling", error: null });
  try {
    const motes = await getBalanceMotes(current.pair.publicKeyHex);
    setState({
      ...stateInternal,
      balanceMotes: motes,
      balanceStatus: "ok",
      error: null,
    });
  } catch (err) {
    setState({
      ...stateInternal,
      balanceStatus: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    balanceInFlight = false;
  }
};

// ---------- React context (split: state vs actions) ----------

interface WalletActions {
  connectSandbox: typeof connectSandbox;
  connectPaste: typeof connectPaste;
  connectExtension: typeof connectExtension;
  disconnect: typeof disconnect;
  refreshBalance: typeof refreshBalance;
}

const WALLET_ACTIONS: WalletActions = {
  connectSandbox,
  connectPaste,
  connectExtension,
  disconnect,
  refreshBalance,
};

const WalletStateCtx = createContext<WalletState>(INITIAL);
const WalletActionsCtx = createContext<WalletActions>(WALLET_ACTIONS);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setLocal] = useState<WalletState>(INITIAL);

  useEffect(() => {
    const rehydrated = rehydrate();
    if (rehydrated) {
      const next: WalletState = {
        kind: rehydrated.kind,
        pair: rehydrated.pair,
        balanceMotes: null,
        balanceStatus: "idle",
        error: null,
        hydrated: true,
        connecting: false,
      };
      setState(next);
      setLocal(next);
    } else {
      const next: WalletState = { ...INITIAL, hydrated: true };
      setState(next);
      setLocal(next);
    }
    const unsub = subscribe(() => setLocal(stateInternal));
    return unsub;
  }, []);

  const actions = useMemo(() => WALLET_ACTIONS, []);

  return (
    <WalletStateCtx.Provider value={state}>
      <WalletActionsCtx.Provider value={actions}>
        {children}
      </WalletActionsCtx.Provider>
    </WalletStateCtx.Provider>
  );
}

/** Hook for components that need both state and actions. */
export function useWallet(): WalletState & WalletActions {
  const state = useContext(WalletStateCtx);
  const actions = useContext(WalletActionsCtx);
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

/** Hook for components that only read wallet state (avoids action re-renders). */
export function useWalletState(): WalletState {
  return useContext(WalletStateCtx);
}

/** Hook for components that only need actions (stable, never re-renders). */
export function useWalletActions(): WalletActions {
  return useContext(WalletActionsCtx);
}

/** Format a motes balance as a CSPR string with 4 decimals. */
export function formatMotes(motes: string | null): string {
  if (motes === null) return "—";
  try {
    const big = BigInt(motes);
    const cspr = Number(big) / 1_000_000_000;
    return `${cspr.toFixed(4)} CSPR`;
  } catch {
    return "—";
  }
}
