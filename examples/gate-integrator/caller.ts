import type { Decision, PaymentIntent } from "../../web/lib/decide";

export type ExactPayment = Readonly<{
  chainId: number;
  asset: string;
  payer: string;
  payee: string;
  amountBaseUnits: string;
  amountUsd: number;
  purpose: string;
  capability: string;
}>;
export type OperatorPolicy = NonNullable<PaymentIntent["mandate"]>;
export type CallerOptions = {
  gateUrl: string;
  transport?: typeof fetch;
  /** Required for default fetch. Fixtures use an injected transport. */
  live?: boolean;
  gateToken?: string;
  timeoutMs?: number;
  /** Separately authorized server integration hook. Never a browser secret. */
  reportOutcome?: (txHash: string, decisionId: string) => Promise<void>;
};
const ids = ["right-payee", "right-amount", "in-scope", "verified-payee"];

export function validateDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object") return false;
  const d = value as Decision;
  return (
    ["GO", "STOP", "UNKNOWN"].includes(d.verdict) &&
    Number.isFinite(d.latencyMs) &&
    d.latencyMs >= 0 &&
    Array.isArray(d.provenance) &&
    d.provenance.length <= 32 &&
    d.provenance.every((p) => typeof p === "string" && p.length <= 500) &&
    Array.isArray(d.signals) &&
    d.signals.length === 4 &&
    d.signals.every(
      (s, i) =>
        s &&
        s.id === ids[i] &&
        ["GO", "STOP", "SKIPPED", "UNKNOWN"].includes(s.status) &&
        Number.isFinite(s.confidence) &&
        s.confidence >= 0 &&
        s.confidence <= 1,
    ) &&
    (d.verdict !== "GO" ||
      (!d.signals.some((s) => s.status === "STOP") &&
        d.signals[0].status === "GO" &&
        d.signals[1].status === "GO" &&
        d.signals[3].status === "GO"))
  );
}

/** One prepared operation, one attempt. Repeated/concurrent run() calls share
 * its promise, including failures. Retrying a payment requires reconciliation,
 * not creating another caller blindly. This is not cross-process idempotency. */
export function prepareGatedPayment(
  payment: ExactPayment,
  operatorPolicy: OperatorPolicy,
  executePayment: (exact: ExactPayment) => Promise<string>,
  options: CallerOptions,
) {
  if (!options.transport && options.live !== true)
    throw Error("live-authorization-required");
  if (options.gateToken && !/^[A-Za-z0-9_-]{32,256}$/.test(options.gateToken))
    throw Error("invalid-gate-token");
  const address = /^0x[0-9a-fA-F]{40}$/;
  if (
    !Number.isSafeInteger(payment.chainId) ||
    payment.chainId <= 0 ||
    !address.test(payment.asset) ||
    !address.test(payment.payer) ||
    !address.test(payment.payee) ||
    !/^[1-9][0-9]{0,77}$/.test(payment.amountBaseUnits) ||
    BigInt(payment.amountBaseUnits) >= 2n ** 256n ||
    !Number.isFinite(payment.amountUsd) ||
    payment.amountUsd <= 0 ||
    payment.amountUsd > 1e9 ||
    !payment.purpose ||
    payment.purpose.length > 1000 ||
    !/^[a-z0-9._-]{1,64}$/i.test(payment.capability)
  )
    throw Error("invalid-exact-payment");
  const url = new URL(options.gateUrl);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw Error("invalid-gate-url");
  // Project known fields rather than forwarding extra merchant-supplied fields.
  const exact = Object.freeze({
    chainId: payment.chainId,
    asset: payment.asset,
    payer: payment.payer,
    payee: payment.payee,
    amountBaseUnits: payment.amountBaseUnits,
    amountUsd: payment.amountUsd,
    purpose: payment.purpose,
    capability: payment.capability,
  });
  const mandate = {
    payees: operatorPolicy.payees ? [...operatorPolicy.payees] : undefined,
    maxUsd: operatorPolicy.maxUsd,
    expectedUsd: operatorPolicy.expectedUsd,
    scope: operatorPolicy.scope,
  };
  const intent: PaymentIntent = {
    payee: exact.payee,
    amountUsd: exact.amountUsd,
    purpose: exact.purpose,
    capability: exact.capability,
    mandate,
  };
  let once:
    | Promise<{ paid: boolean; reason: string; telemetry: string }>
    | undefined;
  async function runOnce() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decision: unknown;
    let decisionId: string | undefined;
    try {
      decision = await Promise.race([
        (options.transport ?? fetch)(url, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(options.gateToken
              ? { Authorization: `Bearer ${options.gateToken}` }
              : {}),
          },
          body: JSON.stringify(intent),
          signal: controller.signal,
        }).then(async (res) => {
          if (!res.ok) throw Error("http-error");
          const id = res.headers.get("X-Ligis-Decision-Id");
          if (
            options.gateToken &&
            id &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              id,
            )
          )
            decisionId = id;
          const reader = res.body?.getReader();
          if (!reader) throw Error("empty-response");
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 64_000) {
              await reader.cancel();
              throw Error("oversized-response");
            }
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(Error("timeout"));
            },
            Math.min(10_000, Math.max(1, options.timeoutMs ?? 4000)),
          );
        }),
      ]);
    } catch {
      return {
        paid: false,
        reason: "gate-failure",
        telemetry: "not-attempted",
      };
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
    if (!validateDecision(decision))
      return {
        paid: false,
        reason: "invalid-decision",
        telemetry: "not-attempted",
      };
    if (decision.verdict !== "GO")
      return {
        paid: false,
        reason: decision.verdict,
        telemetry: "not-attempted",
      };
    // Do not catch payment errors as gate/telemetry failures. Reconcile externally.
    const txHash = await executePayment(exact);
    let telemetry = "off";
    if (options.reportOutcome) {
      if (!decisionId) {
        telemetry = "not-correlated";
      } else {
        try {
          await options.reportOutcome(txHash, decisionId);
          telemetry = "reported";
        } catch {
          telemetry = "unavailable";
        }
      }
    }
    return { paid: true, reason: "GO", telemetry };
  }
  return { run: () => (once ??= runOnce()) };
}

/** Optional ingestion against D's real route. Requires a server-issued ID from
 * A's proposed authenticated decision hook, not an invented client ID. */
export async function reportAuthenticatedOutcome(options: {
  url: string;
  token: string;
  decisionId: string;
  reportId: string;
  txHash: string;
  logIndex: number;
  transport?: typeof fetch;
  live?: boolean;
}) {
  if (!options.transport && options.live !== true)
    throw Error("live-authorization-required");
  const url = new URL(options.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw Error("invalid-outcome-url");
  const res = await (options.transport ?? fetch)(url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      decisionId: options.decisionId,
      reportId: options.reportId,
      kind: "transaction",
      txHash: options.txHash,
      logIndex: options.logIndex,
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw Error("outcome-not-stored");
  const value = await res.json();
  if (value.stored !== true) throw Error("outcome-not-stored");
}
