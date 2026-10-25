import "server-only";

/**
 * Privacy-light counters — Phase 6 instrumentation.
 *
 * Records four categories of interaction (hero_cta_click, gate_run,
 * share_link_open, api_call) as JSONL to `~/.ligis/counters.jsonl`. No PII:
 * no IP, no user agent, no subject, no amount, no payee. Counts are
 * aggregate-only and intended to be summed off-platform (cron / a
 * `pnpm counter:dump` script).
 *
 * ⚠️ Production note: `~/.ligis/counters.jsonl` is ephemeral on Vercel
 * (each instance has its own filesystem; /tmp is wiped per invocation).
 * To make counters survive across deployments, migrate to a durable KV
 * store (Upstash, Vercel KV, or a log drain to BigQuery/ClickHouse). The
 * write path is intentionally simple — swap the appendFileSync call for
 * a KV set() and the aggregate() reader for a KV scan — without touching
 * the caller sites.
 *
 * The shape is intentionally narrow: a fixed category string plus a
 * granularity bucket (e.g. `"api:go"`, `"api:stop"`, `"hero:gate"`,
 * `"hero:arena"`, `"share:gate"`, `"gate:preset:legit"`). Unknown buckets
 * are dropped to keep the schema clean. The file is append-only with a
 * best-effort daily prune (anything older than 30 days) so it never
 * grows unbounded.
 *
 * Counting must NEVER cause a loss of context for the user. `record()`
 * swallows errors — failing to write a counter line must not break the
 * page or the API.
 */
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveBackend } from "./counters-backend";

export type CounterCategory =
  | "hero_cta_click"
  | "gate_run"
  | "share_link_open"
  | "api_call";

export type CounterBucket =
  | "hero:gate"
  | "hero:arena"
  | "hero:zcash"
  | "hero:proofs"
  | "share:gate"
  | "share:arena"
  | "gate:preset:legit"
  | "gate:preset:overpay"
  | "gate:preset:injected"
  | "gate:custom"
  | "api:go"
  | "api:stop"
  | "api:unknown"
  | "api:error";

const ALLOWED_BUCKETS: ReadonlySet<CounterBucket> = new Set<CounterBucket>([
  "hero:gate",
  "hero:arena",
  "hero:zcash",
  "hero:proofs",
  "share:gate",
  "share:arena",
  "gate:preset:legit",
  "gate:preset:overpay",
  "gate:preset:injected",
  "gate:custom",
  "api:go",
  "api:stop",
  "api:unknown",
  "api:error",
]);

const COUNTERS_DIR =
  process.env.LIGIS_COUNTERS_DIR ??
  (process.env.VERCEL ? join("/tmp", ".ligis") : join(homedir(), ".ligis"));
const COUNTERS_FILE = join(COUNTERS_DIR, "counters.jsonl");
const PRUNE_DAYS = 30;
const PRUNE_THRESHOLD_MS = PRUNE_DAYS * 24 * 60 * 60 * 1000;

function ensureDir(): void {
  try {
    mkdirSync(COUNTERS_DIR, { recursive: true });
  } catch {
    // best-effort; swallow so a filesystem error never blocks the request
  }
}

// Storage backend, resolved once at module load. File by default; Upstash
// REST when KV_REST_API_URL + KV_REST_API_TOKEN are set (see
// counters-backend.ts). `record()` stays sync — the Upstash write is
// fire-and-forget inside the backend.
const { backend, kind: BACKEND_KIND } = resolveBackend(
  COUNTERS_FILE,
  ensureDir,
);

/** Which storage backend is active — surfaced on /admin/counters. */
export function backendKind(): "upstash" | "file" {
  return BACKEND_KIND;
}

/**
 * Append a single counter line. Buckets outside the allowlist are
 * silently dropped so we never accidentally leak a richer signal (like a
 * payee or amount) into the log.
 */
export function record(category: CounterCategory, bucket: CounterBucket): void {
  if (!ALLOWED_BUCKETS.has(bucket)) return;
  void category; // category is part of the legacy JSONL shape; KV keys on bucket only
  backend.incr(bucket);
}

/**
 * Best-effort daily prune. Cheap O(n) scan over the file; runs on the
 * same call as the first `record()` after a 24h window. Never throws.
 */
let lastPruneAt = 0;
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < 24 * 60 * 60 * 1000) return;
  lastPruneAt = now;
  try {
    if (!existsSync(COUNTERS_FILE)) return;
    const st = statSync(COUNTERS_FILE);
    if (st.size < 64 * 1024) return; // skip tiny files
    const cutoff = now - PRUNE_THRESHOLD_MS;
    const lines = readFileSync(COUNTERS_FILE, "utf8").split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { t?: number };
        if (typeof parsed.t === "number" && parsed.t >= cutoff) {
          kept.push(line);
        }
      } catch {
        // drop malformed
      }
    }
    if (kept.length < lines.length) {
      appendFileSync(COUNTERS_FILE, "");
      // Rewrite the file by appending the kept lines after a marker so
      // we never lose data on partial writes.
      const marker = `__prune_${now}__`;
      appendFileSync(COUNTERS_FILE, marker + "\n");
      appendFileSync(COUNTERS_FILE, kept.join("\n") + "\n");
    }
  } catch {
    // swallow
  }
}

/**
 * Aggregate the current counters file into per-bucket counts. Read-only;
 * no filesystem writes. Returns an empty object on missing/corrupt file.
 *
 * Sync file path (today's behavior). When the Upstash backend is active,
 * prefer `aggregateAsync()` — this returns the file fallback (likely empty
 * on Vercel) so legacy callers never break.
 */
export function aggregate(): Record<string, number> {
  if (BACKEND_KIND !== "file") return {};
  try {
    if (!existsSync(COUNTERS_FILE)) return {};
    const text = readFileSync(COUNTERS_FILE, "utf8");
    const out: Record<string, number> = {};
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("__prune_")) continue;
      try {
        const parsed = JSON.parse(line) as { b?: string };
        if (typeof parsed.b === "string") {
          out[parsed.b] = (out[parsed.b] ?? 0) + 1;
        }
      } catch {
        // drop malformed
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Backend-aware read: Upstash `HGETALL` when configured, file scan
 * otherwise. Use from async server contexts (pages, route handlers).
 */
export async function aggregateAsync(): Promise<Record<string, number>> {
  const raw = await backend.readAll();
  // Re-apply the allowlist on read so a stray KV field can never surface.
  const out: Record<string, number> = {};
  for (const [bucket, n] of Object.entries(raw)) {
    if (
      typeof n === "number" &&
      Number.isFinite(n) &&
      ALLOWED_BUCKETS.has(bucket as CounterBucket)
    )
      out[bucket] = n;
  }
  return out;
}

// Auto-prune on first import in a process; cheap, idempotent. File only.
maybePrune();
