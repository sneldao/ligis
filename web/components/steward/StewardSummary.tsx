import Link from "next/link";
import { truncateAddress, truncateHash } from "@/lib/format";
import type { State } from "./state";

export function StewardSummary({
  state,
  running,
  copied,
  onCopyProof,
  explorerUrl,
}: {
  state: State;
  running: boolean;
  copied: boolean;
  onCopyProof: () => void;
  explorerUrl: string;
}) {
  if (!state.summary?.ok) return null;

  return (
    <section className="space-y-5 border-l-2 border-sage pl-6">
      <p className="eyebrow text-sage">what just happened</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-6 border-t border-rule divide-y divide-rule">
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          subject
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          {state.summary.subject ? (
            <Link
              href={`/agent/${state.summary.subject}`}
              className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 hover:decoration-terra"
            >
              {truncateAddress(state.summary.subject, 6, 4)}
            </Link>
          ) : (
            "unknown"
          )}
        </dd>
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          token
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          #{state.summary.tokenId ?? "?"} ·{" "}
          {state.summary.minted ? "minted" : "found"}
        </dd>
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          reasoning
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          {state.summary.model ?? "—"} ·{" "}
          {state.summary.source === "0g"
            ? "0G Compute · TEE-verified"
            : "local keyword match"}
        </dd>
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          capabilities
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          {state.capabilities.length} required ·{" "}
          {state.capabilities.filter((c) => c.capable).length} held ·{" "}
          {state.txs.length} self-issued
        </dd>
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          gated
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          {state.summary.gated ? "yes" : "no"}
        </dd>
        {state.manifest ? (
          <>
            <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
              evidence
            </dt>
            <dd className="pt-3 font-mono tabular text-ink">
              {state.manifest.storageType === "0g"
                ? "0G Storage"
                : "local hash"}{" "}
              · root {truncateHash(state.manifest.rootHash, 10, 6)}
            </dd>
          </>
        ) : null}
        <dt className="pt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          txs
        </dt>
        <dd className="pt-3 font-mono tabular text-ink">
          {state.txs.length + (state.manifest?.storageTxHash ? 1 : 0) + 1}{" "}
          on-chain
        </dd>
      </dl>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <button
          type="button"
          onClick={onCopyProof}
          className="font-mono text-xs tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
        >
          {copied ? "✓ copied to clipboard" : "copy as proof"}
        </button>
        {state.summary.live && state.summary.subject ? (
          <>
            <Link
              href={`/agent/${state.summary.subject}`}
              className="font-mono text-xs tabular text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
            >
              View agent profile →
            </Link>
            <a
              href={`${explorerUrl}/address/${state.summary.subject}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              View on explorer ↗
            </a>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
        <span
          className={`font-mono tabular ${state.summary.live ? "text-sage" : "text-ink-quiet"}`}
        >
          {state.summary.live ? "● live on-chain" : "○ simulated"}
        </span>
        {state.summary.gated !== undefined ? (
          <span className="font-mono tabular text-ink-soft">
            gated: {state.summary.gated ? "yes" : "no"}
          </span>
        ) : null}
        {state.summary.rpcCalls !== undefined && state.summary.rpcCalls > 0 ? (
          <span className="font-mono tabular text-ink-soft">
            {state.summary.rpcCalls} RPC calls
          </span>
        ) : null}
        {state.summary.tokenId ? (
          <span className="font-mono tabular text-ink-soft">
            token #{state.summary.tokenId}
          </span>
        ) : null}
      </div>
    </section>
  );
}
