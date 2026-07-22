"use client";

import { useState, useActionState, useRef } from "react";
import {
  verifyAction,
  batchVerifyAction,
  type VerifyResult,
  type BatchVerifyResult,
} from "@/app/actions";
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
          className={`text-sm transition-colors ${mode === "single" ? "text-ink underline decoration-terra decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
        >
          single
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`text-sm transition-colors ${mode === "batch" ? "text-ink underline decoration-terra decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
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
                  {c.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-baseline text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra disabled:text-ink-quiet disabled:no-underline"
          >
            {singlePending ? "verifying…" : "verify →"}
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
            className="inline-flex items-baseline text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra disabled:text-ink-quiet disabled:no-underline"
          >
            {batchPending ? "checking all…" : "check all →"}
          </button>
        </form>
      )}

      <Rule />

      {mode === "single" ? (
        <div
          key={singleState ? JSON.stringify(singleState) : "idle"}
          className="min-h-[5rem] animate-fade-in"
        >
          {singleState === null ? (
            <p className="font-serif text-base italic text-ink-quiet">
              The result of{" "}
              <code className="font-mono not-italic">isCapable</code>{" "}
              appears here. One on-chain read, no SDK.
            </p>
          ) : !singleState.ok ? (
            <ErrorRetry
              message={singleState.error}
              formRef={singleFormRef}
            />
          ) : (
            <ResultPanel result={singleState} explorerUrl={explorerUrl} />
          )}
        </div>
      ) : (
        <div
          key={batchState ? JSON.stringify(batchState) : "idle-batch"}
          className="min-h-[5rem] animate-fade-in"
        >
          {batchState === null ? (
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
            <BatchResultPanel result={batchState} explorerUrl={explorerUrl} />
          )}
        </div>
      )}
    </div>
  );
}

function ResultPanel({
  result,
  explorerUrl,
}: {
  result: Extract<VerifyResult, { ok: true }>;
  explorerUrl: string;
}) {
  const dotColor = result.capable ? "bg-sage" : "bg-ink-quiet";
  const verb = result.capable ? "is capable" : "is not capable";
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <span
          className={`inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full ${dotColor}`}
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
          {verb} of{" "}
          <span className="font-mono text-base tabular text-ink">
            {result.capabilityId}
          </span>
          .
        </p>
      </div>
      {result.capable && result.issuer ? (
        <p className="pl-[1.5rem] font-serif text-sm italic text-ink-soft">
          Issued by{" "}
          <a
            href={`${explorerUrl}/address/${result.issuer}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono not-italic text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            {truncateAddress(result.issuer, 6, 4)}
          </a>
          {result.expiresAt && result.expiresAt > 0n
            ? `, expires ${new Date(Number(result.expiresAt) * 1000).toLocaleDateString("en", { month: "short", year: "numeric" }).toLowerCase()}`
            : ", no expiry"}
          .
        </p>
      ) : null}
    </div>
  );
}

function BatchResultPanel({
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
          className="inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-terra"
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
          holds {heldCount} of {result.results.length} capabilities.
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
                className={`font-mono text-[11px] uppercase tracking-[0.16em] ${r.capable ? "text-sage" : "text-ink-quiet"}`}
              >
                {r.capable ? "held" : "not held"}
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
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
      >
        retry →
      </button>
    </div>
  );
}
