"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { ChainSwitchHint } from "@/components/ChainSwitchHint";
import { SubjectSpecimen } from "@/components/SubjectSpecimen";
import { counterAction } from "@/app/actions/counter";
import { capabilities } from "@/lib/capabilities-client";
import { chainById } from "@/lib/network";
import { chainSwitchHref, subjectChainMismatch } from "@/lib/subject-format";

/**
 * Client shell for /gate: immediate "reading chain…" feedback on submit,
 * plus a live wrong-chain hint when the pasted subject belongs elsewhere.
 *
 * Two modes:
 * - Credential mode: subject + permission → scoped read / resolve.
 * - Decision mode: adds amount, purpose, and optional mandate (contracted
 *   payees, cap, expected price) → full four-signal decide() via GateDecision.
 *   A blank allowlist sends no payees, so right-payee stays SKIPPED — the
 *   form never compares the payee with itself.
 */
export function GateFormShell({
  chainId,
  situationId,
  defaultSubject,
  defaultCapability,
  defaultAmountUsd,
  defaultPurpose,
  defaultMandate,
  capabilityOptions,
  sampleLinks,
  children,
}: {
  /** Omit for a chain-agnostic read — the subject resolves across registries. */
  chainId?: string;
  situationId?: string;
  defaultSubject: string;
  defaultCapability: string;
  defaultAmountUsd?: string;
  defaultPurpose?: string;
  defaultMandate?: { payees?: string; maxUsd?: string; expectedUsd?: string };
  sampleLinks: ReactNode;
  capabilityOptions?: ReadonlyArray<{ id: string }>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState(defaultSubject);
  const [capabilityDraft, setCapabilityDraft] = useState(defaultCapability);
  const [decisionMode, setDecisionMode] = useState(
    Boolean(defaultAmountUsd || defaultPurpose),
  );
  const [amountDraft, setAmountDraft] = useState(defaultAmountUsd ?? "");
  const [purposeDraft, setPurposeDraft] = useState(defaultPurpose ?? "");
  const [mandatePayeesDraft, setMandatePayeesDraft] = useState(
    defaultMandate?.payees ?? "",
  );
  // Explicit opt-in: "contracted payee is this address". Checked sends the
  // current subject as the sole allowlist entry; unchecked sends whatever is
  // typed (possibly nothing → right-payee stays SKIPPED).
  const [mandateSelfChecked, setMandateSelfChecked] = useState(false);
  const [mandateMaxDraft, setMandateMaxDraft] = useState(
    defaultMandate?.maxUsd ?? "",
  );
  const [mandateExpectedDraft, setMandateExpectedDraft] = useState(
    defaultMandate?.expectedUsd ?? "",
  );

  useEffect(() => {
    setReading(false);
  }, [children]);

  useEffect(() => {
    setSubjectDraft(defaultSubject);
    setCapabilityDraft(defaultCapability);
    setAmountDraft(defaultAmountUsd ?? "");
    setPurposeDraft(defaultPurpose ?? "");
    setMandatePayeesDraft(defaultMandate?.payees ?? "");
    setMandateMaxDraft(defaultMandate?.maxUsd ?? "");
    setMandateExpectedDraft(defaultMandate?.expectedUsd ?? "");
    setDecisionMode(Boolean(defaultAmountUsd || defaultPurpose));
  }, [
    defaultSubject,
    defaultCapability,
    defaultAmountUsd,
    defaultPurpose,
    defaultMandate?.payees,
    defaultMandate?.maxUsd,
    defaultMandate?.expectedUsd,
  ]);

  const chain = chainById(chainId);
  const liveMismatch = useMemo(() => {
    if (!chain || !subjectDraft.trim()) return null;
    return subjectChainMismatch(chain, subjectDraft);
  }, [chain, subjectDraft]);

  const switchHref = liveMismatch
    ? chainSwitchHref({
        path: "/gate",
        chainId: liveMismatch.suggestedChainId,
        subject: subjectDraft,
        capability: capabilityDraft,
        situation: situationId,
      })
    : null;

  const navigate = useCallback(
    (input: {
      subject: string;
      capability: string;
      amountUsd?: string;
      purpose?: string;
      mandatePayees?: string;
      mandateMaxUsd?: string;
      mandateExpectedUsd?: string;
    }) => {
      const params = new URLSearchParams();
      if (chainId) params.set("chain", chainId);
      params.set("subject", input.subject.trim());
      params.set("capability", input.capability.trim());
      if (situationId) params.set("situation", situationId);
      if (input.amountUsd?.trim())
        params.set("amountUsd", input.amountUsd.trim());
      if (input.purpose?.trim()) params.set("purpose", input.purpose.trim());
      if (input.mandatePayees?.trim())
        params.set("mandatePayees", input.mandatePayees.trim());
      if (input.mandateMaxUsd?.trim())
        params.set("mandateMaxUsd", input.mandateMaxUsd.trim());
      if (input.mandateExpectedUsd?.trim())
        params.set("mandateExpectedUsd", input.mandateExpectedUsd.trim());
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
    // Privacy-light aggregate counter — situation bucket only.
    const bucket =
      situationId === "treasury"
        ? "gate:preset:legit"
        : situationId === "merchant"
          ? "gate:preset:overpay"
          : situationId === "escrow" || situationId === "compliance"
            ? "gate:preset:injected"
            : "gate:custom";
    void counterAction("gate_run", bucket);
    if (!decisionMode) {
      navigate({ subject, capability });
      return;
    }
    const amountUsd = String(fd.get("amountUsd") ?? "").trim();
    const purpose = String(fd.get("purpose") ?? "").trim();
    if (!amountUsd || !purpose) return;
    const selfChecked = fd.get("mandateSelf") === "on";
    const typedPayees = String(fd.get("mandatePayees") ?? "").trim();
    navigate({
      subject,
      capability,
      amountUsd,
      purpose,
      mandatePayees: selfChecked ? subject.trim() : typedPayees,
      mandateMaxUsd: String(fd.get("mandateMaxUsd") ?? ""),
      mandateExpectedUsd: String(fd.get("mandateExpectedUsd") ?? ""),
    });
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
          {chainId ? (
            <input type="hidden" name="chain" value={chainId} />
          ) : null}
          {situationId ? (
            <input type="hidden" name="situation" value={situationId} />
          ) : null}
          <label htmlFor="subject" className="block space-y-2">
            <span className="eyebrow">subject · wallet</span>
            <span className="flex items-end gap-3">
              <SubjectSpecimen subject={subjectDraft} size="chip" />
              <input
                id="subject"
                name="subject"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                disabled={busy}
                className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
              />
            </span>
          </label>
          <label htmlFor="capability" className="block space-y-2">
            <span className="eyebrow">permission</span>
            <span className="relative block">
              <select
                id="capability"
                name="capability"
                value={capabilityDraft}
                onChange={(e) => setCapabilityDraft(e.target.value)}
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
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={() => setDecisionMode((v) => !v)}
              aria-expanded={decisionMode}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
            >
              {decisionMode
                ? "− credential check only"
                : "+ pre-payment decision (amount · purpose · mandate)"}
            </button>
          </div>
          {decisionMode ? (
            <>
              <label htmlFor="amountUsd" className="block space-y-2">
                <span className="eyebrow">amount · usd</span>
                <input
                  id="amountUsd"
                  name="amountUsd"
                  inputMode="decimal"
                  placeholder="1200"
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  disabled={busy}
                  className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
                />
              </label>
              <label htmlFor="purpose" className="block space-y-2">
                <span className="eyebrow">purpose</span>
                <input
                  id="purpose"
                  name="purpose"
                  placeholder="Q4 renewal, per signed contract"
                  value={purposeDraft}
                  onChange={(e) => setPurposeDraft(e.target.value)}
                  disabled={busy}
                  className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
                />
              </label>
              <div className="sm:col-span-3">
                <p className="eyebrow">contracted terms · optional</p>
                <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
                  <label htmlFor="mandatePayees" className="block space-y-2">
                    <span className="font-mono text-[11px] text-ink-quiet">
                      allowed payees (comma-separated)
                    </span>
                    <input
                      id="mandatePayees"
                      name="mandatePayees"
                      placeholder="0x… or account-hash-…"
                      value={mandatePayeesDraft}
                      onChange={(e) => {
                        setMandatePayeesDraft(e.target.value);
                        setMandateSelfChecked(false);
                      }}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      disabled={busy}
                      className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
                    />
                    <label
                      htmlFor="mandateSelf"
                      className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-ink-soft"
                    >
                      <input
                        id="mandateSelf"
                        name="mandateSelf"
                        type="checkbox"
                        checked={mandateSelfChecked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setMandateSelfChecked(checked);
                          if (checked)
                            setMandatePayeesDraft(subjectDraft.trim());
                        }}
                        disabled={busy}
                        className="h-3.5 w-3.5 accent-[#b4552d]"
                      />
                      contracted payee is this address
                    </label>
                  </label>
                  <label htmlFor="mandateMaxUsd" className="block space-y-2">
                    <span className="font-mono text-[11px] text-ink-quiet">
                      cap · max usd
                    </span>
                    <input
                      id="mandateMaxUsd"
                      name="mandateMaxUsd"
                      inputMode="decimal"
                      placeholder="10000"
                      value={mandateMaxDraft}
                      onChange={(e) => setMandateMaxDraft(e.target.value)}
                      disabled={busy}
                      className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
                    />
                  </label>
                  <label
                    htmlFor="mandateExpectedUsd"
                    className="block space-y-2"
                  >
                    <span className="font-mono text-[11px] text-ink-quiet">
                      contracted price · usd
                    </span>
                    <input
                      id="mandateExpectedUsd"
                      name="mandateExpectedUsd"
                      inputMode="decimal"
                      placeholder="1200"
                      value={mandateExpectedDraft}
                      onChange={(e) => setMandateExpectedDraft(e.target.value)}
                      disabled={busy}
                      className="block w-full min-w-0 border-0 border-b border-rule bg-transparent pb-2 font-mono text-sm tabular text-ink outline-none transition-colors focus:border-terra disabled:opacity-60"
                    />
                  </label>
                </div>
                <p className="mt-2 font-serif text-sm italic text-ink-quiet">
                  No contract on file? Leave the payee list blank — right-payee
                  stays skipped and the credential is the whole answer.
                </p>
              </div>
            </>
          ) : null}
          {liveMismatch && switchHref ? (
            <div className="sm:col-span-3">
              <ChainSwitchHint mismatch={liveMismatch} href={switchHref} />
            </div>
          ) : null}
        </form>
        {sampleLinks}
      </section>

      {busy ? (
        <section className="mt-16" aria-live="polite" aria-busy="true">
          <h2 className="eyebrow">Verdict</h2>
          <div className="mt-4 flex flex-col-reverse gap-8 border-l-2 border-rule pl-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="eyebrow">gate · pre-payment check</p>
              <p className="mt-3 display text-3xl text-ink-quiet sm:text-4xl">
                Reading registry
                <span className="caret" aria-hidden />
              </p>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                one on-chain read · not a Ligis server
              </p>
            </div>
            <SubjectSpecimen
              subject={subjectDraft}
              state="reading"
              caption={false}
            />
          </div>
        </section>
      ) : (
        children
      )}
    </>
  );
}
