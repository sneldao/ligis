"use client";

import { useActionState, useState } from "react";
import { vouchAction, type VouchResult } from "@/app/actions";
import { capabilities } from "@/lib/capabilities-client";
import { chainById } from "@/lib/network";
import { truncateAddress } from "@/lib/format";
import { VerdictMark } from "@/components/VerdictMark";

/**
 * The issuer desk — the supply side of the gate. The demo issuer (the Ligis
 * steward key) signs an EIP-712 issue or revokes its live credential, then
 * the result links straight into the canonical /gate read.
 */
export function VouchDesk({
  chainId,
  issuer,
  defaultSubject,
}: {
  chainId: string;
  issuer: string | null;
  defaultSubject: string;
}) {
  const [state, action, pending] = useActionState<VouchResult | null, FormData>(
    vouchAction,
    null,
  );
  const [subject, setSubject] = useState(defaultSubject);
  const [intent, setIntent] = useState<"issue" | "revoke">("issue");

  const chain = chainById(chainId);
  const explorer = chain?.explorerUrl ?? "";

  return (
    <div className="space-y-8">
      <div
        role="group"
        aria-label="Issuer action"
        className="flex items-baseline gap-6"
      >
        <button
          type="button"
          aria-pressed={intent === "issue"}
          onClick={() => setIntent("issue")}
          className={`py-1.5 text-sm transition-colors ${intent === "issue" ? "text-ink underline decoration-terra decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
        >
          vouch
        </button>
        <button
          type="button"
          aria-pressed={intent === "revoke"}
          onClick={() => setIntent("revoke")}
          className={`py-1.5 text-sm transition-colors ${intent === "revoke" ? "text-ink underline decoration-revoke decoration-1 underline-offset-4" : "text-ink-quiet hover:text-ink"}`}
        >
          pull back
        </button>
        <span className="font-mono text-xs text-ink-quiet">
          {intent === "issue" ? "EIP-712 · issue" : "revoke · on-chain"}
        </span>
      </div>

      <form
        action={action}
        className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <input type="hidden" name="chainId" value={chainId} />
        <input type="hidden" name="intent" value={intent} />
        <label htmlFor="vouch-subject" className="block space-y-2">
          <span className="eyebrow">subject · wallet</span>
          <input
            id="vouch-subject"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            disabled={pending || !issuer}
            className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
          />
        </label>
        <label htmlFor="vouch-capability" className="block space-y-2">
          <span className="eyebrow">capability</span>
          <span className="relative block">
            <select
              id="vouch-capability"
              name="capability"
              disabled={pending || !issuer}
              className="block w-full appearance-none border-0 border-b border-rule bg-transparent pb-2 pr-6 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
            >
              {capabilities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
            <svg
              width="9"
              height="9"
              viewBox="0 0 9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-ink-quiet"
            >
              <path d="M1.5 3 L4.5 6 L7.5 3" />
            </svg>
          </span>
        </label>
        <button
          type="submit"
          disabled={pending || !issuer}
          className="inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:border-rule disabled:text-ink-quiet disabled:hover:bg-paper disabled:hover:text-ink-quiet"
          style={{ borderRadius: 0 }}
        >
          {pending
            ? intent === "issue"
              ? "vouching…"
              : "pulling back…"
            : intent === "issue"
              ? "vouch →"
              : "pull back →"}
        </button>
      </form>

      {!issuer ? (
        <p className="font-serif text-sm italic text-ink-quiet">
          No issuer key configured on this deployment — the desk is read-only
          until <code className="font-mono not-italic">LIGIS_STEWARD_KEY</code>{" "}
          is set.
        </p>
      ) : (
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-quiet">
          issuing as{" "}
          <a
            href={`${explorer}/address/${issuer}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
          >
            {truncateAddress(issuer, 6, 4)} ↗
          </a>{" "}
          · the demo issuer
        </p>
      )}

      <div
        className="min-h-[5rem] border-t border-rule pt-6"
        aria-live="polite"
      >
        {pending ? (
          <p className="font-serif text-sm italic text-ink-soft">
            writing to the registry…
          </p>
        ) : state === null ? (
          <p className="font-serif text-sm italic text-ink-quiet">
            Vouch for a subject and the gate answers{" "}
            <span className="text-sage not-italic">GO</span>. Pull it back and
            the gate answers{" "}
            <span className="text-revoke not-italic">STOP</span> — on the next
            read, not eventually.
          </p>
        ) : !state.ok ? (
          <p role="alert" className="font-serif text-base text-revoke">
            {state.error}
          </p>
        ) : (
          <div className="space-y-4 animate-fade-in">
            <p className="font-serif text-lg leading-snug text-ink">
              {state.action === "issue" ? "Vouched." : "Pulled back."}{" "}
              <span
                className={`font-mono text-sm tabular ${state.capable ? "text-sage" : "text-revoke"}`}
              >
                <VerdictMark ok={state.capable} />{" "}
                {state.capable ? "GO" : "STOP"}
              </span>{" "}
              on the next read
            </p>
            <ul className="space-y-1.5">
              {state.txs.map((tx) => (
                <li key={tx} className="font-mono text-xs tabular">
                  <a
                    href={`${explorer}/tx/${tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                  >
                    tx {truncateAddress(tx, 8, 6)} ↗
                  </a>
                </li>
              ))}
            </ul>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
              <a
                href={`/gate?subject=${state.subject}&capability=${state.capabilityId}`}
                className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                gate it → shareable check
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
