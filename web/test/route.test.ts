import assert from "node:assert";
import { test } from "node:test";
import { parseMandate } from "@/lib/mandate";

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
