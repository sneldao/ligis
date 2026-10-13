import type { Decision } from "../../web/lib/decide";
import { prepareGatedPayment, type ExactPayment } from "./caller";

export const payment: ExactPayment = {
  chainId: 10143,
  asset: `0x${"a".repeat(40)}`,
  payer: `0x${"b".repeat(40)}`,
  payee: `0x${"c".repeat(40)}`,
  amountBaseUnits: "1000000",
  amountUsd: 1,
  purpose: "Operator-approved premium data",
  capability: "data.premium",
};
export function fixture(verdict: Decision["verdict"]): Decision {
  return {
    verdict,
    latencyMs: 0,
    provenance: ["fixture-only, no provider or chain reads"],
    signals: (
      ["right-payee", "right-amount", "in-scope", "verified-payee"] as const
    ).map((id) => ({
      id,
      status:
        verdict === "GO"
          ? "GO"
          : verdict === "STOP" && id === "right-amount"
            ? "STOP"
            : "SKIPPED",
      confidence: verdict === "UNKNOWN" ? 0 : 1,
      reason:
        verdict === "UNKNOWN"
          ? "unfamiliar payee: fixture has no evidence"
          : verdict === "STOP"
            ? "fixture policy violation"
            : "fixture allow",
    })),
  };
}
export async function demo() {
  for (const verdict of ["GO", "UNKNOWN", "STOP"] as const) {
    let executed = 0;
    const operation = prepareGatedPayment(
      payment,
      { payees: [payment.payee], maxUsd: 2 },
      async () => {
        executed++;
        return `0x${"0".repeat(64)}`; // Synthetic fixture, NOT a transaction.
      },
      {
        gateUrl: "https://fixture.invalid/api/gate",
        transport: async () => Response.json(fixture(verdict)),
      },
    );
    const result = await operation.run();
    console.log(
      JSON.stringify({ mode: "fixture-only", verdict, executed, ...result }),
    );
  }
}
