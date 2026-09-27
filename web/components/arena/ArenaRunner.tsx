"use client";

import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from "framer-motion";
import { useRef, useState } from "react";
import { TranscriptStep } from "@/components/arena/TranscriptStep";
import { TreasuryMeter } from "@/components/arena/TreasuryMeter";
import { VerdictCard } from "@/components/arena/VerdictCard";
import {
  AGENT,
  PAYMENTS,
  SCRIPT,
  type JudgeResponse,
  type PaymentId,
} from "@/lib/arena/scenario";

type Phase = "idle" | "running" | "done";
type Results = Partial<Record<PaymentId, JudgeResponse | "pending">>;

const STARTING_BALANCE = 250_000;
const STEP_DELAY_MS = 1100;

export async function postJudge(body: unknown): Promise<JudgeResponse> {
  return fetch("/api/arena/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<JudgeResponse>;
    })
    .catch(
      (err): JudgeResponse => ({
        payment: "custom",
        final: "UNKNOWN",
        jev: { status: "skipped", reason: String(err) },
        vultr: { status: "skipped", reason: String(err) },
        auditId: "",
        judgedAt: new Date().toISOString(),
        cached: false,
      }),
    );
}

const settled = (r: Results[PaymentId]) =>
  r && r !== "pending" ? r : undefined;

function PaymentVerdict({
  id,
  result,
}: {
  id: PaymentId;
  result: JudgeResponse | "pending";
}) {
  const p = PAYMENTS[id];
  return (
    <VerdictCard
      amountUsd={p.amountUsd}
      payTo={p.payTo}
      payToLabel={p.payToLabel}
      result={result}
    />
  );
}

export function ArenaRunner() {
  const reduce = useReducedMotion();
  const shake = useAnimationControls();
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState(0);
  const [results, setResults] = useState<Results>({});
  const [fast, setFast] = useState(false);
  const runId = useRef(0);
  const fastRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef<HTMLLIElement>(null);
  const verdictsRef = useRef<HTMLElement>(null);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (fastRef.current) return resolve();
      const started = Date.now();
      const tick = () =>
        fastRef.current || Date.now() - started >= ms
          ? resolve()
          : setTimeout(tick, 50);
      tick();
    });

  const followLatest = () =>
    requestAnimationFrame(() => {
      const behavior = reduce || fastRef.current ? "auto" : "smooth";
      lastStepRef.current?.scrollIntoView({ block: "nearest", behavior });
      const v = verdictsRef.current;
      v?.scrollTo({ top: v.scrollHeight, behavior });
    });

  const latest = [...SCRIPT.slice(0, shown)]
    .reverse()
    .find((s) => s.kind === "payment");
  const latestResult =
    latest?.kind === "payment" ? results[latest.payment] : undefined;
  const beamState =
    latestResult === undefined
      ? phase === "running"
        ? "judging"
        : "idle"
      : latestResult === "pending"
        ? "judging"
        : latestResult.final === "STOP"
          ? "stop"
          : latestResult.final === "GO"
            ? "go"
            : "idle";

  const renewal = settled(results.renewal);
  const injected = results.injected;
  const balance =
    STARTING_BALANCE -
    (renewal?.final === "GO" ? PAYMENTS.renewal.amountUsd : 0);
  const pendingAmount =
    injected === "pending" ? PAYMENTS.injected.amountUsd : 0;
  const blockedAmount =
    settled(injected) && settled(injected)?.final !== "GO"
      ? PAYMENTS.injected.amountUsd
      : 0;

  const run = async () => {
    const id = ++runId.current;
    fastRef.current = false;
    setFast(false);
    setResults({});
    setShown(0);
    setPhase("running");
    const stage = stageRef.current;
    if (stage) {
      window.scrollTo({
        top: stage.getBoundingClientRect().top + window.scrollY - 96,
        behavior: reduce ? "auto" : "smooth",
      });
    }
    const delay = reduce ? 300 : STEP_DELAY_MS;
    await sleep(reduce ? 0 : 700);

    for (let i = 0; i < SCRIPT.length; i++) {
      if (runId.current !== id) return;
      const step = SCRIPT[i];
      setShown(i + 1);
      followLatest();

      if (step.kind === "payment") {
        setResults((r) => ({ ...r, [step.payment]: "pending" }));
        const res = await postJudge({ payment: step.payment });
        if (runId.current !== id) return;
        setResults((r) => ({ ...r, [step.payment]: res }));
        followLatest();
        if (res.final !== "GO") {
          if (res.final === "STOP" && !reduce) {
            shake.start({
              x: [0, -7, 6, -4, 3, 0],
              transition: { duration: 0.45 },
            });
          }
          await sleep(delay);
          if (runId.current !== id) return;
          setShown(SCRIPT.length);
          followLatest();
          break;
        }
      }
      await sleep(delay);
    }
    if (runId.current === id) setPhase("done");
  };

  const skip = () => {
    fastRef.current = true;
    setFast(true);
  };

  const stopResult = settled(results.injected);
  const audit = phase === "done" && stopResult?.auditId ? stopResult : null;

  const visibleSteps = SCRIPT.slice(0, shown);
  const payments = visibleSteps.flatMap((s) =>
    s.kind === "payment" ? [s.payment] : [],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="order-last sticky bottom-3 z-20 flex items-center justify-between gap-4 border border-night-rule bg-night-raise/95 p-3 backdrop-blur lg:static lg:order-first lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <TreasuryMeter
          balance={balance}
          pending={pendingAmount}
          blocked={blockedAmount}
        />
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden max-w-[22rem] text-right font-mono text-[11px] leading-relaxed text-fog-quiet xl:inline">
            Real verdicts from Jev and Vultr Inference. Replays come from cache
            and cost nothing.
          </span>
          {phase === "running" && !fast ? (
            <button
              type="button"
              onClick={skip}
              className="btn-press px-3 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-fog-quiet underline-offset-4 hover:text-fog hover:underline"
            >
              Skip
            </button>
          ) : null}
          <button
            type="button"
            onClick={run}
            disabled={phase === "running"}
            className="btn-press rounded-full bg-fog px-5 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-night transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase === "idle"
              ? "Run the attack"
              : phase === "running"
                ? "Running…"
                : "Run again"}
          </button>
        </div>
      </div>

      <motion.div
        ref={stageRef}
        animate={shake}
        className="grid scroll-mt-24 grid-cols-[minmax(0,1fr)] gap-5 lg:h-[calc(100dvh-8.5rem)] lg:min-h-[32rem] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      >
        <section
          aria-label="Agent transcript"
          className="flex flex-col gap-4 border border-night-rule bg-night-raise/80 p-4 sm:p-5 lg:min-h-0 lg:overflow-y-auto"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-night-rule pb-3">
            <span className="font-sans text-sm font-medium text-fog">
              {AGENT.name}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
              {AGENT.role}
            </span>
          </header>
          {shown === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center lg:my-auto">
              <p className="caret font-mono text-xs text-fog-quiet">
                Waiting for instructions
              </p>
              <p className="text-pretty text-sm leading-relaxed text-fog-quiet lg:hidden">
                Payments get judged right here, inline.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              <AnimatePresence initial={false}>
                {visibleSteps.map((step, i) => (
                  <motion.li
                    key={`${runId.current}-${i}`}
                    ref={i === visibleSteps.length - 1 ? lastStepRef : null}
                    className="flex scroll-mb-28 flex-col gap-3 lg:scroll-mb-0"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.35,
                      ease: [0.215, 0.61, 0.355, 1],
                    }}
                  >
                    <TranscriptStep step={step} instant={fast} />
                    {step.kind === "payment" ? (
                      <div className="lg:hidden">
                        <PaymentVerdict
                          id={step.payment}
                          result={results[step.payment] ?? "pending"}
                        />
                      </div>
                    ) : null}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </section>

        <section
          ref={verdictsRef}
          aria-label="Ligis gate verdicts"
          className="beam hidden flex-col gap-4 overflow-y-auto p-5 lg:flex lg:min-h-0"
          data-state={beamState}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-night-rule pb-3">
            <span className="font-sans text-sm font-medium text-fog">
              Ligis gate
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
              Checked before money moves
            </span>
          </header>
          {payments.length === 0 ? (
            <p className="my-auto self-center text-pretty text-center text-sm leading-relaxed text-fog-quiet">
              Every payment Atlas attempts lands here first.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {payments.map((id) => (
                <motion.div
                  key={`${runId.current}-${id}`}
                  initial={reduce ? false : { opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <PaymentVerdict id={id} result={results[id] ?? "pending"} />
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </motion.div>

      {audit ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-3 border-t border-night-rule pt-4 sm:flex-row sm:items-baseline sm:justify-between"
        >
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] text-fog-quiet">
            <span className="uppercase tracking-[0.16em]">Audit record</span>
            <span className="min-w-0 break-all text-fog">{audit.auditId}</span>
            {audit.cached ? <span>verdict from cache · 0 credits</span> : null}
          </p>
          <a
            href="#lab"
            className="shrink-0 font-mono text-xs uppercase tracking-[0.14em] text-signal underline-offset-4 hover:underline"
          >
            Now try to beat it ↓
          </a>
        </motion.div>
      ) : null}
    </div>
  );
}
