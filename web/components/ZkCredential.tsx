"use client";

import { useState } from "react";
import type { ZkCredentialResult } from "@/lib/decide";

const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

/** Renders `Decision.zkCredential`: verified / rejected / unverified. */
export function ZkCredentialResultView({ zk }: { zk: ZkCredentialResult }) {
  const tone =
    zk.status === "GO"
      ? { border: "border-ink", text: "text-ink" }
      : zk.status === "STOP"
        ? { border: "border-terra", text: "text-terra" }
        : { border: "border-rule", text: "text-ink-quiet" };
  return (
    <div
      className={`border-l-2 pl-6 ${tone.border}`}
      data-testid="zk-credential"
    >
      <p className="eyebrow">zk credential · private presentation</p>
      <p
        className={`mt-2 font-mono text-sm uppercase tracking-[0.14em] ${tone.text}`}
      >
        {zk.verification} · {zk.status}
      </p>
      <p className="mt-2 font-serif text-sm leading-relaxed text-ink-soft">
        {zk.reason}
        {zk.verification === "unverified"
          ? " — this proof did not count toward the decision."
          : null}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] text-ink-quiet">
        <dt>root</dt>
        <dd className="break-all">
          {short(zk.registryRoot)}
          {zk.rootSource
            ? ` (${zk.rootSource === "manifest" ? "published manifest" : "pinned"})`
            : ""}
        </dd>
        <dt>nullifier</dt>
        <dd className="break-all">{short(zk.nullifier)}</dd>
        {zk.verifier ? (
          <>
            <dt>verifier</dt>
            <dd>
              {zk.verifier} · {zk.latencyMs}ms
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Paste the JSON emitted by
 * `pnpm --filter @ligis/circuits-zcash prove:sample -- --json out.json`
 * and submit it once. Explicit action (not an effect) because the gate burns
 * the nullifier on a verified proof — a re-render must not replay it.
 */
export function ZkProofAttach({
  onSubmit,
  busy,
}: {
  onSubmit: (zkProof: unknown) => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="group border-t border-rule pt-4">
      <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft marker:hidden hover:text-ink">
        Attach zk credential proof →
      </summary>
      <div className="mt-3 space-y-3">
        <p className="font-serif text-sm leading-relaxed text-ink-soft">
          The payee proves it holds a credential for this capability in a
          trusted registry tree, without revealing which one. One use per
          context: resubmitting the same proof is a replay and stops.
        </p>
        <textarea
          aria-label="zk proof JSON"
          className="h-28 w-full rounded bg-paper-deep p-3 font-mono text-[11px] text-ink"
          placeholder='{"proof":"0x…","contextLabel":"ligis-gate:v1:…","publicInputs":{…}}'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {err ? <p className="font-mono text-[11px] text-terra">{err}</p> : null}
        <button
          type="button"
          disabled={busy || !text.trim()}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink underline disabled:text-ink-quiet"
          onClick={() => {
            try {
              const parsed = JSON.parse(text);
              setErr(null);
              onSubmit(parsed);
            } catch {
              setErr("not valid JSON");
            }
          }}
        >
          {busy ? "verifying…" : "Run check with proof"}
        </button>
      </div>
    </details>
  );
}
