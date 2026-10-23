#!/usr/bin/env tsx
/**
 * Wallet enforcement demo — the signing boundary, exercised end to end.
 *
 * Drives the real guarded entry point (`createPaymentGuard().enforce`), not a
 * pure predicate, and shows the signer being reached exactly once on GO and
 * never on STOP, UNKNOWN, a mutated operation, or an unreachable gate.
 *
 *   npx tsx scripts/wallet-enforcement-demo.ts
 *
 * By default the gate is a local simulation — no network, no keys, no funds.
 * Point LIGIS_GATE_URL at a running gate (e.g. `pnpm dev` in web/) to assess
 * against the real decision service instead:
 *
 *   LIGIS_GATE_URL=http://127.0.0.1:3000 npx tsx scripts/wallet-enforcement-demo.ts
 *
 * Every signature here is a fixture produced by an injected signer. A local
 * signer invocation is not a settled payment.
 */
// Imported from source rather than the package name: the workspace root has no
// @ligis/* dependency, so a bare specifier would not resolve here.
import {
  createPaymentGuard,
  type AuthorizationRequest,
  type GateDecision,
  type GuardOutcome,
  type Transport,
} from "../packages/wallet-plugin/src/index.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const CHAIN = 10143;
const PAYER = "0x2222222222222222222222222222222222222222";
const PAYEE = "0x1111111111111111111111111111111111111111";
const ASSET = "0x3333333333333333333333333333333333333333";
// `now` injected into the guard is ms-epoch; authorization fields are unix seconds.
const NOW_MS = 1_760_000_000_000;
const NOW = 1_760_000_000;

const gateUrl = process.env.LIGIS_GATE_URL;
const usingLiveGate = Boolean(gateUrl);

const policy = {
  gateEndpoint: gateUrl ?? "https://gate.example",
  assets: [
    { address: ASSET, chainId: CHAIN, decimals: 6, usdPeg: 1, symbol: "USDC" },
  ],
  chains: [CHAIN],
  payees: [PAYEE],
  maxUsd: 25,
  maxValiditySeconds: 300,
  requiredCapability: null,
  gateTimeoutMs: 3000,
  minGoConfidence: 0.6,
};

type Simulation = {
  verdict: GateDecision["verdict"];
  confidence?: number;
  status?: number;
  mode?: "live";
};

let simulation: Simulation = { verdict: "GO", confidence: 0.92 };
let signerCalls = 0;

const transport: Transport = async (url, init) => {
  if (usingLiveGate) {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      redirect: init.redirect,
    });
    return { status: response.status, json: () => response.json() };
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (simulation.mode === "unreachable") throw new Error("ECONNREFUSED");
  return {
    status: simulation.status ?? 200,
    json: async () => ({
      verdict: simulation.verdict,
      signals: [
        {
          id: "verified-payee",
          status: simulation.verdict,
          confidence: simulation.confidence ?? 0.9,
          reason: "simulated",
        },
      ],
      latencyMs: 118,
      provenance: [
        simulation.mode === "live" ? "live gate" : "local simulation",
      ],
    }),
  };
};

const guard = createPaymentGuard({
  policy,
  transport,
  commandId: "ligis:pay",
  now: () => NOW_MS,
  signer: async (request) => {
    signerCalls += 1;
    return `0xfixture-signature-${signerCalls}-for-${request.message.to.slice(0, 10)}…`;
  },
});

let scenarioIndex = 0;

/** Each scenario is a distinct operation (fresh nonce) so the idempotency
 * cache cannot mask whether a refusal actually happened. */
function authorization(
  overrides: Partial<AuthorizationRequest["authorization"]> = {},
): AuthorizationRequest {
  scenarioIndex += 1;
  return {
    authorization: {
      from: PAYER,
      to: PAYEE,
      value: "5000000",
      validAfter: String(NOW - 60),
      validBefore: String(NOW + 120),
      nonce: `0x${scenarioIndex.toString(16).padStart(2, "0").repeat(32)}`,
      ...overrides,
    },
    domain: {
      name: "USDCToken",
      version: "2",
      chainId: CHAIN,
      verifyingContract: ASSET,
    },
  };
}

function report(title: string, outcome: GuardOutcome, before: number) {
  console.log(`\n${BOLD}${title}${RESET}`);
  if (outcome.ok) {
    console.log(
      `  ${GREEN}SIGNED${RESET} $${outcome.operation.amountUsd} → ${outcome.operation.payee}` +
        `\n          signer calls: ${outcome.idempotentReplay ? "0 (idempotent replay)" : "1"}`,
    );
  } else {
    console.log(`  ${RED}REFUSED${RESET} [${outcome.code}] ${outcome.reason}`);
  }
  if (signerCalls > before) {
    console.log(
      `  ${DIM}signer invoked ${signerCalls - before} time(s)${RESET}`,
    );
  }
}

async function scenario(
  title: string,
  next: Simulation,
  request: AuthorizationRequest = authorization(),
  agentRequest?: Parameters<typeof guard.enforce>[1],
) {
  simulation = next;
  const before = signerCalls;
  const outcome = await guard.enforce(request, agentRequest);
  report(title, outcome, before);
  return outcome;
}

console.log(`${BOLD}Ligis guarded payment adapter${RESET}`);
console.log(
  `${DIM}gate: ${usingLiveGate ? `live ${gateUrl}` : "local simulation (no network)"}` +
    ` · signer: injected fixture${RESET}`,
);
console.log(
  `${DIM}policy: chain ${CHAIN} · ${policy.assets[0]!.symbol} · cap $${policy.maxUsd} · window ${policy.maxValiditySeconds}s${RESET}`,
);

const firstOperation = authorization();
const go = await scenario(
  "1. Valid payment, gate returns GO",
  { verdict: "GO" },
  firstOperation,
);
if (!go.ok || signerCalls !== 1) {
  console.error(
    `\n${RED}demo invariant failed: a permitted GO must sign exactly once${RESET}`,
  );
  process.exit(1);
}

await scenario(
  "2. Same operation replayed (idempotency)",
  { verdict: "GO" },
  firstOperation,
);

await scenario("3. Gate returns STOP — HTTP 200, verdict in body", {
  verdict: "STOP",
  confidence: 1,
});

await scenario("4. Unfamiliar payee — gate returns UNKNOWN", {
  verdict: "UNKNOWN",
  confidence: 0.3,
});

await scenario(
  "5. Amount mutated after assessment",
  { verdict: "GO" },
  authorization({ value: "6000000" }),
);

await scenario(
  "6. Recipient mutated to an unlisted payee",
  { verdict: "GO" },
  authorization({
    to: "0x9999999999999999999999999999999999999999",
  }),
);

await scenario("7. Gate unreachable", { verdict: "GO", mode: "unreachable" });

await scenario("8. Gate returns HTTP 500", { verdict: "GO", status: 500 });

await scenario("9. GO below the operator confidence floor", {
  verdict: "GO",
  confidence: 0.2,
});

await scenario(
  "10. Agent mandate tries to raise the cap",
  { verdict: "GO" },
  authorization(),
  {
    mandate: { maxUsd: 10_000 },
  },
);

await scenario(
  "11. Amount above the operator cap",
  { verdict: "GO" },
  authorization({ value: "90000000" }),
);

const strictPolicy = createPaymentGuard({
  policy: { ...policy, requiredCapability: "agent.commerce.escrow" },
  transport,
  commandId: "ligis:pay",
  now: () => NOW_MS,
  signer: async () => {
    signerCalls += 1;
    return "0xfixture";
  },
});
simulation = { verdict: "GO" };
const strict = await strictPolicy.enforce(authorization());
console.log(
  `\n${BOLD}12. Operator policy requires agent.commerce.escrow${RESET}`,
);
console.log(
  strict.ok
    ? `  ${GREEN}SIGNED${RESET} capability ${policy.requiredCapability ?? "agent.commerce.escrow"} was required and the gate returned GO`
    : `  ${RED}REFUSED${RESET} [${strict.code}] ${strict.reason}`,
);

console.log(
  `\n${BOLD}total signer invocations: ${signerCalls}${RESET}` +
    `\n${DIM}a fixture signer call is not a settled payment; nothing was broadcast${RESET}`,
);
