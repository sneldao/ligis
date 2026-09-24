"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import { chainById } from "@/lib/network";
import { getFieldLiveAgents } from "./catalogState";
import { isInteractiveAgent } from "./agentSeed";
import { fieldChainId, useCatalogUi } from "./catalogState";

type HeldCap = { id: string; label: string };

type Snapshot = {
  address: string;
  exists: boolean;
  tokenId: string;
  controller: string | null;
  heldCount: number;
  held: HeldCap[];
  chain?: string;
};

const VERIFY_DEFAULT_CAP = "agent.commerce.escrow";

export function FocusPanel() {
  const ui = useCatalogUi();
  const active = ui.activeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chainSlug = fieldChainId ?? "casper-testnet";
  const chain = chainById(chainSlug);
  const chainQs = `?chain=${encodeURIComponent(chainSlug)}`;

  const catalogAgent = active
    ? getFieldLiveAgents().find(
        (a) => a.address.toLowerCase() === active.toLowerCase(),
      )
    : undefined;
  const knownLive = Boolean(catalogAgent && isInteractiveAgent(catalogAgent));

  useEffect(() => {
    if (!active) {
      setSnap(null);
      setError(null);
      return;
    }
    // Ambient phantoms — no RPC, honest empty state.
    if (!knownLive) {
      setSnap(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/${encodeURIComponent(active)}${chainQs}`)
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
  }, [active, chainQs, knownLive]);

  const verifiedCap = snap?.held[0]?.id ?? VERIFY_DEFAULT_CAP;
  const isCapable = snap ? snap.held.some((h) => h.id === verifiedCap) : false;

  return (
    <AnimatePresence>
      {active ? (
        <motion.aside
          key={active}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto fixed bottom-6 right-6 top-24 z-30 hidden w-[24rem] flex-col bg-paper/95 px-7 py-8 backdrop-blur-md sm:flex"
          style={{ borderLeft: "1px solid var(--color-rule)" }}
        >
          <header className="flex items-baseline justify-between text-xs">
            <p className="eyebrow">
              {!knownLive
                ? "Ambient marker"
                : loading
                  ? "Reading the chain…"
                  : "Live verification"}
            </p>
            <span className="font-mono text-xs tabular text-ink-quiet">
              {knownLive ? "isCapable" : "density"}
            </span>
          </header>

          <div className="mt-6 flex items-baseline gap-3">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                !knownLive
                  ? "bg-ink-quiet"
                  : error
                    ? "bg-revoke"
                    : loading
                      ? "bg-ink-quiet"
                      : isCapable
                        ? "bg-sage"
                        : "bg-revoke"
              }`}
              aria-hidden
            />
            <p className="font-serif text-xl leading-snug text-ink">
              {!knownLive ? (
                <>
                  <span className="font-mono text-base tabular text-ink-quiet">
                    ghost
                  </span>{" "}
                  <span className="font-mono text-base tabular text-ink">
                    {truncateAddress(active, 6, 4)}
                  </span>
                </>
              ) : error ? (
                <span className="text-revoke">{error}</span>
              ) : loading ? (
                <span className="italic text-ink-soft">
                  Asking the registry…
                </span>
              ) : (
                <>
                  <span
                    className={`font-mono text-base tabular ${isCapable ? "text-sage" : "text-revoke"}`}
                  >
                    {isCapable ? "✓ GO" : "✗ STOP"}
                  </span>{" "}
                  <span className="font-mono text-base tabular text-ink">
                    {truncateAddress(active, 6, 4)}
                  </span>{" "}
                  for{" "}
                  <span className="font-mono text-base tabular text-ink">
                    {verifiedCap}
                  </span>
                  .
                </>
              )}
            </p>
          </div>

          <p className="mt-4 font-serif text-sm italic leading-relaxed text-ink-soft">
            {!knownLive
              ? "Map filler — not a minted agent. Zoom to a LIVE specimen (terra ring) to open a real dossier."
              : loading
                ? "One read against CredentialRegistry. No SDK, no oracle."
                : isCapable
                  ? "Issued by a third party, verified onchain. Any contract can ask the same question."
                  : snap?.exists
                    ? "Identity is minted but this capability is not held."
                    : "This address is listed on-chain but the snapshot is empty — try another LIVE specimen."}
          </p>

          {knownLive ? (
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
              <Fact label="status">
                {loading ? "…" : snap?.exists ? "active" : "not minted"}
              </Fact>
              <Fact label="token">
                {loading
                  ? "…"
                  : snap?.exists
                    ? `#${snap.tokenId}`
                    : catalogAgent?.tokenId
                      ? `#${catalogAgent.tokenId}`
                      : "—"}
              </Fact>
              <Fact label="credentials">
                {loading ? "…" : (snap?.heldCount ?? 0)}
              </Fact>
              <Fact label="network">{chain?.shortName ?? chainSlug}</Fact>
            </div>
          ) : null}

          {snap?.held && snap.held.length > 0 ? (
            <div className="mt-8 space-y-3">
              <p className="eyebrow">Also holds</p>
              <ul className="space-y-2">
                {snap.held.slice(0, 5).map((h) => (
                  <li
                    key={h.id}
                    className="flex items-baseline gap-3 font-mono text-[12px] tabular text-ink"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" />
                    {h.id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-3 pt-10">
            {knownLive && snap?.exists ? (
              <>
                <Link
                  href={`/agent/${encodeURIComponent(active)}${chainQs}`}
                  className="text-sm text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
                >
                  Open the dossier →
                </Link>
                <Link
                  href={`/gate${chainQs}&subject=${encodeURIComponent(active)}&capability=${encodeURIComponent(verifiedCap)}`}
                  className="text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
                >
                  Run the gate →
                </Link>
              </>
            ) : knownLive && !loading ? (
              <Link
                href={`/steward${chainQs}`}
                className="text-sm text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
              >
                Bootstrap with the Steward →
              </Link>
            ) : null}
            <Link
              href={`/capabilities${chainQs}`}
              className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              Browse capabilities
            </Link>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {label}
      </p>
      <div className="font-mono tabular text-sm text-ink">{children}</div>
    </div>
  );
}
