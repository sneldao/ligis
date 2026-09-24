import { Rule } from "../Rule";
import { truncateAddress, truncateHash } from "@/lib/format";
import type { State } from "./state";

export function CapabilityLedger({
  capabilities,
  gateDone,
  explorerUrl,
}: {
  capabilities: State["capabilities"];
  gateDone: boolean;
  explorerUrl: string;
}) {
  return (
    <div className="space-y-0">
      {capabilities.map((c) => (
        <div key={c.name}>
          <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-4 py-3 text-sm">
            <span
              className={`text-base ${c.capable ? "text-sage" : "text-ink-quiet"}`}
              aria-hidden
            >
              {c.capable ? "✓" : "✕"}
            </span>
            <div className="space-y-0.5">
              <span className="font-mono tabular text-ink">{c.name}</span>
              {c.selfIssued ? (
                <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.12em] text-terra">
                  self-issued
                </span>
              ) : null}
            </div>
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.16em] ${c.capable ? "text-sage" : "text-ink-quiet"}`}
            >
              {c.capable ? "held" : "not held"}
            </span>
            <span className="w-28 text-right font-mono text-xs tabular text-ink-soft">
              {c.issueTxHash ? (
                <a
                  href={`${explorerUrl}/tx/${c.issueTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                >
                  {truncateHash(c.issueTxHash, 8, 6)}
                </a>
              ) : (
                ""
              )}
            </span>
          </div>
          <Rule tone="soft" />
        </div>
      ))}
      {gateDone ? (
        <p className="pt-3 font-mono text-xs tabular text-ink-quiet">
          {capabilities.filter((c) => c.capable).length} held ·{" "}
          {capabilities.filter((c) => !c.capable).length} missing
        </p>
      ) : null}
    </div>
  );
}

export function TransactionLog({
  txs,
  explorerUrl,
}: {
  txs: State["txs"];
  explorerUrl: string;
}) {
  return (
    <div className="space-y-0">
      {txs.map((t) => (
        <div key={t.txHash}>
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-3 text-sm">
            <span className="font-mono tabular text-ink">issued {t.name}</span>
            <a
              href={`${explorerUrl}/tx/${t.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              {truncateHash(t.txHash, 10, 6)}
            </a>
          </div>
          <Rule tone="soft" />
        </div>
      ))}
    </div>
  );
}

export function ManifestSummary({
  manifest,
  explorerUrl,
}: {
  manifest: State["manifest"];
  explorerUrl: string;
}) {
  if (!manifest) return null;

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
        <span className="text-ink-quiet">manifest root</span>
        <span className="font-mono tabular text-ink">
          {truncateHash(manifest.rootHash, 10, 6)}
        </span>
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet marker:hidden transition-colors hover:text-ink">
          <span className="group-open:hidden">evidence details +</span>
          <span className="hidden group-open:inline">evidence details −</span>
        </summary>
        <div className="mt-3 space-y-3">
          {manifest.storageTxHash ? (
            <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
              <span className="text-ink-quiet">0G upload</span>
              <a
                href={`${explorerUrl}/tx/${manifest.storageTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono tabular text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
              >
                {truncateHash(manifest.storageTxHash, 10, 6)}
              </a>
            </div>
          ) : null}
          <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
            <span className="text-ink-quiet">anchor tx</span>
            <a
              href={`${explorerUrl}/tx/${manifest.anchorTx}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono tabular text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
            >
              {truncateAddress(manifest.anchorTx, 10, 6)}
            </a>
          </div>
          <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
            <span className="text-ink-quiet">token URI</span>
            <span className="font-mono tabular text-ink-soft">
              {manifest.tokenUri}
            </span>
          </div>
          <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
            <span className="text-ink-quiet">storage</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
              {manifest.storageType === "0g" ? "0G Storage" : "local hash"}
            </span>
          </div>
        </div>
      </details>
    </div>
  );
}
