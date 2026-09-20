/**
 * Verdict log — in-memory ring buffer of Jev intent verdicts.
 *
 * The /verdicts endpoint serves this to the /gate telemetry panel. Memory
 * only (last 50): the gate's durable trail lives on-chain via settlement
 * txs; this buffer exists for the live demo, not for audit.
 */

export interface VerdictRecord {
  /** ISO timestamp of the request. */
  ts: string;
  /** HTTP status the gate returned (401/402/200/403), null if the request died. */
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
}

const MAX_RECORDS = 50;
const buffer: VerdictRecord[] = [];

export function recordVerdict(record: VerdictRecord): void {
  buffer.push(record);
  if (buffer.length > MAX_RECORDS) {
    buffer.splice(0, buffer.length - MAX_RECORDS);
  }
}

/** Newest first. */
export function recentVerdicts(limit = 20): VerdictRecord[] {
  const n = Number.isFinite(limit)
    ? Math.max(0, Math.min(limit, MAX_RECORDS))
    : 20;
  return buffer.slice(-n).reverse();
}
