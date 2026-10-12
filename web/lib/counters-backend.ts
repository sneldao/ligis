/**
 * Counter storage backend — the seam between `record()`/`aggregate()` and
 * wherever counts live.
 *
 * Two implementations, chosen at module load:
 * - `FileBackend` — JSONL append, today's behavior. Local dev + fallback.
 * - `UpstashBackend` — Upstash/Vercel-KV REST (`HINCRBY` on write,
 *   `HGETALL` on read). Active only when `KV_REST_API_URL` and
 *   `KV_REST_API_TOKEN` are both set. Zero new deps — plain `fetch` against
 *   the REST API, fire-and-forget on write so KV latency never blocks a
 *   response.
 *
 * Key layout (single hash, per-bucket fields — no PII, ever):
 *   key    = `LIGIS_COUNTERS_KEY` (default `ligis:counters`)
 *   field  = bucket id (`api:go`, `hero:gate`, …)
 *   value  = integer count
 *
 * Privacy: fields are the fixed allowlisted bucket ids. No payee, amount,
 * IP, user agent, or subject ever reaches the backend — enforced by
 * `record()` before this module is touched.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export interface CounterBackend {
  /** Fire-and-forget increment. Must never throw. */
  incr(bucket: string): void;
  /** Read all bucket counts. Returns {} when unavailable. */
  readAll(): Promise<Record<string, number>>;
}

const COUNTERS_KEY = process.env.LIGIS_COUNTERS_KEY ?? "ligis:counters";

class FileBackend implements CounterBackend {
  constructor(
    private file: string,
    private ensureDir: () => void,
  ) {}

  incr(bucket: string): void {
    try {
      this.ensureDir();
      appendFileSync(
        this.file,
        JSON.stringify({ t: Date.now(), c: "counter", b: bucket }) + "\n",
      );
    } catch {
      // best-effort — see module docstring
    }
  }

  async readAll(): Promise<Record<string, number>> {
    try {
      if (!existsSync(this.file)) return {};
      const text = readFileSync(this.file, "utf8");
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
}

class UpstashBackend implements CounterBackend {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  incr(bucket: string): void {
    // Fire-and-forget: no await, errors swallowed. KV latency must never
    // block a gate decision or page render.
    void fetch(`${this.baseUrl}/hincrby/${COUNTERS_KEY}/${bucket}/1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
    }).catch(() => {});
  }

  async readAll(): Promise<Record<string, number>> {
    try {
      const res = await fetch(`${this.baseUrl}/hgetall/${COUNTERS_KEY}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return {};
      const body = (await res.json()) as { result?: unknown };
      return normalizeHgetall(body.result);
    } catch {
      return {};
    }
  }
}

/**
 * Upstash HGETALL returns a flat `[field, value, field, value, …]` array.
 * Coerce to per-bucket counts; drop anything non-numeric.
 */
export function normalizeHgetall(result: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(result)) return out;
  for (let i = 0; i + 1 < result.length; i += 2) {
    const field = result[i];
    const n = Number(result[i + 1]);
    if (typeof field === "string" && Number.isFinite(n)) {
      out[field] = n;
    }
  }
  return out;
}

export function resolveBackend(
  file: string,
  ensureDir: () => void,
): { backend: CounterBackend; kind: "upstash" | "file" } {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return { backend: new UpstashBackend(url, token), kind: "upstash" };
  }
  return { backend: new FileBackend(file, ensureDir), kind: "file" };
}
