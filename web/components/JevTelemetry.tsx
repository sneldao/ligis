"use client";

import { useEffect, useState } from "react";
import { Rule } from "@/components/Rule";
import { truncateAddress } from "@/lib/format";

/**
 * JevTelemetry — the gate's reflexes, made visible.
 *
 * Polls the x402 Trust Gate's /verdicts ring buffer (in-memory, last 50) and
 * renders every recent gate decision as a latency-annotated row: the Jev
 * intent verdict (GO/STOP + confidence), the flags that fired, and what the
 * intent read cost. The point is the speed — visitors can see ~100ms
 * decisions land in real time.
 *
 * Reads the gate at NEXT_PUBLIC_LIGIS_GATE_URL; when the env var is unset the
 * component renders nothing and never polls.
 */

type VerdictRecord = {
  ts: string;
  status: number | null;
  subject: string;
  capability: string;
  verdict: "GO" | "STOP" | "SKIPPED";
  confidence: number;
  flags: string[];
  latencyMs: number;
  costUsd?: number;
  model?: string;
  skippedReason?: string;
};

const GATE_URL = process.env.NEXT_PUBLIC_LIGIS_GATE_URL;
const POLL_MS = 2500;
const ROWS = 10;

const VERDICT_TONE: Record<
  VerdictRecord["verdict"],
  { text: string; border: string; bar: string }
> = {
  GO: { text: "text-sage", border: "border-sage", bar: "bg-sage/70" },
  STOP: { text: "text-revoke", border: "border-revoke", bar: "bg-revoke/70" },
  SKIPPED: { text: "text-ink-quiet", border: "border-rule", bar: "bg-rule" },
};

const STATUS_TONE: Record<number, string> = {
  200: "text-sage",
  401: "text-revoke",
  402: "text-sky",
  403: "text-revoke",
};

export function JevTelemetry() {
  if (!GATE_URL) return null;
  return <JevTelemetryLive gateUrl={GATE_URL} />;
}

function JevTelemetryLive({ gateUrl }: { gateUrl: string }) {
  const [records, setRecords] = useState<VerdictRecord[]>([]);
  const [online, setOnline] = useState(false);
  const [jev, setJev] = useState<{ enabled: boolean; model?: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [vRes, hRes] = await Promise.all([
          fetch(`${gateUrl}/verdicts?limit=${ROWS}`, { cache: "no-store" }),
          fetch(`${gateUrl}/health`, { cache: "no-store" }),
        ]);
        if (!vRes.ok) throw new Error(`verdicts HTTP ${vRes.status}`);
        const v = (await vRes.json()) as { verdicts?: VerdictRecord[] };
        let health: { jev?: { enabled?: boolean; model?: string } } | null =
          null;
        try {
          health = hRes.ok
            ? ((await hRes.json()) as {
                jev?: { enabled?: boolean; model?: string };
              })
            : null;
        } catch {}
        if (cancelled) return;
        setRecords(Array.isArray(v.verdicts) ? v.verdicts : []);
        setOnline(true);
        setJev(
          health?.jev
            ? { enabled: !!health.jev.enabled, model: health.jev.model }
            : null,
        );
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gateUrl]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="eyebrow">Gate telemetry · Jev intent</p>
        <span className="font-mono text-[11px] tabular uppercase tracking-[0.16em] text-ink-quiet">
          {online
            ? jev?.enabled
              ? `live · jev ${jev.model ?? "on"}`
              : "gate live · jev off"
            : `gate offline · ${gateUrl.replace(/^https?:\/\//, "")}`}
        </span>
      </div>
      <Rule className="mt-3" />

      {!online ? (
        <p className="mt-4 font-serif text-base italic leading-relaxed text-ink-quiet">
          No gate is answering at{" "}
          <code className="font-mono not-italic text-ink-soft">{gateUrl}</code>.
          Run the Trust Gate with the intent layer on and this panel fills with
          live verdicts as payments are judged:
        </p>
      ) : records.length === 0 ? (
        <p className="mt-4 font-serif text-base italic leading-relaxed text-ink-quiet">
          Gate is live and listening — no requests judged yet. Fire one at{" "}
          <code className="font-mono not-italic text-ink-soft">/premium</code>{" "}
          and the verdict lands here in ~100ms.
        </p>
      ) : (
        <>
          <SummaryStrip records={records} jevOn={!!jev?.enabled} />
          <div className="mt-6 space-y-0">
            {records.map((r, i) => (
              <VerdictRow
                key={`${r.ts}-${i}`}
                record={r}
                maxLatency={maxLatency(records)}
              />
            ))}
          </div>
        </>
      )}

      {!online ? (
        <pre className="mt-4 overflow-x-auto bg-paper-deep px-5 py-4 font-mono text-[12px] leading-relaxed tabular text-ink">
          {`LIGIS_JEV_ENABLED=1 AI_GATEWAY_API_KEY=... pnpm x402:dev`}
        </pre>
      ) : null}
    </div>
  );
}

function maxLatency(records: VerdictRecord[]): number {
  return Math.max(1, ...records.map((r) => r.latencyMs));
}

function SummaryStrip({
  records,
  jevOn,
}: {
  records: VerdictRecord[];
  jevOn: boolean;
}) {
  const judged = records.filter((r) => r.verdict !== "SKIPPED");
  const avg = judged.length
    ? Math.round(judged.reduce((s, r) => s + r.latencyMs, 0) / judged.length)
    : 0;
  const totalCost = records.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const stops = records.filter((r) => r.verdict === "STOP").length;

  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 font-mono text-xs tabular text-ink-soft">
      <span>
        <span className="text-ink">{records.length}</span> decisions
      </span>
      {jevOn ? (
        <>
          <span>
            avg intent <span className="text-ink">{avg}ms</span>
          </span>
          <span>
            flagged{" "}
            <span className={stops > 0 ? "text-revoke" : "text-ink"}>
              {stops}
            </span>
          </span>
          <span>
            intent cost{" "}
            <span className="text-ink">${totalCost.toFixed(6)}</span>
          </span>
        </>
      ) : (
        <span className="text-ink-quiet">
          intent layer off — set LIGIS_JEV_ENABLED=1
        </span>
      )}
    </div>
  );
}

function VerdictRow({
  record,
  maxLatency,
}: {
  record: VerdictRecord;
  maxLatency: number;
}) {
  const tone = VERDICT_TONE[record.verdict];
  const width = Math.max(2, Math.round((record.latencyMs / maxLatency) * 100));
  const status = record.status;

  return (
    <div className={`border-l-2 ${tone.border} py-3 pl-5`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={`font-mono text-xs tabular ${status != null ? (STATUS_TONE[status] ?? "text-ink-quiet") : "text-ink-quiet"}`}
        >
          {status ?? "—"}
        </span>
        <span
          className={`font-mono text-[11px] tabular uppercase tracking-[0.16em] ${tone.text}`}
        >
          {record.verdict}
          {record.verdict !== "SKIPPED"
            ? ` ${(record.confidence * 100).toFixed(0)}%`
            : ""}
        </span>
        <span className="font-mono text-xs tabular text-ink-soft">
          {truncateAddress(record.subject, 8, 4)}
        </span>
        <span className="font-mono text-xs tabular text-ink-quiet">
          {record.capability}
        </span>
        {record.flags.length > 0 ? (
          <span className="font-mono text-xs tabular text-revoke/80">
            {record.flags.join(" · ")}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs tabular text-ink-quiet">
          {record.verdict === "SKIPPED" && record.skippedReason
            ? record.skippedReason
            : `$${(record.costUsd ?? 0).toFixed(6)}`}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div className="h-[3px] flex-1 bg-rule/60">
          <div
            className={`h-full ${tone.bar} transition-all duration-700 ease-out`}
            style={{ width: `${width}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-right font-mono text-xs tabular text-ink">
          {record.latencyMs}ms
        </span>
      </div>
    </div>
  );
}
