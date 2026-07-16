"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PHASES, type Phase, type StewardEvent } from "@/lib/steward-events";
import { network, CHAINS, CASPER_TESTNET } from "@/lib/network";
import { useWallet } from "@/lib/casper-browser/store";
import { Rule } from "./Rule";
import { StewardDiagram } from "./StewardDiagram";
import { truncateAddress, truncateHash } from "@/lib/format";

type PhaseStatus = "idle" | "running" | "done" | "error";

type State = {
  phaseStatus: Record<Phase, PhaseStatus>;
  reasonText: string;
  reasonModel?: string;
  reasonVerified?: boolean;
  reasonSource?: "0g" | "local";
  capabilities: Array<{ name: string; capable: boolean; selfIssued: boolean; issueTxHash?: string }>;
  txs: Array<{ name: string; txHash: string }>;
  manifest: { rootHash: string; anchorTx: string; storageType: string; tokenUri: string; storageTxHash?: string } | null;
  summary: { ok: boolean; tokenId?: string; gated?: boolean; live: boolean; rpcCalls?: number; subject?: string; minted?: boolean; model?: string; source?: "0g" | "local" } | null;
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
    case "boot":
      next.summary = { ok: true, tokenId: ev.tokenId, live: false, subject: ev.subject, minted: ev.minted };
      break;
    case "delta":
      next.reasonText = state.reasonText + ev.text;
      next.reasonModel = ev.model;
      next.reasonVerified = ev.verified;
      next.reasonSource = ev.source;
      break;
    case "capability": {
      const existing = state.capabilities.findIndex((c) => c.name === ev.name);
      const entry = { name: ev.name, capable: ev.capable, selfIssued: ev.selfIssued, issueTxHash: ev.issueTxHash };
      if (existing >= 0) {
        next.capabilities = state.capabilities.map((c, i) => i === existing ? entry : c);
      } else {
        next.capabilities = [...state.capabilities, entry];
      }
      break;
    }
    case "tx":
      next.txs = [...state.txs, { name: ev.name, txHash: ev.txHash }];
      break;
    case "manifest":
      next.manifest = { rootHash: ev.rootHash, anchorTx: ev.anchorTx, storageType: ev.storageType, tokenUri: ev.tokenUri, storageTxHash: ev.storageTxHash };
      break;
    case "summary":
      next.summary = { ok: ev.ok, tokenId: ev.tokenId, gated: ev.gated, live: ev.live, rpcCalls: ev.rpcCalls, subject: ev.subject, minted: next.summary?.minted, model: ev.model, source: ev.source };
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
  const [showEvents, setShowEvents] = useState(false);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();
  const wallet = useWallet();
  const isCasperChain =
    (searchParams.get("chain") ?? "pharos-atlantic") === CASPER_TESTNET.id;
  const walletReadyForLive = isCasperChain && live && !!wallet.pair;

  const GOAL_PRESETS = [
    "I need to open an escrow with a counterparty and swap tokens on an approved venue.",
    "I need to bridge assets cross-chain and pay for premium data feeds via x402.",
    "I need to manage recurring payment mandates for subscription services.",
    "I need to verify my identity (KYC) and prove accredited investor status for RWA trading.",
  ];

  const readiness = useMemo(() => {
    const ps = state.phaseStatus;
    if (ps.BOOT === "idle") return 0;
    if (ps.BOOT === "running") return 5;
    if (ps.REASON === "running") return 15;
    if (ps.REASON === "done") return 25;
    if (ps.GATE === "running") return 35;
    if (ps.GATE === "done") {
      const held = state.capabilities.filter((c) => c.capable).length;
      const total = state.capabilities.length || 1;
      return 35 + Math.round((held / total) * 40);
    }
    if (ps.ACT === "running") return 70;
    if (ps.ACT === "done") return 85;
    if (ps.RECORD === "running") return 90;
    if (ps.RECORD === "done") return 100;
    return 0;
  }, [state.phaseStatus, state.capabilities]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState(EMPTY);
    setRunning(true);

    // Resolve chain from URL query param
    const chainParam = searchParams.get("chain") ?? "pharos-atlantic";
    const activeChain = CHAINS.find((c) => c.id === chainParam) ?? CHAINS[0]!;

    // Browser-side Casper path: user-connected wallet signs + submits
    // directly via the stateless /api/casper-rpc proxy. No server
    // custodian, no signing relayer — the user funds their own wallet.
    if (activeChain.id === CASPER_TESTNET.id && live && wallet.pair) {
      try {
        const configRes = await fetch("/api/casper-config", { cache: "no-store" });
        if (!configRes.ok) throw new Error(`casper-config HTTP ${configRes.status}`);
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
        const { stewardLoopBrowser } = await import("@/lib/casper-browser/steward");
        let acc = EMPTY;
        for await (const ev of stewardLoopBrowser(goal, { env, signer: wallet.pair })) {
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
  }, [goal, live, wallet.pair, isCasperChain]);

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
    if (state.summary.model) lines.push(`Reasoning: ${state.summary.model} (${state.summary.source === "0g" ? "0G Compute · TEE-verified" : "local"})`);
    lines.push(`Gated: ${state.summary.gated ? "yes" : "no"}`);
    lines.push(`Capabilities:`);
    for (const c of state.capabilities) {
      lines.push(`  ${c.name}: ${c.capable ? "held" : "not held"}${c.selfIssued ? " (self-issued)" : ""}${c.issueTxHash ? ` tx:${c.issueTxHash}` : ""}`);
    }
    if (state.txs.length > 0) {
      lines.push(`Transactions:`);
      for (const t of state.txs) lines.push(`  ${t.name}: ${t.txHash}`);
    }
    if (state.manifest) {
      lines.push(`Evidence: ${state.manifest.storageType === "0g" ? "0G Storage" : "local hash"}`);
      lines.push(`  Root: ${state.manifest.rootHash}`);
      lines.push(`  Anchor: ${state.manifest.anchorTx}`);
      if (state.manifest.storageTxHash) lines.push(`  0G Upload: ${state.manifest.storageTxHash}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [state.summary, state.capabilities, state.txs, state.manifest]);

  const eventCount = state.events.length;
  const jsonPanel = useMemo(() => JSON.stringify(state.events, null, 2), [state.events]);

  const thought = useMemo(() => {
    const ps = state.phaseStatus;
    const caps = state.capabilities;
    const held = caps.filter((c) => c.capable).map((c) => c.name);
    const missing = caps.filter((c) => !c.capable).map((c) => c.name);
    const tokenId = state.summary?.tokenId;

    for (const phase of ["RECORD", "ACT", "GATE", "REASON", "BOOT"] as const) {
      const s = ps[phase];
      if (s === "running" || s === "done") {
        if (phase === "BOOT") {
          if (s === "running") return "Searching the registry for my agent token…";
          return tokenId ? `I'm token #${tokenId}. I exist on-chain. Now — what am I for?` : "I exist on-chain. Now — what am I for?";
        }
        if (phase === "REASON") {
          if (s === "running") return "Sending my goal to 0G Compute. What capabilities does this require?";
          return caps.length > 0 ? `I need ${caps.map((c) => c.name.split(".").pop()).join(" and ")}. Let me check what I already hold.` : "I know what I need. Let me check what I already hold.";
        }
        if (phase === "GATE") {
          if (s === "running") return "Checking the credential registry — what do I have, what's missing?";
          if (missing.length === 0) return "I hold everything I need. I'm ready.";
          const heldShort = held.map((n) => n.split(".").pop());
          const missingShort = missing.map((n) => n.split(".").pop());
          return `I hold ${held.length > 0 ? heldShort.join(", ") : "nothing"}, but ${missingShort.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing. I know what I need.`;
        }
        if (phase === "ACT") {
          if (s === "running") return "Self-issuing the missing credential. I don't need permission — I'm authorized.";
          return "Credential issued and on-chain. I have everything I need.";
        }
        if (phase === "RECORD") {
          if (s === "running") return "Writing my evidence manifest to 0G Storage — goal, reasoning, every tx hash.";
          return "I know who I am, what I can do, and I can prove both.";
        }
      }
    }
    return "I exist, but I don't know who I am yet.";
  }, [state.phaseStatus, state.capabilities, state.summary?.tokenId]);

  return (
    <div className="space-y-16">
      <StewardDiagram phaseStatus={state.phaseStatus} running={running} />

      {/* Readiness meter */}
      {readiness > 0 ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">agent readiness</span>
            <span className="font-mono text-[11px] tabular text-ink-soft">{readiness}%</span>
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
        {/* Goal presets */}
        <div className="flex flex-wrap gap-2">
          {GOAL_PRESETS.map((preset, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setGoal(preset)}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-quiet underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              {preset.split(" ").slice(0, 4).join(" ")}…
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`font-mono text-[11px] tabular transition-colors ${
                live ? "text-sage" : "text-ink-quiet"
              }`}
            >
              {running
                ? "○ running…"
                : live
                  ? "● live · on-chain"
                  : "○ simulated · no writes"}
            </button>
            {live && state.summary?.subject ? (
              <span className="font-mono text-[10px] tabular text-ink-soft">
                steward · <Link href={`/agent/${state.summary.subject}`} className="underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra">{truncateAddress(state.summary.subject, 6, 4)}</Link>
              </span>
            ) : null}
          </div>
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra">
                        0G Compute · {state.reasonModel ?? "unknown model"}
                      </span>
                      {state.reasonVerified ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-sage">
                          TEE-verified ✓
                        </span>
                      ) : null}
                    </div>
                  ) : state.reasonSource === "local" && status === "done" ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">
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
                <div className="space-y-0">
                  {state.capabilities.map((c) => (
                    <div key={c.name}>
                      <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-4 py-3 text-sm">
                        <span className={`text-base ${c.capable ? "text-sage" : "text-ink-quiet"}`} aria-hidden>
                          {c.capable ? "✓" : "✕"}
                        </span>
                        <div className="space-y-0.5">
                          <span className="font-mono tabular text-ink">{c.name}</span>
                          {c.selfIssued ? (
                            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.12em] text-terra">self-issued</span>
                          ) : null}
                        </div>
                        <span
                          className={`font-mono text-[11px] uppercase tracking-[0.16em] ${c.capable ? "text-sage" : "text-ink-quiet"}`}
                        >
                          {c.capable ? "held" : "not held"}
                        </span>
                        <span className="w-28 text-right font-mono text-[10px] tabular text-ink-soft">
                          {c.issueTxHash ? (
                            <a
                              href={`${network.explorerUrl}/tx/${c.issueTxHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                            >
                              {truncateHash(c.issueTxHash, 8, 6)}
                            </a>
                          ) : ""}
                        </span>
                      </div>
                      <Rule tone="soft" />
                    </div>
                  ))}
                  {state.phaseStatus.GATE === "done" ? (
                    <p className="pt-3 font-mono text-[11px] tabular text-ink-quiet">
                      {state.capabilities.filter((c) => c.capable).length} held · {state.capabilities.filter((c) => !c.capable).length} missing
                    </p>
                  ) : null}
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
                        <a
                          href={`${network.explorerUrl}/tx/${t.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                        >
                          {truncateHash(t.txHash, 10, 6)}
                        </a>
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
                  {state.manifest.storageTxHash ? (
                    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                      <span className="text-ink-quiet">0G upload</span>
                      <a
                        href={`${network.explorerUrl}/tx/${state.manifest.storageTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono tabular text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
                      >
                        {truncateHash(state.manifest.storageTxHash, 10, 6)}
                      </a>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                    <span className="text-ink-quiet">anchor tx</span>
                    <a
                      href={`${network.explorerUrl}/tx/${state.manifest.anchorTx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono tabular text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
                    >
                      {truncateAddress(state.manifest.anchorTx, 10, 6)}
                    </a>
                  </div>
                  <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                    <span className="text-ink-quiet">token URI</span>
                    <span className="font-mono tabular text-ink-soft">
                      {state.manifest.tokenUri}
                    </span>
                  </div>
                  <div className="grid grid-cols-[8rem_1fr] items-baseline gap-x-6">
                    <span className="text-ink-quiet">storage</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                      {state.manifest.storageType === "0g" ? "0G Storage" : "local hash"}
                    </span>
                  </div>
                </div>
              ) : null}
            </PhaseRow>
          );
        })}
      </section>

      {state.summary?.ok ? (
        <section className="space-y-5 border-l-2 border-sage pl-6">
          <p className="eyebrow text-sage">what just happened</p>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-6 border-t border-rule divide-y divide-rule">
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">subject</dt>
            <dd className="pt-3 font-mono tabular text-ink">
              {state.summary.subject ? (
                <Link href={`/agent/${state.summary.subject}`} className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 hover:decoration-terra">
                  {truncateAddress(state.summary.subject, 6, 4)}
                </Link>
              ) : (
                "unknown"
              )}
            </dd>
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">token</dt>
            <dd className="pt-3 font-mono tabular text-ink">
              #{state.summary.tokenId ?? "?"} · {state.summary.minted ? "minted" : "found"}
            </dd>
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">reasoning</dt>
            <dd className="pt-3 font-mono tabular text-ink">
              {state.summary.model ?? "—"} · {state.summary.source === "0g" ? "0G Compute · TEE-verified" : "local keyword match"}
            </dd>
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">capabilities</dt>
            <dd className="pt-3 font-mono tabular text-ink">
              {state.capabilities.length} required · {state.capabilities.filter((c) => c.capable).length} held · {state.txs.length} self-issued
            </dd>
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">gated</dt>
            <dd className="pt-3 font-mono tabular text-ink">{state.summary.gated ? "yes" : "no"}</dd>
            {state.manifest ? (
              <>
                <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">evidence</dt>
                <dd className="pt-3 font-mono tabular text-ink">
                  {state.manifest.storageType === "0g" ? "0G Storage" : "local hash"} · root {truncateHash(state.manifest.rootHash, 10, 6)}
                </dd>
              </>
            ) : null}
            <dt className="pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-quiet">txs</dt>
            <dd className="pt-3 font-mono tabular text-ink">
              {state.txs.length + (state.manifest?.storageTxHash ? 1 : 0) + 1} on-chain
            </dd>
          </dl>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <button
              type="button"
              onClick={copyAsProof}
              className="font-mono text-[11px] tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
            >
              {copied ? "✓ copied to clipboard" : "copy as proof"}
            </button>
            {state.summary.live && state.summary.subject ? (
              <>
                <Link
                  href={`/agent/${state.summary.subject}`}
                  className="font-mono text-[11px] tabular text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
                >
                  View agent profile →
                </Link>
                <a
                  href={`${network.explorerUrl}/address/${state.summary.subject}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] tabular text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
                >
                  On PharosScan ↗
                </a>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
            <span className={`font-mono tabular ${state.summary.live ? "text-sage" : "text-ink-quiet"}`}>
              {state.summary.live ? "● live on-chain" : "○ simulated"}
            </span>
            {state.summary.gated !== undefined ? (
              <span className="font-mono tabular text-ink-soft">
                gated: {state.summary.gated ? "yes" : "no"}
              </span>
            ) : null}
            {state.summary.rpcCalls !== undefined && state.summary.rpcCalls > 0 ? (
              <span className="font-mono tabular text-ink-soft">
                {state.summary.rpcCalls} RPC calls
              </span>
            ) : null}
            {state.summary.tokenId ? (
              <span className="font-mono tabular text-ink-soft">
                token #{state.summary.tokenId}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {state.error ? (
        <section className="space-y-3">
          <p className="eyebrow">error</p>
          <Rule />
          <p className="font-serif text-base italic text-revoke">{state.error}</p>
        </section>
      ) : null}

      {/* Developer chrome — CLI commands + raw event stream, both
          collapsed by default so the post-run page stays focused on
          the summary and phase output above. */}
      <section className="space-y-6 border-t border-rule pt-8">
        <p className="eyebrow text-ink-quiet">for developers</p>

        <div className="space-y-4">
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
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowEvents((v) => !v)}
            className="eyebrow flex items-baseline gap-3 text-ink-soft transition-colors hover:text-ink"
          >
            <span>{showEvents ? "▾" : "▸"}</span>
            <span>Raw event stream</span>
            {eventCount > 0 ? (
              <span className="font-mono text-[10px] tabular text-ink-quiet">
                {eventCount} events
              </span>
            ) : null}
          </button>
          {showEvents ? (
            <pre className="max-h-72 overflow-auto bg-paper-deep px-5 py-4 font-mono text-[11px] leading-relaxed tabular text-ink">
              {eventCount === 0 ? "// Run the loop to populate the stream." : jsonPanel}
            </pre>
          ) : null}
        </div>
      </section>
    </div>
  );
}

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
