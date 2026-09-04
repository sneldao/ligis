"use client";

import { useState, useActionState, useRef } from "react";
import {
  verifyAction,
  batchVerifyAction,
  type VerifyResult,
  type BatchVerifyResult,
} from "@/app/actions";
import { GateVerdict } from "./GateVerdict";
import { Rule } from "./Rule";
import { truncateAddress } from "@/lib/format";

type CapOption = { id: string; label: string };

export function VerifyDemo({
  capabilities,
  defaultSubject,
  explorerUrl,
  chainId,
}: {
  capabilities: CapOption[];
  defaultSubject: string;
  explorerUrl: string;
  chainId?: string;
}) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [singleState, singleAction, singlePending] = useActionState<
    VerifyResult | null,
    FormData
  >(verifyAction, null);
  const [batchState, batchAction, batchPending] = useActionState<
    BatchVerifyResult | null,
    FormData
  >(batchVerifyAction, null);

  const pending = singlePending || batchPending;
  const singleFormRef = useRef<HTMLFormElement>(null);
  const batchFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-8">
      <div className="flex items-baseline gap-6">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`py-1.5 text-sm transition-colors ${mode === "single" ? "text-ink underline decoration-terra decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
        >
          single
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`py-1.5 text-sm transition-colors ${mode === "batch" ? "text-ink underline decoration-terra decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
        >
          batch
        </button>
        {mode === "batch" ? (
          <span className="font-mono text-[11px] text-ink-quiet">
            isCapableMulti · 1 rpc call
          </span>
        ) : (
          <span className="font-mono text-[11px] text-ink-quiet">
            isCapable · 1 rpc call
          </span>
        )}
      </div>

      {mode === "single" ? (
        <form
          ref={singleFormRef}
          action={singleAction}
          className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          {chainId ? <input type="hidden" name="chainId" value={chainId} /> : null}
          <label htmlFor="subject" className="block space-y-2">
            <span className="eyebrow">subject · wallet</span>
            <input
              id="subject"
              name="subject"
              defaultValue={defaultSubject}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="block w-full border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra"
            />
          </label>
          <label htmlFor="capability" className="block space-y-2">
            <span className="eyebrow">capability</span>
            <select
              id="capability"
              name="capability"
              defaultValue={capabilities[0]?.id}
              className="block w-full appearance-none border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra"
            >
              {capabilities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50 disabled:hover:bg-paper disabled:hover:text-ink"
            style={{ borderRadius: 0 }}
          >
            {singlePending ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="spinner">
                  <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" />
                </svg>
                verifying…
              </>
            ) : (
              "verify →"
            )}
          </button>
        </form>
      ) : (
        <form
          ref={batchFormRef}
          action={batchAction}
          className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          {chainId ? <input type="hidden" name="chainId" value={chainId} /> : null}
          <label htmlFor="subject-batch" className="block space-y-2">
            <span className="eyebrow">subject · wallet</span>
            <input
              id="subject-batch"
              name="subject"
              defaultValue={defaultSubject}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="block w-full border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:opacity-50 disabled:hover:bg-paper disabled:hover:text-ink"
            style={{ borderRadius: 0 }}
          >
            {batchPending ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="spinner">
                  <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" />
                </svg>
                checking all…
              </>
            ) : (
              "check all →"
            )}
          </button>
        </form>
      )}

      <Rule />

      {mode === "single" ? (
        <div
          key={singleState ? JSON.stringify(singleState) : "idle"}
          className="min-h-[5rem] animate-fade-in"
        >
          {singlePending ? (
            <PendingState label="reading from chain…" />
          ) : singleState === null ? (
            <>
              <p className="font-serif text-sm italic text-ink-quiet">
                The address below is pre-filled as a sample. Run the gate to see
                whether your agent may proceed with this counterparty.
              </p>
              <p className="mt-3 font-serif text-sm italic text-ink-quiet">
                <span className="text-sage">✓ GO</span> means the agent holds a
                valid credential — proceed.{" "}
                <span className="text-revoke">✗ STOP</span> means it
                doesn&rsquo;t — your agent should not pay.
              </p>
              <p className="mt-3 font-serif text-base italic text-ink-quiet">
                The verdict of{" "}
                <code className="font-mono not-italic">isCapable</code> appears
                here. One on-chain read, no SDK.
              </p>
            </>
          ) : !singleState.ok ? (
            <ErrorRetry
              message={singleState.error}
              formRef={singleFormRef}
            />
          ) : (
            <SingleGate result={singleState} explorerUrl={explorerUrl} />
          )}
        </div>
      ) : (
        <div
          key={batchState ? JSON.stringify(batchState) : "idle-batch"}
          className="min-h-[5rem] animate-fade-in"
        >
          {batchPending ? (
            <PendingState label="reading all capabilities…" />
          ) : batchState === null ? (
            <p className="font-serif text-base italic text-ink-quiet">
              The result of{" "}
              <code className="font-mono not-italic">isCapableMulti</code>{" "}
              appears here. All capabilities, one on-chain read.
            </p>
          ) : !batchState.ok ? (
            <ErrorRetry
              message={batchState.error}
              formRef={batchFormRef}
            />
          ) : (
            <BatchGate result={batchState} explorerUrl={explorerUrl} />
          )}
        </div>
      )}
    </div>
  );
}

function SingleGate({
  result,
  explorerUrl,
}: {
  result: Extract<VerifyResult, { ok: true }>;
  explorerUrl: string;
}) {
  return (
    <GateVerdict
      verdict={{
        capable: result.capable,
        subject: result.subject,
        capabilityId: result.capabilityId,
        issuer: result.issuer,
        expiresAt: result.expiresAt,
        revoked: result.revoked,
      }}
      explorerUrl={explorerUrl}
    />
  );
}

function BatchGate({
  result,
  explorerUrl,
}: {
  result: Extract<BatchVerifyResult, { ok: true }>;
  explorerUrl: string;
}) {
  const heldCount = result.results.filter((r) => r.capable).length;
  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <span
          className={`inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full ${heldCount > 0 ? "bg-sage" : "bg-revoke"}`}
          aria-hidden
        />
        <p className="font-serif text-lg leading-snug text-ink">
          <a
            href={`${explorerUrl}/address/${result.subject}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-base tabular text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-terra"
          >
            {truncateAddress(result.subject, 6, 4)}
          </a>{" "}
          — {heldCount} of {result.results.length} capabilities pass the gate.
        </p>
      </div>
      <p className="pl-[1.5rem] font-mono text-[11px] text-ink-quiet">
        {result.rpcCalls} rpc call · isCapableMulti(subject, bytes32[])
      </p>
      <div className="space-y-0">
        {result.results.map((r) => (
          <div key={r.id}>
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-3 text-sm">
              <span className="font-mono tabular text-ink">{r.id}</span>
              <span
                className={`font-mono text-[11px] uppercase tracking-[0.16em] ${r.capable ? "text-sage" : "text-revoke"}`}
              >
                {r.capable ? "GO" : "STOP"}
              </span>
            </div>
            <Rule tone="soft" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorRetry({
  message,
  formRef,
}: {
  message: string;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  return (
    <div className="space-y-3">
      <p className="font-serif text-base text-revoke">{message}</p>
      <button
        type="button"
        onClick={() => formRef.current?.requestSubmit()}
        className="inline-block py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
      >
        retry →
      </button>
    </div>
  );
}

function PendingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden
        className="spinner text-terra"
      >
        <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" />
      </svg>
      <span className="font-serif text-sm italic text-ink-soft">{label}</span>
    </div>
  );
}

