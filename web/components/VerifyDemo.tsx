"use client";

import { useActionState } from "react";
import { verifyAction, type VerifyResult } from "@/app/actions";
import { Rule } from "./Rule";
import { truncateAddress } from "@/lib/format";

type CapOption = { id: string; label: string };

export function VerifyDemo({
  capabilities,
  defaultSubject,
  explorerUrl,
}: {
  capabilities: CapOption[];
  defaultSubject: string;
  explorerUrl: string;
}) {
  const [state, formAction, pending] = useActionState<VerifyResult | null, FormData>(
    verifyAction,
    null
  );

  return (
    <div className="space-y-8">
      <form
        action={formAction}
        className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
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
          {pending ? "verifying…" : "verify →"}
        </button>
      </form>

      <Rule />

      <div
        key={state ? JSON.stringify(state) : "idle"}
        className="min-h-[5rem] animate-fade-in"
      >
        {state === null ? (
          <p className="font-serif text-base italic text-ink-quiet">
            The result of <code className="font-mono not-italic">isCapable</code>{" "}
            appears here. One on-chain read, no SDK.
          </p>
        ) : !state.ok ? (
          <p className="font-serif text-base text-revoke">{state.error}</p>
        ) : (
          <ResultPanel result={state} explorerUrl={explorerUrl} />
        )}
      </div>
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
