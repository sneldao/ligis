import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readSettlementEvidence,
  type SettlementSource,
  type SettlementBinding,
} from "@/lib/payee-evidence/settlements";

const binding: SettlementBinding = {
  chainId: 10143,
  asset: "0x1111111111111111111111111111111111111111",
  payer: "0x2222222222222222222222222222222222222222",
  recipient: "0x3333333333333333333333333333333333333333",
  amountBaseUnits: 1_000_000n,
};
const tx = `0x${"ab".repeat(32)}` as `0x${string}`;
const blockHash = `0x${"cd".repeat(32)}` as `0x${string}`;
function source(extra: Partial<SettlementSource> = {}): SettlementSource {
  return {
    list: async () => [
      {
        ...binding,
        transactionHash: tx,
        facilitator: "https://facilitator.example.invalid",
        authorizationReference: "test:eip3009-auth",
      },
    ],
    verifyProvenance: async () => true,
    receipt: async () => ({
      chainId: 10143,
      transactionHash: tx,
      status: "success",
      blockNumber: 10n,
      blockHash,
      transfers: [
        {
          asset: binding.asset,
          from: binding.payer,
          to: binding.recipient,
          amount: binding.amountBaseUnits,
        },
      ],
    }),
    finalizedBlock: async () => ({ chainId: 10143, number: 12n }),
    canonicalBlockHash: async () => blockHash,
    ...extra,
  };
}
test("no verified source or USD-only context is honestly unavailable", async () => {
  assert.equal(
    (await readSettlementEvidence(binding.recipient)).status,
    "unavailable",
  );
  assert.equal(
    (await readSettlementEvidence(binding.recipient, { source: source() }))
      .status,
    "unavailable",
  );
});
test("only proven x402 provenance plus successful finalized exact binding counts as history", async () => {
  const e = await readSettlementEvidence(binding.recipient, {
    binding,
    source: source(),
  });
  assert.equal(e.status, "positive");
  assert.match(e.reason, /provenance-verified/);
  assert.match(e.limitations[0], /not independent trust/);
});
test("ordinary ERC20 transfer without facilitator/authorization provenance is not x402", async () => {
  const e = await readSettlementEvidence(binding.recipient, {
    binding,
    source: source({ verifyProvenance: async () => false }),
  });
  assert.equal(e.status, "unknown");
});
test("wrong chain, asset, payer, recipient, amount, receipt, finality and reorg do not qualify", async () => {
  const good = source();
  const receipt = await good.receipt(tx, new AbortController().signal);
  for (const extra of [
    { receipt: async () => ({ ...receipt, chainId: 143 }) },
    { receipt: async () => ({ ...receipt, status: "reverted" as const }) },
    { receipt: async () => ({ ...receipt, transactionHash: blockHash }) },
    { finalizedBlock: async () => ({ chainId: 10143, number: 9n }) },
    { canonicalBlockHash: async () => tx },
    ...[
      { asset: binding.payer },
      { from: binding.asset },
      { to: binding.asset },
      { amount: 2n },
    ].map((changes) => ({
      receipt: async () => ({
        ...receipt,
        transfers: [{ ...receipt.transfers[0], ...changes }],
      }),
    })),
  ])
    assert.equal(
      (
        await readSettlementEvidence(binding.recipient, {
          binding,
          source: source(extra),
        })
      ).status,
      "unknown",
    );
});
test("source failures and hangs return unavailable with a bounded budget", async () => {
  for (const extra of [
    {
      list: async () => {
        throw new Error("unavailable");
      },
    },
    { list: async () => new Promise<never>(() => {}) },
  ])
    assert.equal(
      (
        await readSettlementEvidence(binding.recipient, {
          binding,
          source: source(extra),
          timeoutMs: 10,
        })
      ).status,
      "unavailable",
    );
});
