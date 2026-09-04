/**
 * Monid client for the Trust Steward.
 *
 * Wraps the Monid HTTP API (discover / inspect / run) and turns it into a
 * pay-per-call counterparty-risk resolver that the Steward can call before
 * releasing a payment to a stranger.
 */

export interface MonidConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface MonidEndpoint {
  provider: string;
  providerName: string;
  endpoint: string;
  description: string;
  price: {
    type: "PER_CALL" | "PER_RESULT";
    amount: number;
    currency: string;
  } | null;
}

export interface MonidDiscoverResult {
  query: string;
  count: number;
  results: MonidEndpoint[];
}

export interface MonidEndpointDetail {
  id: string;
  provider: string;
  endpoint: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown> };
  price?: MonidEndpoint["price"];
}

export interface MonidRun {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  result?: unknown;
  error?: string;
  cost?: { amount: number; currency: string };
  createdAt?: string;
  completedAt?: string;
}

export interface CounterpartyRiskResult {
  ok: boolean;
  counterparty: string;
  query: string;
  provider?: string;
  endpoint?: string;
  runId?: string;
  costUsd?: number;
  score?: number;
  level?: string;
  raw?: unknown;
  error?: string;
}

export interface CounterpartyRiskOpts {
  /** Natural-language query passed to `monid discover`. */
  query?: string;
  /** Pre-selected provider (skips discovery ranking). */
  provider?: string;
  /** Pre-selected endpoint. */
  endpoint?: string;
  /** Input field name to send the counterparty address in. */
  inputField?: string;
  /** Max time to wait for a run to finish, in milliseconds. */
  maxWaitMs?: number;
  /** Polling interval, in milliseconds. */
  pollMs?: number;
}

const DEFAULT_BASE_URL = "https://api.monid.ai";
const DEFAULT_POLL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 30000;

export function loadMonidConfig(): MonidConfig | null {
  const apiKey = process.env.MONID_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.MONID_BASE_URL || DEFAULT_BASE_URL,
  };
}

export class MonidClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: MonidConfig) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Monid ${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    return (await res.json()) as T;
  }

  async discover(query: string, limit = 5): Promise<MonidDiscoverResult> {
    return this.request<MonidDiscoverResult>("POST", "/v1/discover", {
      query,
      limit,
    });
  }

  async inspect(
    provider: string,
    endpoint: string,
  ): Promise<MonidEndpointDetail> {
    return this.request<MonidEndpointDetail>("POST", "/v1/inspect", {
      provider,
      endpoint,
    });
  }

  async run(
    provider: string,
    endpoint: string,
    input: unknown,
  ): Promise<MonidRun> {
    const body = await this.request<{
      id?: string;
      runId?: string;
      status?: string;
      result?: unknown;
      error?: string;
      cost?: MonidRun["cost"];
    }>("POST", "/v1/run", {
      provider,
      endpoint,
      input,
    });

    const id = body.id ?? body.runId ?? "unknown";
    return {
      id,
      status: (body.status as MonidRun["status"]) || "pending",
      result: body.result,
      error: body.error,
      cost: body.cost,
    };
  }

  async getRun(runId: string): Promise<MonidRun> {
    return this.request<MonidRun>("GET", `/v1/runs/${runId}`);
  }

  async runAndWait(
    provider: string,
    endpoint: string,
    input: unknown,
    pollMs = DEFAULT_POLL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  ): Promise<MonidRun> {
    const run = await this.run(provider, endpoint, input);
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "timeout"
    ) {
      return run;
    }

    const deadline = Date.now() + maxWaitMs;
    let last = run;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      last = await this.getRun(run.id);
      if (
        last.status === "completed" ||
        last.status === "failed" ||
        last.status === "timeout"
      ) {
        return last;
      }
    }

    return {
      ...last,
      status: "timeout",
      error: "Timed out waiting for Monid run to complete",
    };
  }
}

function inferInputField(
  schema: MonidEndpointDetail["inputSchema"],
  preferred?: string,
): string {
  if (preferred) return preferred;
  const candidates = [
    "address",
    "target",
    "wallet",
    "query",
    "id",
    "coin",
    "blockchain",
  ];
  const props = schema?.properties;
  if (props && typeof props === "object") {
    for (const c of candidates) {
      if (c in props) return c;
    }
    const first = Object.keys(props).find((k) => {
      const p = props[k] as { type?: string };
      return !p.type || p.type === "string";
    });
    if (first) return first;
  }
  return "address";
}

function extractRisk(result: unknown): { score?: number; level?: string } {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  let score: number | undefined;
  let level: string | undefined;

  for (const key of ["riskScore", "score", "risk_score"]) {
    const v = r[key];
    if (typeof v === "number") {
      score = v;
      break;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) {
        score = n;
        break;
      }
    }
  }

  for (const key of ["riskLevel", "level", "risk_level"]) {
    const v = r[key];
    if (typeof v === "string") {
      level = v.toLowerCase();
      break;
    }
  }

  return { score, level };
}

export class CounterpartyRiskResolver {
  private client: MonidClient;

  constructor(client: MonidClient) {
    this.client = client;
  }

  async resolve(
    counterparty: string,
    opts: CounterpartyRiskOpts = {},
  ): Promise<CounterpartyRiskResult> {
    const query =
      opts.query ??
      process.env.MONID_RISK_QUERY ??
      `crypto counterparty risk for ${counterparty}`;

    let provider = opts.provider ?? process.env.MONID_RISK_PROVIDER;
    let endpoint = opts.endpoint ?? process.env.MONID_RISK_ENDPOINT;
    let discovered: MonidEndpoint[] = [];

    try {
      const discoverRes = await this.client.discover(query);
      discovered = discoverRes.results;

      if (!provider || !endpoint) {
        const pick = discoverRes.results[0];
        if (!pick) {
          return {
            ok: false,
            counterparty,
            query,
            error: `No Monid endpoints discovered for "${query}"`,
          };
        }
        provider = pick.provider;
        endpoint = pick.endpoint;
      }
    } catch (e) {
      return {
        ok: false,
        counterparty,
        query,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    try {
      const detail = await this.client.inspect(provider, endpoint);
      const inputField = inferInputField(
        detail.inputSchema,
        opts.inputField ?? process.env.MONID_RISK_INPUT_FIELD,
      );
      const input: Record<string, string> = { [inputField]: counterparty };

      // Some risk endpoints need a chain identifier alongside the address.
      if (
        detail.inputSchema?.properties &&
        "chain" in detail.inputSchema.properties &&
        !input.chain
      ) {
        input.chain = "ethereum";
      }
      if (
        detail.inputSchema?.properties &&
        "blockchain" in detail.inputSchema.properties &&
        !input.blockchain
      ) {
        input.blockchain = "ethereum";
      }

      const run = await this.client.runAndWait(
        provider,
        endpoint,
        input,
        opts.pollMs,
        opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      );

      const { score, level } = extractRisk(run.result);
      const ok = run.status === "completed" && !run.error;

      return {
        ok,
        counterparty,
        query,
        provider,
        endpoint,
        runId: run.id,
        costUsd: run.cost?.amount,
        score,
        level,
        raw: run.result,
        error: run.error,
      };
    } catch (e) {
      return {
        ok: false,
        counterparty,
        query,
        provider,
        endpoint,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
