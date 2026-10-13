export type PayeeEvidence = {
  source: "ligis-credential" | "erc8004" | "x402-settlement" | "nansen";
  status: "positive" | "negative" | "unknown" | "unavailable";
  reason: string;
  observedAt: string;
  chainId?: number;
  reference?: string;
  limitations: string[];
};

/** Internal, server-owned context. Not an extension to the payment wire. */
export type EvidenceOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  chainId?: number;
};

export type EvidenceReader = (
  payee: string,
  options: EvidenceOptions,
) => Promise<PayeeEvidence>;

export type PayeeEvidenceReader = (
  payee: string,
  options: EvidenceOptions,
) => Promise<PayeeEvidence[]>;

export function unavailable(
  source: PayeeEvidence["source"],
  reason: string,
  chainId?: number,
): PayeeEvidence {
  return {
    source,
    status: "unavailable",
    reason,
    observedAt: new Date().toISOString(),
    chainId,
    limitations: [],
  };
}

/** Bound even injected readers that ignore abort. Never expose upstream errors. */
export async function boundedRead<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
      }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("evidence read aborted"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("evidence read timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

export function evidenceTimeout(value?: number): number {
  return Number.isFinite(value) && value! > 0
    ? Math.min(10_000, Math.max(1, value!))
    : 4_000;
}
