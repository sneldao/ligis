import "server-only";

/**
 * Operator console — live read of the running Trust Gate.
 *
 * The gate (packages/x402-server) is the single source of truth for firewall
 * state; this module only fetches its public endpoints (`/` and `/health`)
 * and shapes them for the console. No config is duplicated server-side —
 * what the operator sees is exactly what the running gate reports.
 *
 * Degrades the same way the web tier does everywhere: unreachable gate →
 * `{ online: false }`, never a crash and never a stale "online".
 */

const GATE_TIMEOUT_MS = 3000;

export type GateStatus =
  | {
      online: true;
      gateUrl: string;
      service: string;
      capability: string;
      chain: string;
      endpoint: string;
      settlement: string;
      price: { smallestUnit: string; tokenSymbol: string };
      payTo: string | null;
      jev: { enabled: boolean; model?: string; enforce?: boolean };
    }
  | { online: false; gateUrl: string | null };

interface GateConfigResponse {
  service?: string;
  capability?: string;
  chain?: string;
  endpoint?: string;
  settlement?: string;
  price?: { smallestUnit?: string; tokenSymbol?: string };
  payTo?: string | null;
}

interface GateHealthResponse {
  ok?: boolean;
  settlement?: string;
  jev?: { enabled?: boolean; model?: string; enforce?: boolean };
}

export async function readGateStatus(): Promise<GateStatus> {
  const gateUrl = process.env.NEXT_PUBLIC_LIGIS_GATE_URL ?? null;
  if (!gateUrl) return { online: false, gateUrl: null };
  try {
    const [cfgRes, healthRes] = await Promise.all([
      fetch(`${gateUrl}/`, {
        cache: "no-store",
        signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
      }),
      fetch(`${gateUrl}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
      }),
    ]);
    if (!cfgRes.ok || !healthRes.ok) {
      return { online: false, gateUrl };
    }
    const cfg = (await cfgRes.json()) as GateConfigResponse;
    const health = (await healthRes.json()) as GateHealthResponse;
    return {
      online: true,
      gateUrl,
      service: cfg.service ?? "Ligis Trust Gate",
      capability: cfg.capability ?? "—",
      chain: cfg.chain ?? "—",
      endpoint: cfg.endpoint ?? "/premium",
      settlement: health.settlement ?? cfg.settlement ?? "—",
      price: {
        smallestUnit: cfg.price?.smallestUnit ?? "—",
        tokenSymbol: cfg.price?.tokenSymbol ?? "",
      },
      payTo: cfg.payTo ?? null,
      jev: {
        enabled: !!health.jev?.enabled,
        model: health.jev?.model,
        enforce: health.jev?.enforce,
      },
    };
  } catch {
    return { online: false, gateUrl };
  }
}
