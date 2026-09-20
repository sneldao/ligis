/**
 * Jev stub upstream — a stand-in for api.typesafe.ai/v1/systemone.
 *
 * Lets you run the full gate → intent → telemetry loop BEFORE you have a
 * TypeSafe early-access key. It reads the state the gate actually sends and
 * judges what code can judge deterministically (amount vs gate price), while
 * returning fixed confident answers for the fuzzy questions. Clearly labeled
 * as `jev-stub-1.0` in the model field so stub verdicts are never mistaken
 * for real ones.
 *
 * Run:
 *   npx tsx scripts/jev-stub.ts          # listens on :4099
 *
 * Then point the gate at it (any non-empty key works — the URL override is
 * what routes to the stub):
 *   LIGIS_JEV_ENABLED=1 AI_GATEWAY_API_KEY=stub \
 *   LIGIS_JEV_API_URL=http://localhost:4099/v1/systemone pnpm x402:dev
 */

import { createServer } from "node:http";

const PORT = Number(process.env.JEV_STUB_PORT ?? 4099);

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let state: any = {};
    try {
      state = JSON.parse(body)?.state ?? {};
    } catch {
      // fall through with empty state
    }

    // Deterministic parts: does the claimed amount match the gate price, and
    // does the payee match the advertised one?
    const paid = state?.payment?.amount_smallest_unit;
    const asked = state?.gate_price?.amount_smallest_unit;
    let plausible = 2; // "plausible"
    if (
      typeof paid === "string" &&
      typeof asked === "string" &&
      /^\d+$/.test(paid) &&
      /^\d+$/.test(asked)
    ) {
      plausible = BigInt(paid) === BigInt(asked) ? 2 : 0;
    }
    const payTo = state?.payment?.pay_to;
    const advertised = state?.advertised_pay_to;
    const payeeNoul =
      typeof payTo === "string" &&
      typeof advertised === "string" &&
      payTo !== advertised
        ? 0.05
        : 0.96;

    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        model: "jev-stub-1.0",
        answers: {
          scope: {
            type: "choice",
            choice: "consistent",
            probabilities: { consistent: 0.95 },
            confidence: 0.93,
          },
          amount_plausibility: {
            type: "score",
            score: plausible,
            legend: {},
            probabilities: {},
            confidence: 0.9,
          },
          payee_consistency: { type: "noul", noul: payeeNoul },
          request_normality: { type: "noul", noul: 0.92 },
        },
        usage: { input_tokens: 480, output_tokens: 0 },
      }),
    );
  });
}).listen(PORT, () => {
  console.log(
    `jev stub upstream on :${PORT} (model: jev-stub-1.0 — not real Jev)`,
  );
});
