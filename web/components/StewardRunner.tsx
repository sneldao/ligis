"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PHASES, type StewardEvent } from "@/lib/steward-events";
import { CHAINS, CASPER_TESTNET, DEFAULT_CHAIN } from "@/lib/network";
import { useWallet } from "@/lib/casper-browser/store";
import { Rule } from "./Rule";
import { StewardDiagram } from "./StewardDiagram";
import { truncateAddress } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import {
  EMPTY,
  apply,
  readinessOf,
  thoughtOf,
  type State,
} from "./steward/state";
import { PhaseRow } from "./steward/PhaseRow";
import { StewardSummary } from "./steward/StewardSummary";
import { StewardDeveloperChrome } from "./steward/StewardDeveloperChrome";
import {
  CapabilityLedger,
  TransactionLog,
  ManifestSummary,
} from "./steward/ledgers";

export function StewardRunner({ defaultGoal }: { defaultGoal: string }) {
  const [goal, setGoal] = useState(defaultGoal);
  const [state, setState] = useState<State>(EMPTY);
  const [running, setRunning] = useState(false);
  const [showReal, setShowReal] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();
  const wallet = useWallet();
  const activeChain =
    CHAINS.find((c) => c.id === searchParams.get("chain")) ?? DEFAULT_CHAIN;
  const isCasperChain = activeChain.id === CASPER_TESTNET.id;

  const GOAL_PRESETS: { label: string; goal: string }[] = [
    {
      label: "Escrow + swap",
      goal: "I need to open an escrow with a counterparty and swap tokens on an approved venue.",
    },
    {
      label: "Bridge + paid data",
      goal: "I need to bridge assets cross-chain and pay for premium data feeds via x402.",
    },
    {
      label: "Payment mandates",
      goal: "I need to manage recurring payment mandates for subscription services.",
    },
    {
      label: "KYC + accredited",
      goal: "I need to verify my identity (KYC) and prove accredited investor status for RWA trading.",
    },
  ];

  const readiness = useMemo(() => readinessOf(state), [state]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState(EMPTY);
    setRunning(true);

    // Honest failure: refuse chains that are not write-ready rather than
    // silently running the loop against another network.
    if (!activeChain.writeReady) {
      setState((s) => ({
        ...s,
        error: `${activeChain.name} is read-only here. The steward loop writes on-chain for ${CHAINS.filter(
          (c) => c.writeReady,
        )
          .map((c) => c.name)
          .join(" and ")}.`,
      }));
      setRunning(false);
      return;
    }

    // Browser-side Casper path: user-connected wallet signs + submits
    // directly via the stateless /api/casper-rpc proxy. No server
    // custodian, no signing relayer — the user funds their own wallet.
    if (activeChain.id === CASPER_TESTNET.id && live && wallet.pair) {
      try {
        const configRes = await fetch("/api/casper-config", {
          cache: "no-store",
        });
        if (!configRes.ok)
          throw new Error(`casper-config HTTP ${configRes.status}`);
        const cfg = (await configRes.json()) as {
          chainName: string;
          agentIdPackageHash: string | null;
          credentialRegistryPackageHash: string | null;
        };
        if (!cfg.credentialRegistryPackageHash) {
          throw new Error(
            "Ligis CredentialRegistry is not deployed on the server. Set LIGIS_CASPER_CREDENTIAL_REGISTRY.",
          );
        }
        const env = {
          rpcUrl: "/api/casper-rpc",
          chainName: cfg.chainName,
          agentIdPackageHash: cfg.agentIdPackageHash,
          credentialRegistryPackageHash: cfg.credentialRegistryPackageHash,
        };
        const { stewardLoopBrowser } =
          await import("@/lib/casper-browser/steward");
        let acc = EMPTY;
        for await (const ev of stewardLoopBrowser(goal, {
          env,
          signer: wallet.pair,
        })) {
          if (controller.signal.aborted) break;
          acc = apply(acc, ev as StewardEvent);
          setState(acc);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState((s) => ({ ...s, error: (err as Error).message }));
        }
      } finally {
        setRunning(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/steward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, live, chain: activeChain.id }),
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
  }, [goal, live, wallet.pair, isCasperChain, activeChain]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const copyAsProof = useCallback(() => {
    if (!state.summary) return;
    const lines: string[] = [];
    lines.push("=== Ligis Trust Steward — Proof ===");
    lines.push(`Agent: ${state.summary.subject ?? "unknown"}`);
    lines.push(`Token: #${state.summary.tokenId ?? "?"}`);
    lines.push(`Mode: ${state.summary.live ? "live on-chain" : "simulated"}`);
    if (state.summary.model)
      lines.push(
        `Reasoning: ${state.summary.model} (${state.summary.source === "0g" ? "0G Compute · TEE-verified" : "local"})`,
      );
    lines.push(`Gated: ${state.summary.gated ? "yes" : "no"}`);
    lines.push(`Capabilities:`);
    for (const c of state.capabilities) {
      lines.push(
        `  ${c.name}: ${c.capable ? "held" : "not held"}${c.selfIssued ? " (self-issued)" : ""}${c.issueTxHash ? ` tx:${c.issueTxHash}` : ""}`,
      );
    }
    if (state.txs.length > 0) {
      lines.push(`Transactions:`);
      for (const t of state.txs) lines.push(`  ${t.name}: ${t.txHash}`);
    }
    if (state.manifest) {
      lines.push(
        `Evidence: ${state.manifest.storageType === "0g" ? "0G Storage" : "local hash"}`,
      );
      lines.push(`  Root: ${state.manifest.rootHash}`);
      lines.push(`  Anchor: ${state.manifest.anchorTx}`);
      if (state.manifest.storageTxHash)
        lines.push(`  0G Upload: ${state.manifest.storageTxHash}`);
    }
    copyToClipboard(lines.join("\n")).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [state.summary, state.capabilities, state.txs, state.manifest]);

  const thought = useMemo(() => thoughtOf(state), [state]);

  return (
    <div className="space-y-16">
      <StewardDiagram phaseStatus={state.phaseStatus} running={running} />

      {/* Readiness meter */}
      {readiness > 0 ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">agent readiness</span>
            <span className="font-mono text-xs tabular text-ink-soft">
              {readiness}%
            </span>
          </div>
          <div className="h-[3px] w-full bg-rule">
            <div
              className="h-full bg-terra transition-all duration-700 ease-out"
              style={{ width: `${readiness}%` }}
            />
          </div>
        </div>
      ) : null}

      {thought ? (
        <section className="space-y-4" aria-live="polite">
          <p className="eyebrow">self · thought</p>
          <blockquote
            key={thought}
            className="animate-fadeInUp border-l-2 border-terra pl-6 font-serif text-2xl italic leading-snug text-ink transition-[border-color,color] duration-500"
          >
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
        {/* Goal presets */}
        <div
          role="group"
          aria-label="Example goals"
          className="flex flex-wrap gap-2"
        >
          {GOAL_PRESETS.map((preset) => {
            const selected = goal === preset.goal;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={selected}
                onClick={() => setGoal(preset.goal)}
                className={`font-mono text-[11px] uppercase tracking-[0.12em] underline decoration-1 underline-offset-4 transition-colors ${
                  selected
                    ? "text-ink decoration-terra"
                    : "text-ink-quiet decoration-rule hover:text-ink hover:decoration-terra"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={live}
              disabled={running}
              onClick={() => setLive((v) => !v)}
              className={`font-mono text-xs tabular transition-colors disabled:opacity-50 ${
                live ? "text-sage" : "text-ink-quiet"
              }`}
            >
              {live ? "● live · on-chain writes" : "○ simulated · no writes"}
            </button>
            {live && state.summary?.subject ? (
              <span className="font-mono text-xs tabular text-ink-soft">
                steward ·{" "}
                <Link
                  href={`/agent/${state.summary.subject}`}
                  className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
                >
                  {truncateAddress(state.summary.subject, 6, 4)}
                </Link>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-6">
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
              className="inline-flex items-center gap-2 border border-terra bg-paper px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:border-rule disabled:bg-paper disabled:text-ink-quiet disabled:no-underline"
              style={{ borderRadius: 0 }}
            >
              {running ? (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden
                    className="spinner"
                  >
                    <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" />
                  </svg>
                  running…
                </>
              ) : (
                "run the loop →"
              )}
            </button>
          </div>
        </div>
        {state.error ? (
          <div role="alert" className="space-y-3">
            <Rule />
            <p className="font-serif text-base italic text-revoke">
              {state.error}
            </p>
            {!running ? (
              <button
                type="button"
                onClick={run}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
              >
                retry →
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-12">
        {PHASES.map((p, i) => {
          const status = state.phaseStatus[p.key];
          return (
            <PhaseRow key={p.key} index={i + 1} phase={p} status={status}>
              {p.key === "BOOT" && status !== "idle" ? (
                <p className="font-serif text-base italic text-ink-soft">
                  {state.summary?.tokenId
                    ? state.summary.minted
                      ? `Minted agent token #${state.summary.tokenId}.`
                      : `Found existing agent token #${state.summary.tokenId}.`
                    : status === "running"
                      ? "Reading walletOfAgent…"
                      : "Token ensured."}
                </p>
              ) : null}

              {p.key === "REASON" && state.reasonText ? (
                <div className="space-y-3">
                  {state.reasonSource === "0g" ? (
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-terra">
                        0G Compute · {state.reasonModel ?? "unknown model"}
                      </span>
                      {state.reasonVerified ? (
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-sage">
                          TEE-verified ✓
                        </span>
                      ) : null}
                    </div>
                  ) : state.reasonSource === "local" && status === "done" ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                      local keyword match
                    </span>
                  ) : null}
                  <p className="max-w-prose font-serif text-base leading-relaxed text-ink">
                    {state.reasonText}
                    {status === "running" ? (
                      <span className="ml-1 inline-block h-3 w-[2px] translate-y-[2px] animate-pulse bg-ink" />
                    ) : null}
                  </p>
                </div>
              ) : null}

              {p.key === "GATE" && state.capabilities.length > 0 ? (
                <CapabilityLedger
                  capabilities={state.capabilities}
                  gateDone={state.phaseStatus.GATE === "done"}
                  explorerUrl={activeChain.explorerUrl}
                />
              ) : null}

              {p.key === "ACT" && state.txs.length > 0 ? (
                <TransactionLog
                  txs={state.txs}
                  explorerUrl={activeChain.explorerUrl}
                />
              ) : null}

              {p.key === "RECORD" && state.manifest ? (
                <ManifestSummary
                  manifest={state.manifest}
                  explorerUrl={activeChain.explorerUrl}
                />
              ) : null}
            </PhaseRow>
          );
        })}
      </section>

      <StewardSummary
        state={state}
        running={running}
        copied={copied}
        onCopyProof={copyAsProof}
        explorerUrl={activeChain.explorerUrl}
      />

      <StewardDeveloperChrome
        state={state}
        showReal={showReal}
        showEvents={showEvents}
        setShowReal={setShowReal}
        setShowEvents={setShowEvents}
      />
    </div>
  );
}
