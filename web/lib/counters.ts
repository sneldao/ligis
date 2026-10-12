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

export type CounterCategory =
  | "hero_cta_click"
  | "gate_run"
  | "share_link_open"
  | "api_call";

export type CounterBucket =
  | "hero:gate"
  | "hero:arena"
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

const COUNTERS_DIR = join(homedir(), ".ligis");
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

/**
 * Append a single counter line. Buckets outside the allowlist are
 * silently dropped so we never accidentally leak a richer signal (like a
 * payee or amount) into the log.
 */
export function record(category: CounterCategory, bucket: CounterBucket): void {
  if (!ALLOWED_BUCKETS.has(bucket)) return;
  try {
    ensureDir();
    appendFileSync(
      COUNTERS_FILE,
      JSON.stringify({ t: Date.now(), c: category, b: bucket }) + "\n",
    );
  } catch {
    // best-effort — see module docstring
  }
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
 */
export function aggregate(): Record<string, number> {
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

// Auto-prune on first import in a process; cheap, idempotent.
maybePrune();
