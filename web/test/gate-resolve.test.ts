import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSubject } from "@/lib/resolve";
import type { VerificationOutcome } from "@/lib/verify";
const PAYEE = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";
const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
const empty: VerificationOutcome = {
  ok: true,
  subject: PAYEE,
  capabilityId: "agent.commerce.escrow",
  capabilityHash: hash,
  capable: false,
  issuer: null,
  expiresAt: null,
  revoked: false,
};
test("open-world resolution confirms successful empty metadata reads on every EVM rail", async () => {
  let reads = 0;
  const r = await resolveSubject(PAYEE, "agent.commerce.escrow", {
    evidenceMode: true,
    verify: async () => empty,
    confirmCredential: async () => {
      reads++;
      return {
        issuer: ZERO,
        issuedAt: 0n,
        expiresAt: 0n,
        revoked: false,
        valid: false,
      };
    },
  });
  assert(r.ok && !r.capable);
  assert.equal(reads, r.verdicts.length);
  assert(r.verdicts.every((v) => v.outcome.ok));
});
test("metadata outages are not converted into successful empty credentials", async () => {
  const r = await resolveSubject(PAYEE, "agent.commerce.escrow", {
    evidenceMode: true,
    verify: async () => empty,
    confirmCredential: async () => {
      throw new Error("metadata unavailable");
    },
  });
  assert(!r.ok);
  assert.match(r.error, /unavailable/);
});
test("flag-off does not add confirmation RPC reads or change resolution semantics", async () => {
  const r = await resolveSubject(PAYEE, "agent.commerce.escrow", {
    evidenceMode: false,
    verify: async () => empty,
    confirmCredential: async () => {
      throw new Error("must not call");
    },
  });
  assert(r.ok && !r.capable);
});

test("a slow credential rail cannot erase a revoked result already read on another rail", async () => {
  const r = await resolveSubject(PAYEE, "agent.commerce.escrow", {
    evidenceMode: true,
    timeoutMs: 60,
    verify: async (chain) =>
      chain.id === "monad-testnet"
        ? { ...empty, revoked: true }
        : new Promise<never>(() => {}),
  });
  assert(r.ok);
  assert(r.primary.outcome.ok && r.primary.outcome.revoked);
  assert(r.verdicts.some((v) => !v.outcome.ok));
});
