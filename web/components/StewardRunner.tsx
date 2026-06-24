"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PHASES, type Phase, type StewardEvent } from "@/lib/steward-events";
import { Rule } from "./Rule";
import { StewardDiagram } from "./StewardDiagram";
import { truncateAddress, truncateHash } from "@/lib/format";

type PhaseStatus = "idle" | "running" | "done" | "error";

type State = {
  phaseStatus: Record<Phase, PhaseStatus>;
  reasonText: string;
  capabilities: Array<{ name: string; capable: boolean }>;
  txs: Array<{ name: string; txHash: string }>;
  manifest: { rootHash: string; anchorTx: string } | null;
  summary: { ok: boolean; tokenId?: string } | null;
  error: string | null;
  events: StewardEvent[];
};

const EMPTY: State = {
  phaseStatus: { BOOT: "idle", REASON: "idle", GATE: "idle", ACT: "idle", RECORD: "idle" },
  reasonText: "",
  capabilities: [],
  txs: [],
  manifest: null,
  summary: null,
  error: null,
  events: [],
};

function apply(state: State, ev: StewardEvent): State {
  const next: State = {
    ...state,
    events: [...state.events, ev],
  };
  switch (ev.type) {
    case "phase":
      next.phaseStatus = { ...state.phaseStatus, [ev.phase]: ev.status === "start" ? "running" : ev.status };
      break;
    case "delta":
      next.reasonText = state.reasonText + ev.text;
      break;
    case "capability":
      next.capabilities = [...state.capabilities, { name: ev.name, capable: ev.capable }];
      break;
    case "tx":
      next.txs = [...state.txs, { name: ev.name, txHash: ev.txHash }];
      break;
    case "manifest":
      next.manifest = { rootHash: ev.rootHash, anchorTx: ev.anchorTx };
      break;
    case "summary":
      next.summary = { ok: ev.ok, tokenId: ev.tokenId };
      break;
    case "error":
      next.error = ev.message;
      break;
  }
  return next;
}

export function StewardRunner({ defaultGoal }: { defaultGoal: string }) {
  const [goal, setGoal] = useState(defaultGoal);
  const [state, setState] = useState<State>(EMPTY);
  const [running, setRunning] = useState(false);
  const [showReal, setShowReal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState(EMPTY);
    setRunning(true);

    try {
      const res = await fetch("/api/steward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = EMPTY;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as StewardEvent;
            acc = apply(acc, ev);
            setState(acc);
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState((s) => ({ ...s, error: (err as Error).message }));
      }
    } finally {
      setRunning(false);
    }
  }, [goal]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const eventCount = state.events.length;
  const jsonPanel = useMemo(() => JSON.stringify(state.events, null, 2), [state.events]);

  const thought = useMemo(() => {
    const ps = state.phaseStatus;
    for (const phase of ["RECORD", "ACT", "GATE", "REASON", "BOOT"] as const) {
      const s = ps[phase];
      if (s === "running" || s === "done") {
        return AGENT_THOUGHTS[phase]?.[s] ?? null;
      }
    }
    return AGENT_THOUGHTS.BOOT.idle;
  }, [state.phaseStatus]);

  return (
    <div className="space-y-16">
      <StewardDiagram phaseStatus={state.phaseStatus} running={running} />

      {thought ? (
        <section className="space-y-4" key={thought}>
          <p className="eyebrow">self · thought</p>
          <blockquote className="animate-fadeInUp border-l-2 border-terra pl-6 font-serif text-2xl italic leading-snug text-ink transition-[border-color,color] duration-500">
            {thought}
          </blockquote>
        </section>
      ) : null}

      <section className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="goal" className="eyebrow block">
            goal · imperative
          </label>
          <textarea
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="block w-full resize-none border-0 border-b border-rule bg-transparent pb-3 font-serif text-lg leading-relaxed text-ink outline-none transition-colors focus:border-terra"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="font-mono text-[11px] tabular text-ink-quiet">
            simulated · no on-chain writes
          </p>
          <div className="flex items-baseline gap-6">
            {running ? (
              <button
                type="button"
                onClick={stop}
                className="text-sm text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-revoke hover:decoration-revoke"
              >
                stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="text-sm text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra disabled:text-ink-quiet disabled:no-underline"
            >
              {running ? "running…" : "run the loop →"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-12">
        {PHASES.map((p, i) => {
          const status = state.phaseStatus[p.key];
          return (
            <PhaseRow key={p.key} index={i + 1} phase={p} status={status}>
              {p.key === "BOOT" && status !== "idle" ? (
                <p className="font-serif text-base italic text-ink-soft">
                  {state.summary?.tokenId
                    ? `Ensured agent token #${state.summary.tokenId}.`
                    : status === "running"
                      ? "Reading walletOfAgent…"
                      : "Token ensured."}
                </p>
              ) : null}

              {p.key === "REASON" && state.reasonText ? (
                <p className="max-w-prose font-serif text-base leading-relaxed text-ink">
                  {state.reasonText}
                  {status === "running" ? (
                    <span className="ml-1 inline-block h-3 w-[2px] translate-y-[2px] animate-pulse bg-ink" />
                  ) : null}
                </p>
              ) : null}

              {p.key === "GATE" && state.capabilities.length > 0 ? (
                <div className="space-y-0">
                  {state.capabilities.map((c) => (
                    <div key={c.name}>
                      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-3 text-sm">
                        <span className="font-mono tabular text-ink">{c.name}</span>
                        <span
                          className={`font-mono text-[11px] uppercase tracking-[0.16em] ${c.capable ? "text-sage" : "text-ink-quiet"}`}
                        >
                          {c.capable ? "held" : "not held"}
                        </span>
                      </div>
                      <Rule tone="soft" />
                    </div>
                  ))}
                </div>
              ) : null}

              {p.key === "ACT" && state.txs.length > 0 ? (
                <div className="space-y-0">
                  {state.txs.map((t) => (
                    <div key={t.txHash}>
                      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-8 py-3 text-sm">
                        <span className="font-mono tabular text-ink">
                          issued {t.name}
                        </span>
                        <span className="font-mono tabular text-ink-soft">
                          {truncateHash(t.txHash, 10, 6)}
                        </span>
                      </div>
                      <Rule tone="soft" />
                    </div>
                  ))}
                </div>
              ) : null}

              {p.key === "RECORD" && state.manifest ? (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                    <span className="text-ink-quiet">manifest root</span>
                    <span className="font-mono tabular text-ink">
                      {truncateHash(state.manifest.rootHash, 10, 6)}
                    </span>
                  </div>
                  <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                    <span className="text-ink-quiet">anchor tx</span>
                    <span className="font-mono tabular text-ink">
                      {truncateAddress(state.manifest.anchorTx, 10, 6)}
                    </span>
                  </div>
                </div>
              ) : null}
            </PhaseRow>
          );
        })}
      </section>

      {state.error ? (
        <section className="space-y-3">
          <p className="eyebrow">error</p>
          <Rule />
          <p className="font-serif text-base italic text-revoke">{state.error}</p>
        </section>
      ) : null}

      {/* Real CLI commands toggle */}
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setShowReal((v) => !v)}
          className="eyebrow flex items-baseline gap-3 text-ink-soft transition-colors hover:text-ink"
        >
          <span>{showReal ? "▾" : "▸"}</span>
          <span>Real CLI commands</span>
        </button>
        {showReal ? (
          <div className="space-y-5">
            <PhaseCommand
              index={1}
              label="boot"
              command={`PRIVATE_KEY=0x... ligis issue --token-uri "ipfs://my-agent"`}
              note="Mints a PharosAgentID to the signer's wallet. Returns tokenId."
            />
            <PhaseCommand
              index={2}
              label="reason"
              command={`ligis agent run --goal "Operate as a Pharos agent…" --dry-run`}
              note="Sends the goal to 0G Compute (TEE-verified LLM). Returns the required capability list."
            />
            <PhaseCommand
              index={3}
              label="gate"
              command={`ligis verify --subject 0x... --capability "agent.commerce.escrow"`}
              note="Reads isCapable from CredentialRegistry. Returns capable: true/false."
            />
            <PhaseCommand
              index={4}
              label="act"
              command={`ligis sign --issuer-key 0x... --subject 0x... --capability "agent.commerce.escrow" --expires-in 15552000`}
              note="Signs an EIP-712 credential off-chain, then submits it on-chain via cast send."
            />
            <PhaseCommand
              index={5}
              label="record"
              command={`ligis agent run --goal "Operate as a Pharos agent…"`}
              note="Full loop: boot → reason → gate → act → record. Requires PRIVATE_KEY + ZEROG_PRIVATE_KEY."
            />
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <header className="flex items-baseline justify-between">
          <p className="eyebrow">stream · raw events</p>
          <span className="font-mono text-[11px] tabular text-ink-quiet">
            {eventCount} events
          </span>
        </header>
        <Rule />
        <pre className="max-h-72 overflow-auto bg-paper-deep px-5 py-4 font-mono text-[11px] leading-relaxed tabular text-ink">
          {eventCount === 0 ? "// Run the loop to populate the stream." : jsonPanel}
        </pre>
      </section>
    </div>
  );
}

const AGENT_THOUGHTS: Record<string, Record<string, string>> = {
  BOOT: {
    idle: "I exist, but I don't know who I am yet.",
    running: "Searching the registry for my agent token…",
    done: "I'm token #341. I exist on-chain. Now — what am I for?",
  },
  REASON: {
    running: "Sending my goal to 0G Compute. What capabilities does this require?",
    done: "I need escrow and swap. Let me check what I already hold.",
  },
  GATE: {
    running: "Checking the credential registry — what do I have, what's missing?",
    done: "I hold swap, but escrow is missing. I know what I need.",
  },
  ACT: {
    running: "Self-issuing the missing credential. I don't need permission — I'm authorized.",
    done: "Credential issued and on-chain. I have everything I need.",
  },
  RECORD: {
    running: "Writing my evidence manifest to 0G Storage — goal, reasoning, every tx hash.",
    done: "I know who I am, what I can do, and I can prove both.",
  },
};

function PhaseCommand({
  index,
  label,
  command,
  note,
}: {
  index: number;
  label: string;
  command: string;
  note: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] tabular text-ink-quiet">
          {String(index).padStart(2, "0")}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
          {label}
        </span>
      </div>
      <pre className="overflow-x-auto bg-paper-deep px-4 py-3 font-mono text-[12px] leading-relaxed tabular text-ink">
        {command}
      </pre>
      <p className="font-serif text-xs italic leading-relaxed text-ink-quiet">
        {note}
      </p>
    </div>
  );
}

function PhaseRow({
  index,
  phase,
  status,
  children,
}: {
  index: number;
  phase: (typeof PHASES)[number];
  status: PhaseStatus;
  children: React.ReactNode;
}) {
  const dotColor =
    status === "running"
      ? "bg-terra animate-pulse"
      : status === "done"
        ? "bg-sage"
        : status === "error"
          ? "bg-revoke"
          : "bg-rule";
  const indexColor = status === "idle" ? "text-ink-quiet" : "text-ink";

  const statusKey = `${index}-${status}`;

  return (
    <div className="grid grid-cols-[3rem_1fr] items-start gap-x-6">
      <div className="flex flex-col items-center gap-3 pt-[6px]">
        <span
          className={`block h-1.5 w-1.5 rounded-full ${dotColor}`}
          aria-hidden
        />
      </div>
      <div className="space-y-3" key={statusKey}>
        <header className="flex items-baseline justify-between">
          <p className={`text-[11px] uppercase tracking-[0.16em] ${indexColor}`}>
            {String(index).padStart(2, "0")} · {phase.label}
          </p>
          <span className="font-mono text-[11px] tabular text-ink-quiet">
            {status === "idle" ? "—" : status}
          </span>
        </header>
        <Rule />
        <p className={`font-serif text-sm italic transition-colors duration-500 ${status === "running" ? "text-terra" : status === "done" ? "text-sage" : "text-ink-quiet"}`}>
          {phase.gloss}.
        </p>
        {status !== "idle" ? (
          <div className="animate-fadeInUp">{children}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
