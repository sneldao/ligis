#!/usr/bin/env tsx
/**
 * Read a real shielded Zcash Testnet note and decrypt its memo.
 * This does not authenticate the memo's issuer or send a payment.
 * Public fixture keys only. Never fund these addresses with real ZEC.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ZcashChainAdapter,
  ZCASH_DEMO_CONFIRMED_TXID,
  ZCASH_DEMO_VERIFIED_SUBJECT,
  ZCASH_DEMO_VERIFIED_UIVK,
} from "../packages/core/src/index.js";
import { LightwalletdClient } from "../packages/core/src/zcash-lwd.js";

async function main(): Promise<void> {
  const endpoint =
    process.env.LIGIS_ZCASH_LWD_URL ?? "https://testnet.zec.rocks:443";
  const client = new LightwalletdClient(endpoint);
  try {
    const adapter = new ZcashChainAdapter({
      network: "zcash-testnet",
      lightClient: client,
      includeDemoFixtures: false,
    });
    const live = await adapter.readLiveAttestation({
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      viewingKey: ZCASH_DEMO_VERIFIED_UIVK,
      txid: ZCASH_DEMO_CONFIRMED_TXID,
    });
    const tip = await adapter.latestHeight();
    if (live.height <= 0 || !tip || tip < live.height) {
      throw new Error("light server did not report a mined transaction");
    }
    if (live.valueZat !== 100_000_000n) {
      throw new Error("unexpected disclosed note value");
    }
    const result = await adapter.verifyCapability({
      subject: ZCASH_DEMO_VERIFIED_SUBJECT,
      capability: "agent.commerce.escrow",
    });
    if (result.capable)
      throw new Error("unsigned memo incorrectly granted trust");
    const lines = [
      "# Zcash Testnet live selective-disclosure read",
      `timestamp: ${new Date().toISOString()}`,
      "network: zcash-testnet",
      `lightwalletd: ${endpoint}`,
      `txid: ${live.txid}`,
      `reportedMinedHeight: ${live.height}`,
      `chainTip: ${tip}`,
      `pool: ${live.pool}`,
      `disclosedAmountZat: ${live.valueZat}`,
      "disclosedAmountTAZ: 1",
      `memo: ${live.memo}`,
      `inputActionNullifier: ${live.nullifier}`,
      "issuerAuthenticated: false",
      "capabilityGrantedByMemo: false",
      "paymentBroadcastByThisRun: false",
      "chainInclusionTrust: lightwalletd (no independent SPV proof)",
      "keys: public deterministic test fixtures; no confidentiality from observers with these keys",
      "note: faucet-funded receipt, not a post-GO payment; memo issuer field is sender-controlled",
    ];
    const receipt = `${lines.join("\n")}\n`;
    writeFileSync(
      resolve(import.meta.dirname, "zcash-shielded-demo.lastrun.txt"),
      receipt,
    );
    console.log(receipt);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
