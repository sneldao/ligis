import assert from "node:assert";
import { test } from "node:test";
import { parseMandate } from "@/lib/mandate";

test("parseMandate parses expectedUsd from mandate", () => {
  const mandateRaw = {
    payees: ["0x89AbCdEf0123456789abcdef0123456789abcdef0"],
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
    payees: ["0x89AbCdEf0123456789abcdef0123456789abcdef0"],
    maxUsd: 10000,
    expectedUsd: -5,
  });
  assert.strictEqual(result, "mandate.expectedUsd must be > 0");
});

test("parseMandate rejects non-numeric expectedUsd", () => {
  const result = parseMandate({
    payees: ["0x89AbCdEf0123456789abcdef0123456789abcdef0"],
    maxUsd: 10000,
    expectedUsd: "not-a-number",
  });
  assert.strictEqual(
    typeof result,
    "string",
    "expected error string for invalid expectedUsd",
  );
});
