import "server-only";

// Structurally matches A's shared contract without depending on A's branch.
export type NansenEvidence = {
  source: "nansen";
  status: "positive" | "negative" | "unknown" | "unavailable";
  reason: string;
  observedAt: string;
  chainId?: number;
  reference?: string;
  limitations: string[];
  taxonomy?: { label: string; category: string; kind: string[] }[];
};

export type NansenOptions = {
  enabled?: boolean;
  apiKey?: string;
  chainId?: number;
  /** Server/operator configuration only. Never read this from merchant text.
   * Official docs name "monad" but do not identify its chain ID. */
  confirmedMonadChainId?: number;
  timeoutMs?: number;
  transport?: typeof fetch;
  now?: () => Date;
};

export const NANSEN_LABELS_URL =
  "https://api.nansen.ai/api/v1/profiler/address/labels";

export async function readNansenEvidence(
  payee: string,
  options: NansenOptions = {},
): Promise<NansenEvidence> {
  const evidence = (
    reason: string,
    status: NansenEvidence["status"] = "unavailable",
  ): NansenEvidence => ({
    source: "nansen",
    status,
    reason,
    observedAt: (options.now?.() ?? new Date()).toISOString(),
    ...(Number.isSafeInteger(options.chainId)
      ? { chainId: options.chainId }
      : {}),
    reference: "https://docs.nansen.ai/api/profiler/address-labels",
    limitations: [
      "Labels are provider taxonomy, not safety, KYC, permission, or a gate verdict.",
      "Observation time is retrieval time; the provider gives no label observation timestamp.",
      "One chain-scoped page only; coverage and label freshness are not guaranteed.",
    ],
  });
  if (options.enabled !== true) return evidence("nansen-disabled");
  if (!options.apiKey) return evidence("nansen-missing-key");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payee))
    return evidence("nansen-invalid-payee", "unknown");
  if (
    !Number.isSafeInteger(options.chainId) ||
    !Number.isSafeInteger(options.confirmedMonadChainId)
  )
    return evidence("nansen-chain-unconfirmed", "unknown");
  if (
    options.chainId !== options.confirmedMonadChainId ||
    ![143, 10143].includes(options.chainId!)
  )
    return evidence("nansen-wrong-chain", "unknown");
  const controller = new AbortController();
  const timeout = Math.min(10_000, Math.max(1, options.timeoutMs ?? 2_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race also bounds injected transports that ignore AbortSignal.
    const response = await Promise.race([
      (options.transport ?? fetch)(NANSEN_LABELS_URL, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: { apikey: options.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          address: payee.toLowerCase(),
          chain: "monad",
          pagination: { page: 1, per_page: 100 },
        }),
        signal: controller.signal,
      }).then(async (res) => {
        if (!res.ok) return { status: res.status, body: null };
        // Bound streaming responses without trusting Content-Length.
        const reader = res.body?.getReader();
        if (!reader) return { status: 200, body: null };
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 64_000) {
            await reader.cancel();
            return { status: 200, body: null };
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return {
            status: 200,
            body: JSON.parse(new TextDecoder().decode(bytes)),
          };
        } catch {
          return { status: 200, body: null };
        }
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, timeout);
      }),
    ]);
    if (response.status === 429) return evidence("nansen-rate-limit");
    if (response.status === 401 || response.status === 403)
      return evidence("nansen-access-denied");
    if (response.status === 404)
      return evidence("nansen-no-coverage", "unknown");
    if (response.status !== 200) return evidence("nansen-provider-error");
    const body = response.body;
    if (
      !body ||
      !Array.isArray(body.data) ||
      body.data.length > 100 ||
      !body.data.every(
        (row: unknown) =>
          row !== null &&
          typeof row === "object" &&
          typeof (row as Record<string, unknown>).label === "string" &&
          (row as { label: string }).label.length <= 256 &&
          typeof (row as Record<string, unknown>).category === "string" &&
          (row as { category: string }).category.length <= 64 &&
          Array.isArray((row as Record<string, unknown>).kind) &&
          (row as { kind: unknown[] }).kind.length <= 16 &&
          (row as { kind: unknown[] }).kind.every(
            (kind) => typeof kind === "string" && kind.length <= 64,
          ),
      )
    )
      return evidence("nansen-malformed-data");
    if (body.data.length === 0)
      return evidence("nansen-no-coverage", "unknown");
    // No documented risk-flag enum exists in this endpoint's contract.
    // Never infer negative/positive from free-form names or behavioral labels.
    return {
      ...evidence("nansen-labels-not-risk-verdict", "unknown"),
      taxonomy: body.data.map(
        (row: { label: string; category: string; kind: string[] }) => ({
          label: row.label,
          category: row.category,
          kind: [...row.kind],
        }),
      ),
    };
  } catch {
    return evidence(
      controller.signal.aborted ? "nansen-timeout" : "nansen-provider-error",
    );
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
