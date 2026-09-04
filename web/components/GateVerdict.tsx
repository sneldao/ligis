import { truncateAddress } from "@/lib/format";

/**
 * GateVerdict — the product's wedge, made tactile.
 *
 * Ligis is not "identity for agents." Its differentiated wedge is the single
 * binary decision an autonomous payment calls in the instant before money
 * moves to a stranger: GO or STOP. This component renders that decision the
 * same way everywhere it appears — the home check, /gate, and embeds — so
 * the product owns one verb ("gate the payment") instead of competing on a
 * category ("verifiable credentials").
 *
 * Presentational only. Server- and client-renderable. No boxes, no shadows —
 * a left rule in the verdict tone carries the containment, per DESIGN.md.
 */
export type GateVerdictInput = {
  capable: boolean;
  subject: string;
  capabilityId: string;
  issuer: `0x${string}` | string | null;
  expiresAt: bigint | null;
  revoked: boolean;
};

export function GateVerdict({
  verdict,
  explorerUrl,
  source,
}: {
  verdict: GateVerdictInput;
  /** When provided, subject + issuer link to the explorer. */
  explorerUrl?: string;
  /** Provenance line, e.g. "pharos atlantic state". */
  source?: string;
}) {
  const go = verdict.capable;
  const tone = go ? "border-sage" : "border-revoke";
  const verdictColor = go ? "text-sage" : "text-revoke";

  const subjectNode = explorerUrl ? (
    <a
      href={`${explorerUrl}/address/${verdict.subject}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-base tabular text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
    >
      {truncateAddress(verdict.subject, 6, 4)}
    </a>
  ) : (
    <span className="font-mono text-base tabular text-ink">
      {truncateAddress(verdict.subject, 6, 4)}
    </span>
  );

  // Plain-language reason — the "why" behind the binary, so a human curating
  // the collection understands the decision without reading a capability spec.
  // Three distinct STOP reasons so the user knows whether to re-check, wait,
  // or walk away — not just "something is wrong."
  const reason = go
    ? "Authorized on-chain. Your agent may proceed with this counterparty."
    : verdict.revoked
      ? "Authorization was revoked by its issuer. Do not proceed — the credential is explicitly invalidated."
      : "No verifiable authorization found on-chain. Your agent should not proceed.";

  return (
    <div className={`border-l-2 pl-6 ${tone}`}>
      <p className="eyebrow">gate · pre-payment check</p>

      <p className="mt-3 display text-3xl sm:text-4xl">
        <span className={verdictColor}>{go ? "✓ GO" : "✗ STOP"}</span>
        {!go && verdict.revoked ? (
          <span className="ml-3 align-middle font-mono text-[11px] uppercase tracking-[0.16em] text-revoke/80 border border-revoke/30 px-2 py-0.5">
            revoked
          </span>
        ) : null}
      </p>

      <p className="mt-4 font-serif text-lg leading-relaxed text-ink">
        {subjectNode} for{" "}
        <span className="font-mono text-base tabular text-ink">
          {verdict.capabilityId}
        </span>
        .
      </p>

      <p className="mt-2 font-serif text-base leading-relaxed text-ink-soft">
        {reason}
      </p>

      {go && verdict.issuer ? (
        <p className="mt-3 font-serif text-sm italic leading-relaxed text-ink-soft">
          Issued by{" "}
          {explorerUrl ? (
            <a
              href={`${explorerUrl}/address/${verdict.issuer}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono not-italic text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              {truncateAddress(verdict.issuer, 6, 4)}
            </a>
          ) : (
            <code className="font-mono not-italic text-ink-soft">
              {truncateAddress(verdict.issuer, 6, 4)}
            </code>
          )}
          {verdict.expiresAt && verdict.expiresAt > 0n
            ? `, expires ${new Date(Number(verdict.expiresAt) * 1000)
                .toLocaleDateString("en", {
                  month: "short",
                  year: "numeric",
                })
                .toLowerCase()}`
            : ", no expiry"}
          .
        </p>
      ) : null}

      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
        {source ? `${source} · ` : ""}one on-chain read · not a Ligis server
      </p>
    </div>
  );
}
