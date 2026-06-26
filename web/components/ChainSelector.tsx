"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useTransition } from "react";
import { CHAINS, type ChainNetwork } from "@/lib/network";

/**
 * Chain selector — a small client-side switcher that updates the `?chain=`
 * query param. The active chain is highlighted; chains with `live: false`
 * get a "preview" badge so users know reads will hit Pharos until the
 * adapter is wired.
 *
 * Pages read the chain via `getChain(searchParams)` from `@/lib/network`,
 * so switching chains re-renders the same UI against a different chain.
 */
export function ChainSelector({ activeId }: { activeId?: string }) {
  return (
    <Suspense fallback={<ChainSelectorFallback />}>
      <ChainSelectorInner activeId={activeId} />
    </Suspense>
  );
}

function ChainSelectorFallback() {
  return (
    <div
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-quiet"
      aria-label="Select chain"
    >
      <span className="eyebrow">chain</span>
      <div className="inline-flex items-center divide-x divide-rule border border-rule bg-paper">
        {CHAINS.map((chain) => (
          <span
            key={chain.id}
            className="px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet"
          >
            {shortName(chain)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChainSelectorInner({ activeId }: { activeId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const chains: ChainNetwork[] = CHAINS;

  // If activeId is not passed, derive from the URL ?chain= param.
  const resolvedActiveId = activeId ?? searchParams.get("chain") ?? chains[0]!.id;

  const onSelect = useCallback(
    (chainId: string) => {
      if (chainId === resolvedActiveId) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("chain", chainId);
      const url = `${pathname}?${params.toString()}`;
      startTransition(() => router.push(url));
    },
    [resolvedActiveId, pathname, router, searchParams],
  );

  const active = useMemo(
    () => chains.find((c) => c.id === resolvedActiveId) ?? chains[0]!,
    [chains, resolvedActiveId],
  );

  return (
    <div
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-quiet"
      data-pending={isPending ? "true" : undefined}
      aria-label="Select chain"
    >
      <span className="eyebrow">chain</span>
      <div
        role="tablist"
        className="inline-flex items-center divide-x divide-rule border border-rule bg-paper"
      >
        {chains.map((chain) => {
          const isActive = chain.id === active.id;
          return (
            <button
              key={chain.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(chain.id)}
              className={`px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                isActive
                  ? "bg-paper-deep text-ink"
                  : "text-ink-quiet hover:bg-paper-deep hover:text-ink-soft"
              }`}
            >
              <span>{shortName(chain)}</span>
              {!chain.live ? (
                <span
                  className="ml-2 inline-block rounded-sm border border-rule px-1 py-px text-[9px] normal-case tracking-normal text-ink-quiet"
                  title="Contracts not deployed yet — reads will fall through to Pharos"
                >
                  preview
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function shortName(chain: ChainNetwork): string {
  if (chain.kind === "evm") return "pharos";
  if (chain.kind === "casper") return "casper";
  return chain.id;
}
