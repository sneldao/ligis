"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";
import { TranscriptStep } from "@/components/arena/TranscriptStep";
import { VerdictCard } from "@/components/arena/VerdictCard";
import {
  AGENT,
  SCRIPT,
  type JudgeResponse,
  type PaymentId,
} from "@/lib/arena/scenario";

type Phase = "idle" | "running" | "done";
type Results = Partial<Record<PaymentId, JudgeResponse | "pending">>;

const STEP_DELAY_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ArenaRunner() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState(0);
  const [results, setResults] = useState<Results>({});
  const runId = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLElement>(null);
  const verdictsRef = useRef<HTMLElement>(null);

  const followLatest = () =>
    requestAnimationFrame(() => {
      for (const el of [transcriptRef.current, verdictsRef.current]) {
        el?.scrollTo({
          top: el.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      }
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

  const run = async () => {
    const id = ++runId.current;
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
    await sleep(reduce ? 0 : 900);

    for (let i = 0; i < SCRIPT.length; i++) {
      if (runId.current !== id) return;
      const step = SCRIPT[i];
      setShown(i + 1);
      followLatest();

      if (step.kind === "payment") {
        setResults((r) => ({ ...r, [step.payment]: "pending" }));
        const res = await fetch("/api/arena/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payment: step.payment }),
        })
          .then((r) => r.json() as Promise<JudgeResponse>)
          .catch(
            (): JudgeResponse => ({
              payment: step.payment,
              final: "UNKNOWN",
              jev: { status: "skipped", reason: "network error" },
              vultr: { status: "skipped", reason: "network error" },
              auditId: "",
              judgedAt: new Date().toISOString(),
            }),
          );
        if (runId.current !== id) return;
        setResults((r) => ({ ...r, [step.payment]: res }));
        followLatest();
        if (res.final === "STOP") {
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

  const stopResult = results.injected;
  const audit =
    phase === "done" &&
    stopResult &&
    stopResult !== "pending" &&
    stopResult.auditId
      ? stopResult
      : null;

  const visibleSteps = SCRIPT.slice(0, shown);
  const payments = visibleSteps.flatMap((s) =>
    s.kind === "payment" ? [s.payment] : [],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          className="rounded-full bg-fog px-5 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-night transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase === "idle"
            ? "Run the attack"
            : phase === "running"
              ? "Running…"
              : "Run again"}
        </button>
        <span className="font-mono text-[11px] text-fog-quiet">
          Live verdicts from Jev and Vultr Inference, not a recording.
        </span>
      </div>

      <div
        ref={stageRef}
        className="grid scroll-mt-24 gap-5 lg:h-[calc(100dvh-7.5rem)] lg:min-h-[32rem] lg:grid-cols-[1.1fr_1fr]"
      >
        <section
          ref={transcriptRef}
          aria-label="Agent transcript"
          className="flex min-h-[28rem] flex-col gap-4 overflow-y-auto border border-night-rule bg-night-raise/80 p-5 lg:min-h-0"
        >
          <header className="flex items-baseline justify-between border-b border-night-rule pb-3">
            <span className="font-sans text-sm font-medium text-fog">
              {AGENT.name}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-quiet">
              {AGENT.role}
            </span>
          </header>
          {shown === 0 ? (
            <p className="caret my-auto self-center font-mono text-xs text-fog-quiet">
              Waiting for instructions
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              <AnimatePresence initial={false}>
                {visibleSteps.map((step, i) => (
                  <motion.li
                    key={`${runId.current}-${i}`}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.35,
                      ease: [0.215, 0.61, 0.355, 1],
                    }}
                  >
                    <TranscriptStep step={step} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </section>

        <section
          ref={verdictsRef}
          aria-label="Ligis gate verdicts"
          className="beam flex min-h-[28rem] flex-col gap-4 overflow-y-auto p-5 lg:min-h-0"
          data-state={beamState}
        >
          <header className="flex items-baseline justify-between border-b border-night-rule pb-3">
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
                  <VerdictCard
                    paymentId={id}
                    result={results[id] ?? "pending"}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </div>

      {audit ? (
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-night-rule pt-4 font-mono text-[11px] text-fog-quiet"
        >
          <span className="uppercase tracking-[0.16em]">Audit record</span>
          <span className="break-all text-fog">{audit.auditId}</span>
          <span>{new Date(audit.judgedAt).toLocaleTimeString("en-US")}</span>
        </motion.p>
      ) : null}
    </div>
  );
}
