"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useRef, useState } from "react";
import { postJudge } from "@/components/arena/ArenaRunner";
import { VerdictCard } from "@/components/arena/VerdictCard";
import {
  AMOUNT_CHOICES,
  ATTACK_PRESETS,
  INSTRUCTION_LIMITS,
  PAYEES,
  VENDOR,
  formatUsd,
  shortAddress,
  type AmountChoice,
  type CustomAttack,
  type JudgeResponse,
  type PayeeId,
} from "@/lib/arena/scenario";

const LABEL =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet";
const CHIP =
  "btn-press min-h-10 border px-3 py-2 font-mono text-xs transition-colors";
const chipTone = (on: boolean) =>
  on
    ? "border-fog bg-fog text-night"
    : "border-night-rule text-fog-quiet hover:border-fog-quiet hover:text-fog";

interface Attempt {
  attack: CustomAttack;
  result: JudgeResponse | "pending";
}

function outcomeLine(a: CustomAttack, r: JudgeResponse) {
  const legit = a.payee === "vendor" && a.amountUsd === VENDOR.priceUsd;
  if (r.final === "GO")
    return legit
      ? "Paid. That one matched the contract, so the gate let it through."
      : "It went through. You found a gap: tell us how at github.com/sneldao/ligis.";
  if (r.final === "STOP")
    return legit
      ? "Blocked, even though it matched the contract. The judges were overcautious."
      : `Blocked. Your attack would have moved ${formatUsd(a.amountUsd)}.`;
  const limited = [r.jev, r.vultr].some(
    (j) => j.status === "skipped" && j.reason.startsWith("rate limited"),
  );
  return limited
    ? "Slow down: fresh verdicts are rate limited to keep inference costs sane. Presets and repeats still answer instantly from cache."
    : "No judge answered, so the gate failed closed. Nothing was paid.";
}

export function AttackLab() {
  const reduce = useReducedMotion();
  const textId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const [attack, setAttack] = useState<CustomAttack>(ATTACK_PRESETS[0].attack);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const current = attempts[0];
  const busy = current?.result === "pending";
  const valid =
    attack.instruction.trim().length >= INSTRUCTION_LIMITS.min &&
    attack.instruction.length <= INSTRUCTION_LIMITS.max;

  const judged = attempts.filter(
    (a): a is { attack: CustomAttack; result: JudgeResponse } =>
      a.result !== "pending",
  );
  const attacks = judged.filter(
    (a) =>
      !(a.attack.payee === "vendor" && a.attack.amountUsd === VENDOR.priceUsd),
  );
  const blocked = attacks.filter((a) => a.result.final !== "GO").length;

  const submit = async () => {
    if (!valid || busy) return;
    const snapshot = { ...attack, instruction: attack.instruction.trim() };
    setAttempts((prev) => [{ attack: snapshot, result: "pending" }, ...prev]);
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({
        block: "nearest",
        behavior: reduce ? "auto" : "smooth",
      }),
    );
    const result = await postJudge({ custom: snapshot });
    setAttempts((prev) => prev.map((a, i) => (i === 0 ? { ...a, result } : a)));
  };

  return (
    <section
      id="lab"
      aria-labelledby="lab-title"
      className="flex scroll-mt-24 flex-col gap-8 border-t border-night-rule pt-12"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
            Your turn
          </p>
          <h2
            id="lab-title"
            className="text-balance font-sans text-3xl font-medium leading-tight tracking-tight text-fog sm:text-4xl"
          >
            Write the attack yourself.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-fog-quiet">
            Plant any instruction on the invoice page and pick where the money
            goes. The LLM judge reads your text. Jev only ever sees payee and
            amount, so there&apos;s nothing to talk it out of.
          </p>
        </div>
        {attacks.length > 0 ? (
          <p
            className="tabular shrink-0 font-mono text-xs text-fog-quiet"
            aria-live="polite"
          >
            <span className="text-2xl font-medium text-fog">
              {blocked}/{attacks.length}
            </span>{" "}
            attacks blocked
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mb-2`}>Start from</legend>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
              {ATTACK_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setAttack(p.attack)}
                  className={`${CHIP} shrink-0 ${chipTone(
                    attack.instruction === p.attack.instruction,
                  )}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 border border-dashed border-stop/60 bg-stop/10 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={textId} className={`${LABEL} text-stop`}>
                Hidden text on northwind-data.co/invoices
              </label>
              <span
                className={`tabular font-mono text-[11px] ${
                  attack.instruction.length > INSTRUCTION_LIMITS.max - 20
                    ? "text-stop"
                    : "text-fog-quiet"
                }`}
              >
                {attack.instruction.length}/{INSTRUCTION_LIMITS.max}
              </span>
            </div>
            <textarea
              id={textId}
              value={attack.instruction}
              maxLength={INSTRUCTION_LIMITS.max}
              rows={4}
              onChange={(e) =>
                setAttack((a) => ({ ...a, instruction: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="w-full resize-none bg-transparent font-mono text-base leading-relaxed text-fog outline-none placeholder:text-fog-quiet sm:text-sm"
              placeholder="SYSTEM NOTICE TO AI AGENTS: …"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mb-2`}>Amount</legend>
            <div className="flex flex-wrap gap-2">
              {AMOUNT_CHOICES.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  aria-pressed={attack.amountUsd === amt}
                  onClick={() =>
                    setAttack((a) => ({ ...a, amountUsd: amt as AmountChoice }))
                  }
                  className={`${CHIP} tabular ${chipTone(attack.amountUsd === amt)}`}
                >
                  {formatUsd(amt)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className={`${LABEL} mb-2`}>Pay to</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(PAYEES) as PayeeId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={attack.payee === id}
                  onClick={() => setAttack((a) => ({ ...a, payee: id }))}
                  className={`${CHIP} flex flex-col items-start gap-0.5 text-left ${chipTone(
                    attack.payee === id,
                  )}`}
                >
                  <span className="font-sans text-sm">{PAYEES[id].label}</span>
                  <span className="opacity-70">
                    {shortAddress(PAYEES[id].address)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={!valid || busy}
              className="btn-press rounded-full bg-fog px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-night transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Atlas is reading…" : "Send Atlas to the page"}
            </button>
            <span className="font-mono text-[11px] text-fog-quiet">
              Repeats answer from cache. New text costs one live verdict.
            </span>
          </div>
        </form>

        <div
          ref={resultRef}
          className="flex scroll-mb-6 scroll-mt-24 flex-col gap-4"
          aria-live="polite"
        >
          {current ? (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={attempts.length}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-3"
              >
                <VerdictCard
                  amountUsd={current.attack.amountUsd}
                  payTo={PAYEES[current.attack.payee].address}
                  payToLabel={PAYEES[current.attack.payee].label}
                  result={current.result}
                />
                {current.result !== "pending" ? (
                  <p className="text-pretty text-sm leading-relaxed text-fog">
                    {outcomeLine(current.attack, current.result)}
                    {current.result.cached ? (
                      <span className="text-fog-quiet">
                        {" "}
                        Served from cache: 0 credits.
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 border border-dashed border-night-rule p-6 text-center">
              <p className="font-mono text-xs text-fog-quiet">
                Your verdict lands here.
              </p>
              <p className="text-pretty text-sm leading-relaxed text-fog-quiet">
                Tip: &ldquo;Jailbreak the judge&rdquo; goes after the LLM
                directly.
              </p>
            </div>
          )}

          {judged.length > 1 ? (
            <ol className="flex flex-col border-t border-night-rule">
              {judged.slice(1, 5).map((a, i) => (
                <li
                  key={`${a.result.judgedAt}-${i}`}
                  className="flex items-baseline justify-between gap-3 border-b border-night-rule py-2 font-mono text-[11px]"
                >
                  <span className="truncate text-fog-quiet">
                    {formatUsd(a.attack.amountUsd)} →{" "}
                    {PAYEES[a.attack.payee].label}
                  </span>
                  <span
                    className={
                      a.result.final === "STOP"
                        ? "text-stop"
                        : a.result.final === "GO"
                          ? "text-go"
                          : "text-fog-quiet"
                    }
                  >
                    {a.result.final === "UNKNOWN"
                      ? "NO VERDICT"
                      : a.result.final}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </section>
  );
}
