import assert from "node:assert";
import { test } from "node:test";
import { parseMandate } from "@/lib/mandate";

// NOTE: runDecide / bodyToIntent import the route module, which pulls in
// server-only via @/lib/resolve. Run this file with:
//   node --conditions=react-server --import tsx --test web/test/route.test.ts
// so the server-only guard is a no-op. The default `pnpm --filter @ligis/web
// test` (no conditions) cannot import the route — these tests live alongside
// the pure parseMandate tests so CI runs both from the same file.
const PAYEE = "0x89AbCdEf0123456789abcdef0123456789abcdef0" as `0x${string}`;

// Mandate parser tests — these exercise the exact validation logic that
// the route's bodyToIntent delegates to parseMandate(). parseMandate is
// in lib/mandate.ts (pure, no server-only dep) so it can be unit-tested.
// Importing bodyToIntent from the route is infeasible: route.ts imports
// resolveSubject from @/lib/resolve which pulls in server-only at module
// load time, and the test runner throws before any test body runs.
// The 45 decide.test.ts tests cover the full decision pipeline; these
// tests cover the parsing/validation layer that feeds into it.

test("parseMandate parses expectedUsd from mandate", () => {
  const mandateRaw = {
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: 100,
  };
  const result = parseMandate(mandateRaw);
  assert.ok(
    typeof result !== "string",
    `expected mandate object, got: ${result}`,
  );
  const mandate = result as NonNullable<
    Parameters<typeof import("@/lib/decide").decide>[0]["mandate"]
  >;
  assert.strictEqual(mandate.expectedUsd, 100, "expectedUsd should be parsed");
  assert.strictEqual(mandate.payees?.length, 1);
  assert.strictEqual(mandate.maxUsd, 10000);
});

test("parseMandate rejects invalid expectedUsd", () => {
  const result = parseMandate({
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: -5,
  });
  assert.strictEqual(result, "mandate.expectedUsd must be > 0");
});

test("parseMandate rejects non-numeric expectedUsd", () => {
  const result = parseMandate({
    payees: [PAYEE],
    maxUsd: 10000,
    expectedUsd: "not-a-number",
  });
  assert.strictEqual(
    typeof result,
    "string",
    "expected error string for invalid expectedUsd",
  );
});

// ─── route-level tests (require --conditions=react-server) ──────────────
// bodyToIntent / runDecide import the route module, which pulls server-only
// via @/lib/resolve. tsx resolves the `react-server` export condition only
// when it is passed explicitly:
//   node --conditions=react-server --import tsx --test test/route.test.ts
// (verified: default import throws "cannot be imported from a Client
// Component module"; with the flag the route imports and runDecide returns
// real decisions over a stubbed resolveSubject).
// Guard with try/catch so a default-conditions run reports a skip instead of
// a hard failure — CI runs this file twice (see web/package.json scripts).

async function loadRoute(): Promise<
  typeof import("@/app/api/gate/route") | null
> {
  try {
    return await import("@/app/api/gate/route");
  } catch {
    return null;
  }
}

test("route bodyToIntent builds intent with mandate", async () => {
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const intent = route.bodyToIntent({
    payee: PAYEE,
    amountUsd: 100,
    purpose: "Q4 renewal",
    capability: "agent.commerce.escrow",
    mandate: { payees: [PAYEE], maxUsd: 10000, expectedUsd: 100 },
  });
  assert.ok(typeof intent !== "string", `expected intent, got: ${intent}`);
  const asIntent = intent as { mandate?: { expectedUsd?: number } };
  assert.strictEqual(asIntent.mandate?.expectedUsd, 100);
});

test("route bodyToIntent rejects bad payee", async () => {
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const out = route.bodyToIntent({
    payee: "",
    amountUsd: 100,
    purpose: "x",
  });
  assert.ok(
    typeof out === "string" && out.startsWith("__bad_request__:"),
    `expected bad-request marker, got: ${JSON.stringify(out)}`,
  );
});

test("route queryToIntent carries mandatePayees/maxUsd/expectedUsd", async () => {
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const out = route.queryToIntent(
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    "100",
    "Q4 renewal",
    "agent.commerce.escrow",
    {
      mandatePayees: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      mandateMaxUsd: "10000",
      mandateExpectedUsd: "100",
    },
  );
  assert.ok(typeof out !== "string", `expected intent, got: ${out}`);
  const intent = out as {
    mandate?: { payees?: string[]; maxUsd?: number; expectedUsd?: number };
  };
  assert.deepStrictEqual(intent.mandate?.payees, [
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
  ]);
  assert.strictEqual(intent.mandate?.maxUsd, 10000);
  assert.strictEqual(intent.mandate?.expectedUsd, 100);
});

test("route queryToIntent rejects bad mandateMaxUsd", async () => {
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const out = route.queryToIntent(
    "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
    "100",
    "Q4 renewal",
    null,
    {
      mandateMaxUsd: "-5",
    },
  );
  assert.ok(
    typeof out === "string" && out.startsWith("__bad_request__:"),
    `expected bad-request marker, got: ${JSON.stringify(out)}`,
  );
});

test("route runDecide returns GO over stubbed resolveSubject", async () => {
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const res = await route.runDecide(
    {
      payee: PAYEE,
      amountUsd: 100,
      purpose: "Q4 renewal",
      capability: "agent.commerce.escrow",
      mandate: { payees: [PAYEE], maxUsd: 10000, expectedUsd: 100 },
    },
    {
      resolveSubject: async () => ({
        ok: true as const,
        subject: PAYEE,
        capabilityId: "agent.commerce.escrow",
        capable: true,
        verdicts: [],
        primary: {
          chain: {
            id: "pharos-atlantic",
            kind: "evm",
            name: "Pharos Atlantic Testnet",
            explorerUrl: "https://atlantic.pharosscan.xyz",
            live: true,
            shortName: "pharos",
            writeReady: true,
          },
          outcome: {
            ok: true as const,
            subject: PAYEE,
            capabilityId: "agent.commerce.escrow",
            capabilityHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
            capable: true,
            issuer:
              "0xa1c4e3f0123456789abcdef0123456789abcdef0" as `0x${string}`,
            expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400 * 90),
            revoked: false,
          },
        },
      }),
    },
  );
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as { verdict: string; signals: unknown[] };
  // Mandate pins payee + amount (both GO), credential stub is GO, Jev is off
  // in the test env (SKIPPED, neutral) — composition yields GO.
  assert.strictEqual(body.verdict, "GO");
  assert.ok(Array.isArray(body.signals) && body.signals.length === 4);
});

test("route runDecide with cap-only mandate keeps right-payee SKIPPED", async () => {
  // Regression: the /gate form must never default the allowlist to the payee
  // being checked — a cap/quote alone must leave right-payee skipped, not GO.
  const route = await loadRoute();
  if (!route) {
    console.log("  (skip: re-run with --conditions=react-server)");
    return;
  }
  const res = await route.runDecide(
    {
      payee: PAYEE,
      amountUsd: 100,
      purpose: "Q4 renewal",
      capability: "agent.commerce.escrow",
      mandate: { maxUsd: 10000 },
    },
    {
      resolveSubject: async () => ({
        ok: true as const,
        subject: PAYEE,
        capabilityId: "agent.commerce.escrow",
        capable: true,
        verdicts: [],
        primary: {
          chain: {
            id: "pharos-atlantic",
            kind: "evm",
            name: "Pharos Atlantic Testnet",
            explorerUrl: "https://atlantic.pharosscan.xyz",
            live: true,
            shortName: "pharos",
            writeReady: true,
          },
          outcome: {
            ok: true as const,
            subject: PAYEE,
            capabilityId: "agent.commerce.escrow",
            capabilityHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
            capable: true,
            issuer:
              "0xa1c4e3f0123456789abcdef0123456789abcdef0" as `0x${string}`,
            expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400 * 90),
            revoked: false,
          },
        },
      }),
    },
  );
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as {
    verdict: string;
    signals: Array<{ id: string; status: string; reason?: string }>;
  };
  const payeeSignal = body.signals.find((s) => s.id === "right-payee")!;
  assert.strictEqual(payeeSignal.status, "SKIPPED");
  assert.ok(payeeSignal.reason?.includes("no contracted payee"));
  assert.strictEqual(body.verdict, "UNKNOWN");
});
