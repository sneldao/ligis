"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import { useCatalogUi } from "./catalogState";

type HeldCap = { id: string; label: string };

type Snapshot = {
  address: string;
  exists: boolean;
  tokenId: string;
  controller: string | null;
  heldCount: number;
  held: HeldCap[];
};

const VERIFY_DEFAULT_CAP = "agent.commerce.escrow";

export function FocusPanel() {
  const ui = useCatalogUi();
  const active = ui.activeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setSnap(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/${active}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSnap(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "failed to read");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const verifiedCap = snap?.held[0]?.id ?? VERIFY_DEFAULT_CAP;
  const isCapable = snap ? snap.held.some((h) => h.id === verifiedCap) : false;

  return (
    <AnimatePresence>
      {active ? (
        <motion.aside
          key={active}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="pointer-events-auto fixed bottom-6 right-6 top-24 z-30 hidden w-[24rem] flex-col bg-paper/95 px-7 py-8 backdrop-blur-md sm:flex"
          style={{ borderLeft: "1px solid #D9D3CB" }}
        >
          <header className="flex items-baseline justify-between text-xs">
            <p className="eyebrow">{loading ? "Reading the chain…" : "Live verification"}</p>
            <span className="font-mono text-[11px] tabular text-ink-quiet">
              isCapable
            </span>
          </header>

          <div className="mt-6 flex items-baseline gap-3">
            <span
              className={`inline-block h-2 w-2 translate-y-[-3px] rounded-full ${
                error
                  ? "bg-revoke"
                  : loading
                    ? "animate-pulse bg-ink-quiet"
                    : isCapable
                      ? "bg-sage"
                      : "bg-ink-quiet"
              }`}
              aria-hidden
            />
            <p className="font-serif text-xl leading-snug text-ink">
              {error ? (
                <span className="text-revoke">{error}</span>
              ) : loading ? (
                <span className="italic text-ink-soft">Asking the registry…</span>
              ) : (
                <>
                  <span className="font-mono text-base tabular text-ink">
                    {truncateAddress(active, 6, 4)}
                  </span>{" "}
                  is{" "}
                  <span className={isCapable ? "text-sage" : "text-ink-quiet"}>
                    {isCapable ? "capable" : "not capable"}
                  </span>{" "}
                  of{" "}
                  <span className="font-mono text-base tabular text-ink">
                    {verifiedCap}
                  </span>
                  .
                </>
              )}
            </p>
          </div>

          <p className="mt-4 font-serif text-sm italic leading-relaxed text-ink-soft">
            {loading
              ? "One read against CredentialRegistry. No SDK, no oracle."
              : isCapable
                ? "Issued by a third party, verified onchain. Any contract or skill can ask the same question."
                : snap?.exists
                  ? "This agent has minted an identity but doesn't hold this credential. Other agents might."
                  : "This address hasn't minted an agent yet. Run the Steward against it to bootstrap one."}
          </p>

          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
            <Fact label="status">
              {loading ? "…" : snap?.exists ? "active" : "not minted"}
            </Fact>
            <Fact label="token">
              {loading ? "…" : snap?.exists ? `#${snap.tokenId}` : "—"}
            </Fact>
            <Fact label="credentials">
              {loading ? "…" : (snap?.heldCount ?? 0)}
            </Fact>
            <Fact label="network">atlantic</Fact>
          </div>

          {snap?.held && snap.held.length > 0 ? (
            <div className="mt-8 space-y-3">
              <p className="eyebrow">Also holds</p>
              <ul className="space-y-2">
                {snap.held.slice(1, 5).map((h) => (
                  <li
                    key={h.id}
                    className="flex items-baseline gap-3 font-mono text-[12px] tabular text-ink"
                  >
                    <span className="inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-sage" />
                    {h.id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-3 pt-10">
            {snap && !snap.exists ? (
              <Link
                href="/steward?chain=casper-testnet"
                className="text-sm text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
              >
                Bootstrap an agent with the Steward →
              </Link>
            ) : null}
            <Link
              href={`/agent/${active}`}
              className="text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
            >
              Open the dossier →
            </Link>
            <Link
              href="/capabilities"
              className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              Browse all capabilities
            </Link>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-quiet">{label}</p>
      <div className="font-mono tabular text-sm text-ink">{children}</div>
    </div>
  );
}
