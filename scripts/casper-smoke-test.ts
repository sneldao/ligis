/**
 * Casper smoke test — full credential lifecycle in one script.
 *
 * Flow:
 *   1. Check deployer balance
 *   2. mint_self → issue an AgentId for the deployer
 *   3. signCredential → issuer signs a capability for the agent
 *   4. submitCredential → anchor the credential on-chain
 *   5. verifyCapability → read isCapable from the registry
 *   6. revokeCredential → revoke the credential
 *   7. verifyCapability → confirm revoked
 *
 * Prerequisites:
 *   - Contracts deployed (pnpm deploy:casper)
 *   - .env.d/casper.env sourced with deployer + issuer keys
 *   - Deployer wallet funded from faucet
 *
 * Usage:
 *   source .env.d/casper.env
 *   npx tsx scripts/casper-smoke-test.ts
 */
import { CasperAdapter } from "@ligis/adapter-casper";

async function main() {
  const adapter = new CasperAdapter();
  const step = (n: number, label: string) => console.log(`\n[${n}] ${label}`);

  // ---------- 0. Balance ----------
  step(0, "Checking deployer balance...");
  const bal = await adapter.getBalance();
  console.log("  Balance:", bal.displayBalance);
  if (bal.balance === "0") {
    console.error("  ✗ Deployer wallet is unfunded. Fund from https://testnet.cspr.live/tools/faucet");
    process.exit(1);
  }

  // ---------- 1. Mint AgentId ----------
  step(1, "Minting AgentId (mint_self)...");
  const issueResult = await adapter.issueAgentId({});
  console.log("  AgentId:", issueResult.agentId);
  console.log("  DID:", issueResult.did);
  console.log("  Controller:", issueResult.controller);
  console.log("  Tx:", issueResult.tx.explorerUrl);

  // ---------- 2. Sign credential ----------
  step(2, "Signing credential...");
  const issuerKey = process.env.LIGIS_CASPER_ISSUER_PRIVATE_KEY || process.env.LIGIS_CASPER_PRIVATE_KEY;
  if (!issuerKey) {
    console.error("  ✗ No issuer key. Set LIGIS_CASPER_ISSUER_PRIVATE_KEY");
    process.exit(1);
  }
  const subject = issueResult.controller;
  const capability = "agent.commerce.escrow";

  const signed = await adapter.signCredential({
    issuerKey,
    subject,
    capability,
    expiresInSeconds: 3600,
  });
  console.log("  Issuer:", signed.issuer);
  console.log("  Subject:", signed.subject);
  console.log("  Capability:", capability);
  console.log("  Nonce:", signed.nonce);
  console.log("  Signature:", signed.signature.slice(0, 20) + "...");

  // ---------- 3. Submit credential ----------
  step(3, "Submitting credential on-chain...");
  const submitResult = await adapter.submitCredential(signed);
  console.log("  Tx:", submitResult.tx.explorerUrl);

  // ---------- 4. Verify capability ----------
  step(4, "Verifying capability (should be capable)...");
  const verifyResult = await adapter.verifyCapability({
    subject,
    capability,
    issuer: signed.issuer,
  });
  console.log("  Capable:", verifyResult.capable);
  console.log("  Capability hash:", verifyResult.capabilityHash);
  if (!verifyResult.capable) {
    console.error("  ✗ Expected capable=true, got false");
    process.exit(1);
  }
  console.log("  ✓ Agent is capable!");

  // ---------- 5. Revoke credential ----------
  step(5, "Revoking credential...");
  const revokeResult = await adapter.revokeCredential({
    subject,
    capability,
    nonce: signed.nonce,
    issuerKey,
  });
  console.log("  Tx:", revokeResult.tx.explorerUrl);

  // ---------- 6. Verify revoked ----------
  step(6, "Verifying capability (should be NOT capable)...");
  const verifyAfter = await adapter.verifyCapability({
    subject,
    capability,
    issuer: signed.issuer,
  });
  console.log("  Capable:", verifyAfter.capable);
  if (verifyAfter.capable) {
    console.error("  ✗ Expected capable=false after revoke, got true");
    process.exit(1);
  }
  console.log("  ✓ Credential revoked successfully!");

  console.log("\n✅ All steps passed — Casper credential lifecycle works end-to-end.\n");
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err);
  process.exit(1);
});
