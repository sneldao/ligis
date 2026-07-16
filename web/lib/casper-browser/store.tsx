/**
 * Browser-side wallet store.
 *
 * Holds the in-memory copy of the user's Casper secp256k1 keypair plus
 * derived public addresses, balance, and connect/disconnect state.
 * Cross-component sync is handled with a tiny module-scoped event bus —
 * each subscriber re-reads on every `WalletChanged` notification. We
 * deliberately keep this small and dependency-free (no Zustand, no Jotai)
 * because the surface is tiny and the store is short-lived.
 *
 * Persistence:
 *   - The full keypair is stored in `sessionStorage` so the user does not
 *     have to re-paste a key on tab refresh within the same browsing
 *     session. Closing the tab purges the storage and the key is gone —
 *     that is intentional, it is an ephemeral session key.
 *   - We DO NOT persist the key across browser sessions.
 *
 * Sensitive keys never touch localStorage, never travel over the network,
 * and never reach the server.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  generateKeyPair,
  keyPairFromHexPrivateKey,
  type CasperKeyPair,
} from "./keypair";
import { getBalanceMotes } from "./rpc";

const STORAGE_KEY = "ligis:casper:session-v1";

/** THe wallet kind — `sandbox` for ephemeral in-browser generation,
 *  `paste` for an imported hex key. */
export type WalletKind = "sandbox" | "paste";

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
}

const INITIAL: WalletState = {
  kind: null,
  pair: null,
  balanceMotes: null,
  balanceStatus: "idle",
  error: null,
  hydrated: false,
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

/**
 * Subscribe to wallet state changes. Returns a noop unsubscribe — React
 * callers should use the {@link useWallet} hook instead, which wraps
 * this with `useSyncExternalStore`.
 */
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
    // Corrupt entry — purge.
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

// ---------- React context ----------

interface WalletApi extends WalletState {
  connectSandbox: () => void;
  connectPaste: (hex: string) => void;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
}

const WalletCtx = createContext<WalletApi | null>(null);

let stateInternal: WalletState = INITIAL;
function setState(next: WalletState): void {
  stateInternal = next;
  notify();
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setLocal] = useState<WalletState>(INITIAL);

  // Rehydrate from sessionStorage exactly once on mount.
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
      };
      setState(next);
      setLocal(next);
    } else {
      const next: WalletState = { ...INITIAL, hydrated: true };
      setState(next);
      setLocal(next);
    }
    const unsub = subscribe(() => setLocal({ ...stateInternal }));
    return unsub;
  }, []);

  const connectSandbox = useCallback(() => {
    const pair = generateKeyPair();
    const next: WalletState = {
      kind: "sandbox",
      pair,
      balanceMotes: null,
      balanceStatus: "idle",
      error: null,
      hydrated: true,
    };
    persist(pair, "sandbox");
    setState(next);
  }, []);

  const connectPaste = useCallback((hex: string) => {
    try {
      const pair = keyPairFromHexPrivateKey(hex);
      const next: WalletState = {
        kind: "paste",
        pair,
        balanceMotes: null,
        balanceStatus: "idle",
        error: null,
        hydrated: true,
      };
      persist(pair, "paste");
      setState(next);
    } catch (err) {
      const next: WalletState = {
        ...stateInternal,
        error: err instanceof Error ? err.message : String(err),
      };
      setState(next);
    }
  }, []);

  const disconnect = useCallback(() => {
    persist(null, null);
    setState({ ...INITIAL, hydrated: true });
  }, []);

  const refreshBalance = useCallback(async () => {
    const current = stateInternal;
    if (!current.pair) return;
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
    }
  }, []);

  const api = useMemo<WalletApi>(
    () => ({ ...state, connectSandbox, connectPaste, disconnect, refreshBalance }),
    [state, connectSandbox, connectPaste, disconnect, refreshBalance],
  );

  return <WalletCtx.Provider value={api}>{children}</WalletCtx.Provider>;
}

/** Hook for components that read wallet state and react to changes. */
export function useWallet(): WalletApi {
  const ctx = useContext(WalletCtx);
  if (!ctx) {
    // Outside the provider (e.g. server-side render). Return a "disconnected"
    // shape so components remain render-safe.
    return {
      ...INITIAL,
      hydrated: true,
      connectSandbox: () => {
        throw new Error("WalletProvider missing");
      },
      connectPaste: () => {
        throw new Error("WalletProvider missing");
      },
      disconnect: () => {
        throw new Error("WalletProvider missing");
      },
      refreshBalance: async () => {
        throw new Error("WalletProvider missing");
      },
    };
  }
  return ctx;
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
