import { Rule } from "@/components/Rule";
import { SignalStack } from "@/components/SignalStack";
import { truncateHash } from "@/lib/format";
import type { TrustReceipt as TrustReceiptData } from "@ligis/core";

/**
 * TrustReceipt — the final trust ledger.
 *
 * What a `ligis trust check` leaves behind: the GO/STOP decision, the signal
 * ledger that produced it, the measured cost against the incumbent
 * per-verification price, and the anchored manifest hash. Presentational
 * only; server-renderable; composed from Rule, SignalStack, and the shared
 * GO/STOP verdict vocabulary.
 */
export function TrustReceipt({ receipt }: { receipt: TrustReceiptData }) {
  const go = receipt.verdict === "go";
  const stopped = receipt.signals.filter((s) => s.verdict === "stop");
  const reason = go
    ? "All signals passed. The agent may proceed with this counterparty."
    : stopped.length > 0
      ? `Stopped by ${stopped
          .map((s) =>
            s.kind === "capability" &&
            typeof s.metadata?.capability === "string"
              ? `${s.kind}:${s.metadata.capability as string}`
              : `${s.kind}:${s.source}`,
          )
          .join(", ")}. The agent must not proceed.`
      : "The trust check did not pass. The agent must not proceed.";

  const { incumbent, provider, savingsPct } = receipt.cost;

  return (
    <div className={`border-l-2 pl-6 ${go ? "border-sage" : "border-revoke"}`}>
      <p className="eyebrow">trust · pre-payment receipt</p>

      <p className="mt-3 display text-3xl sm:text-4xl">
        <span className={go ? "text-sage" : "text-revoke"}>
          {go ? "✓ GO" : "✗ STOP"}
        </span>
      </p>

      <p className="mt-4 font-serif text-base leading-relaxed text-ink-soft">
        {reason}
      </p>

      <div className="mt-8 space-y-2">
        <ReceiptRow label="counterparty" value={receipt.counterparty} />
        <ReceiptRow label="intent" value={receipt.intent} />
        {receipt.amount !== undefined ? (
          <ReceiptRow label="amount" value={receipt.amount} />
        ) : null}
        <ReceiptRow
          label="expires"
          value={new Date(receipt.expiresAt * 1000).toISOString()}
        />
      </div>

      <div className="mt-10">
        <h3 className="eyebrow text-ink">signals</h3>
        <div className="mt-4">
          <SignalStack signals={receipt.signals} />
        </div>
      </div>

      <div className="mt-10">
        <h3 className="eyebrow text-ink">cost per check</h3>
        <Rule className="mt-4" />
        <div className="mt-4 space-y-2">
          <ReceiptRow
            label={incumbent.name}
            value={`$${incumbent.perCheckUsd.toFixed(2)}/check · $${incumbent.monthlyUsd}/mo minimum`}
          />
          <ReceiptRow
            label={provider.name}
            value={
              provider.perCheckUsd !== undefined
                ? `$${provider.perCheckUsd.toFixed(4)}/check`
                : "measured on dashboard"
            }
          />
          {savingsPct !== undefined ? (
            <ReceiptRow label="savings" value={`${savingsPct}% per check`} />
          ) : null}
        </div>
      </div>

      <div className="mt-10">
        <h3 className="eyebrow text-ink">receipt</h3>
        <Rule className="mt-4" />
        <div className="mt-4 space-y-2">
          <ReceiptRow
            label="manifest hash"
            value={truncateHash(receipt.manifestHash, 12, 8)}
            mono
          />
          {receipt.anchoredTokenUri ? (
            <ReceiptRow label="anchored uri" value={receipt.anchoredTokenUri} mono />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-baseline gap-x-6">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
        {label}
      </span>
      <span
        className={
          mono
            ? "font-mono text-sm tabular text-ink"
            : "font-serif text-base leading-relaxed text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}
