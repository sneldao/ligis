/**
 * Tests for the counter storage seam (`counters-backend.ts`).
 *
 * Pure shape tests — no KV network, no filesystem. The backend selection
 * (env → upstash vs file) is covered by construction: `resolveBackend` is
 * module-private, and `record()`/`aggregate()` call sites are unchanged.
 */
import assert from "node:assert";
import { test } from "node:test";
import { normalizeHgetall } from "@/lib/counters-backend";

test("normalizeHgetall parses flat field/value arrays", () => {
  assert.deepStrictEqual(normalizeHgetall(["api:go", "3", "api:stop", "1"]), {
    "api:go": 3,
    "api:stop": 1,
  });
});

test("normalizeHgetall drops non-numeric values and odd tails", () => {
  assert.deepStrictEqual(normalizeHgetall(["api:go", "NaN", "x"]), {});
  assert.deepStrictEqual(normalizeHgetall(["api:go", "2", "stray"]), {
    "api:go": 2,
  });
});

test("normalizeHgetall returns {} for non-arrays", () => {
  assert.deepStrictEqual(normalizeHgetall(null), {});
  assert.deepStrictEqual(normalizeHgetall({}), {});
  assert.deepStrictEqual(normalizeHgetall("api:go"), {});
});
