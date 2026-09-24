"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { capabilities } from "@/lib/capabilities-client";

/**
 * Client shell for /gate: immediate "reading chain…" feedback on submit.
 * Server `loading.tsx` still covers cold navigations; this covers the form
 * path where the previous verdict would otherwise sit still while the next
 * RSC payload waits on RPC.
 */
export function GateFormShell({
  chainId,
  situationId,
  defaultSubject,
  defaultCapability,
  capabilityOptions,
  sampleLinks,
  children,
}: {
  chainId: string;
  situationId?: string;
  defaultSubject: string;
  defaultCapability: string;
  /** Pre-rendered sample "or try:" links from the server. */
  sampleLinks: ReactNode;
  /** Optional override; defaults to the shared catalog. */
  capabilityOptions?: ReadonlyArray<{ id: string }>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setReading(false);
  }, [children]);

  const navigate = useCallback(
    (subject: string, capability: string) => {
      const params = new URLSearchParams();
      params.set("chain", chainId);
      params.set("subject", subject.trim());
      params.set("capability", capability.trim());
      if (situationId) params.set("situation", situationId);
      setReading(true);
      startTransition(() => {
        router.push(`/gate?${params.toString()}`);
      });
    },
    [chainId, situationId, router],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") ?? "");
    const capability = String(fd.get("capability") ?? "");
    if (!subject || !capability) return;
    navigate(subject, capability);
  }

  const busy = pending || reading;
  const opts = capabilityOptions ?? capabilities;
  const ids = opts.map((c) => c.id);
  const optionIds =
    defaultCapability && !ids.includes(defaultCapability)
      ? [defaultCapability, ...ids]
      : ids;

  return (
    <>
      <section className="mt-14">
        <form
          method="get"
          action="/gate"
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <input type="hidden" name="chain" value={chainId} />
          {situationId ? (
            <input type="hidden" name="situation" value={situationId} />
          ) : null}
          <label htmlFor="subject" className="block space-y-2">
            <span className="eyebrow">subject · wallet</span>
            <input
              id="subject"
              name="subject"
              key={`subject-${defaultSubject}`}
              defaultValue={defaultSubject}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              className="block w-full border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
            />
          </label>
          <label htmlFor="capability" className="block space-y-2">
            <span className="eyebrow">capability</span>
            <span className="relative block">
              <select
                id="capability"
                name="capability"
                key={`cap-${defaultCapability}`}
                defaultValue={defaultCapability}
                disabled={busy}
                className="block w-full appearance-none border-0 border-b border-rule bg-transparent pb-2 pr-6 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
              >
                {optionIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
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
            disabled={busy}
            className="inline-flex items-center gap-2 justify-center border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:border-rule disabled:text-ink-quiet disabled:hover:bg-paper disabled:hover:text-ink-quiet"
            style={{ borderRadius: 0 }}
          >
            {busy ? "reading…" : "gate →"}
          </button>
        </form>
        {sampleLinks}
      </section>

      {busy ? (
        <section className="mt-16" aria-live="polite" aria-busy="true">
          <h2 className="eyebrow">Verdict</h2>
          <p className="mt-6 font-serif text-lg italic text-ink-quiet">
            Reading chain…
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
            one on-chain read · not a Ligis server
          </p>
        </section>
      ) : (
        children
      )}
    </>
  );
}
