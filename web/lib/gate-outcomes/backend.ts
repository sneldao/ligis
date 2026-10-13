import "server-only";
import type { DecisionRecord } from "./schema";

export const RECORD_TTL_SECONDS = 86_400;
export const PROOF_TTL_SECONDS = 7 * RECORD_TTL_SECONDS;
export const MAX_WRITES_PER_HOUR = 100;
export const MAX_ATTEMPTS_PER_HOUR = 200;
export type AtomicResult = "stored" | "conflict" | "proof-used" | "limited";
export type AtomicWrite = {
  record: DecisionRecord;
  /** Exact serialized snapshot, or null for NX creation. */
  expected: string | null;
  proofKey?: string;
};
export interface OutcomeBackend {
  admit(tenantHash: string): Promise<boolean>;
  read(id: string): Promise<string | null>;
  atomic(write: AtomicWrite): Promise<AtomicResult>;
}

// All keys are isolated from the aggregate counter hash. Hash tag keeps EVAL
// keys in one slot on clustered Redis. No raw identifiers in key names.
const PREFIX = "ligis:{gate-outcomes-v1}:";
export const OUTCOME_ADMISSION_LUA = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
if count == 0 then redis.call('EXPIRE', KEYS[1], 3600) end
return 1
`;
export const OUTCOME_ATOMIC_LUA = `
local old = redis.call('GET', KEYS[1])
if ARGV[1] == '' then
  if old then return 'conflict' end
else
  if old ~= ARGV[1] then return 'conflict' end
end
if KEYS[3] ~= KEYS[1] then
  local owner = redis.call('GET', KEYS[3])
  if owner and owner ~= ARGV[4] then return 'proof-used' end
end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= tonumber(ARGV[5]) then return 'limited' end
redis.call('INCR', KEYS[2])
if count == 0 then redis.call('EXPIRE', KEYS[2], 3600) end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
if KEYS[3] ~= KEYS[1] then
  redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[6])
end
return 'stored'
`;

export class UpstashOutcomeBackend implements OutcomeBackend {
  constructor(
    private url: string,
    private token: string,
    private transport: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw Error("invalid-backend-config");
  }
  private async command(args: (string | number)[]): Promise<unknown> {
    const response = await this.transport(this.url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw Error("backend-unavailable");
    const body = await response.json();
    if (!body || body.error || !Object.hasOwn(body, "result"))
      throw Error("backend-unavailable");
    return body.result;
  }
  async read(id: string): Promise<string | null> {
    const value = await this.command(["GET", PREFIX + "decision:" + id]);
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 12_000)
      throw Error("backend-invalid");
    return value;
  }
  async admit(tenantHash: string): Promise<boolean> {
    const result = await this.command([
      "EVAL",
      OUTCOME_ADMISSION_LUA,
      1,
      PREFIX + "attempt:" + tenantHash,
      MAX_ATTEMPTS_PER_HOUR,
    ]);
    if (result !== 0 && result !== 1) throw Error("backend-unavailable");
    return result === 1;
  }
  async atomic(write: AtomicWrite): Promise<AtomicResult> {
    const ttl = Math.ceil((write.record.expiresAt - this.now()) / 1000);
    if (ttl <= 0 || ttl > RECORD_TTL_SECONDS) throw Error("expired-record");
    const key = PREFIX + "decision:" + write.record.id;
    const value = JSON.stringify(write.record);
    if (value.length > 12_000) throw Error("oversized-record");
    const result = await this.command([
      "EVAL",
      OUTCOME_ATOMIC_LUA,
      3,
      key,
      PREFIX + "quota:" + write.record.tenantHash,
      write.proofKey ? PREFIX + "proof:" + write.proofKey : key,
      write.expected ?? "",
      value,
      ttl,
      write.record.id,
      MAX_WRITES_PER_HOUR,
      PROOF_TTL_SECONDS,
    ]);
    if (
      !["stored", "conflict", "proof-used", "limited"].includes(
        result as string,
      )
    )
      throw Error("backend-unavailable");
    return result as AtomicResult;
  }
}

/** Deterministic test backend only, never selected by runtime configuration. */
export class MemoryOutcomeBackend implements OutcomeBackend {
  readonly records = new Map<string, string>();
  readonly proofs = new Map<string, { id: string; until: number }>();
  private quota = new Map<string, { count: number; until: number }>();
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private now: () => number = Date.now) {}
  async admit(tenantHash: string) {
    const old = this.attempts.get(tenantHash);
    const current =
      old && old.until > this.now()
        ? old
        : { count: 0, until: this.now() + 3600_000 };
    if (current.count >= MAX_ATTEMPTS_PER_HOUR) return false;
    current.count++;
    this.attempts.set(tenantHash, current);
    return true;
  }
  async read(id: string) {
    const value = this.records.get(id);
    if (!value) return null;
    if ((JSON.parse(value) as DecisionRecord).expiresAt <= this.now()) {
      this.records.delete(id);
      return null;
    }
    return value;
  }
  async atomic(write: AtomicWrite): Promise<AtomicResult> {
    // No await between compare and mutate, matching atomic EVAL.
    const raw = this.records.get(write.record.id);
    const old =
      raw && (JSON.parse(raw) as DecisionRecord).expiresAt > this.now()
        ? raw
        : null;
    if (old !== write.expected) return "conflict";
    const claim = write.proofKey && this.proofs.get(write.proofKey);
    if (claim && claim.until > this.now() && claim.id !== write.record.id)
      return "proof-used";
    const quota = this.quota.get(write.record.tenantHash);
    const current =
      quota && quota.until > this.now()
        ? quota
        : { count: 0, until: this.now() + 3600_000 };
    if (current.count >= MAX_WRITES_PER_HOUR) return "limited";
    if (
      write.record.expiresAt <= this.now() ||
      write.record.expiresAt > this.now() + RECORD_TTL_SECONDS * 1000
    )
      throw Error("expired-record");
    current.count++;
    this.quota.set(write.record.tenantHash, current);
    this.records.set(write.record.id, JSON.stringify(write.record));
    if (write.proofKey)
      this.proofs.set(write.proofKey, {
        id: write.record.id,
        until: this.now() + PROOF_TTL_SECONDS * 1000,
      });
    return "stored";
  }
}
