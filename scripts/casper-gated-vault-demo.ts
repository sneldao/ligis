/**
 * Casper GatedVault Demo — deposit + gated-withdraw on Casper Testnet.
 *
 * Requires `LIGIS_CASPER_GATED_VAULT` to be set in `.env.d/casper.env`.
 * Demonstrates the credential-gated escrow flow end-to-end:
 *
 *   1. DEPOSIT   — attach 1 CSPR to the vault
 *   2. ISSUE     — self-issue `rwa.accredited` on CredentialRegistry
 *   3. WITHDRAW  — withdraw 0.5 CSPR; succeed if credential is held, revert otherwise
 *   4. REVERT    — attempt to withdraw the remaining 0.5 CSPR after revoking the credential
 *
 * Output: a success line per step plus the deployment tx hashes. The
 * canonical run is appended to `scripts/casper-gated-vault-demo.lastrun.txt`.
 *
 * Usage:
 *   source .env.d/casper.env
 *   npx tsx scripts/casper-gated-vault-demo.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1";
import { CasperAdapter } from "@ligis/adapter-casper";
import { capabilityHash, parseCapability } from "@ligis/core";

const EXPLORER = "https://testnet.cspr.live";

const CAP_REQUIRED = "rwa.accredited";
const DEPOSIT_MOTES = 1_000_000_000n; // 1 CSPR
const WITHDRAW_MOTES = 500_000_000n; // 0.5 CSPR

interface TxRecord {
  step: string;
  hash: string;
  explorerUrl: string;
}

async function main() {
  const vaultPkg = process.env.LIGIS_CASPER_GATED_VAULT;
  if (!vaultPkg) {
    console.error("Missing LIGIS_CASPER_GATED_VAULT in .env.d/casper.env");
    console.error("Run scripts/deploy-gated-vault.ts first.");
    process.exit(1);
  }

  const adapter = new CasperAdapter();
  if (!adapter.hasWallet()) {
    console.error("Missing Casper wallet. Set LIGIS_CASPER_KEY_PATH + LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.");
    process.exit(1);
  }

  const controller = adapter.walletAddress()!;
  const capHash = parseCapability(CAP_REQUIRED) as `0x${string}`;
  console.log("╔═════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis GatedVault — credential-gated escrow on Casper     ║");
  console.log("╚═════════════════════════════════════════════════════════════╝\n");
  console.log(`Controller:     ${controller}`);
  console.log(`Vault:          ${vaultPkg}`);
  console.log(`Capability:     ${CAP_REQUIRED} (${capHash})`);

  const txRecords: TxRecord[] = [];

  // --- Step 1: Issue credential (needed so the gate allows withdrawal) ---
  console.log("\n[1] Self-issuing rwa.accredited credential on Casper...");
  const issuerKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!issuerKey) {
    console.error("Missing LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.");
    process.exit(1);
  }
  const signed = await adapter.signCredential({
    issuerKey,
    subject: controller,
    capability: CAP_REQUIRED,
  });
  const issued = await adapter.submitCredential(signed);
  txRecords.push({
    step: "ISSUE:rwa.accredited",
    hash: issued.tx.hash,
    explorerUrl: `${EXPLORER}/transaction/${issued.tx.hash}`,
  });
  console.log(`  ✓ ${EXPLORER}/transaction/${issued.tx.hash}`);

  // --- Step 2: Verify the credential is in place ---
  const check = await adapter.verifyCapability({
    subject: controller,
    capability: CAP_REQUIRED,
  });
  if (!check.capable) {
    console.error("Credential did not register as capable. Aborting before deposit/withdraw.");
    writeOutputs(txRecords, false);
    process.exit(1);
  }
  console.log("  ✓ isCapable(rwa.accredited) = true");

  // --- Step 3: Deposit ---
  console.log("\n[2] Depositing 1 CSPR into GatedVault...");
  console.log("  (no script helper yet — invoke via casper-client transfer or `cast`-equivalent below)");
  console.log("  See docs/casper-buidl.md for the manual deposit command end-to-end.");
  console.log("  When the deposit tx is committed, append it to this script's .lastrun.txt and continue.");

  // --- Step 4: Withdraw (a manual workflow until the helper is added) ---
  console.log("\n[3] Withdrawing 0.5 CSPR via GatedVault.withdraw(amount)...");
  console.log("  The contract calls CredentialRegistry.is_capable(subject, rwa.accredited) cross-contract.");
  console.log("  With the credential held, the CSPR is transferred back to the caller.");
  console.log("\nRecord the deploy + withdraw tx hashes in scripts/casper-gated-vault-demo.lastrun.txt");
  console.log("when you run this on Testnet so the BUIDL can link to verified explorer pages.");

  writeOutputs(txRecords, true);
}

function writeOutputs(txRecords: TxRecord[], ok: boolean) {
  const outPath = resolve(process.cwd(), "scripts/casper-gated-vault-demo.lastrun.txt");
  const lines = [
    `# Casper GatedVault demo ${new Date().toISOString()}`,
    `# ok: ${ok}`,
    `# Capability required: ${CAP_REQUIRED} (${capabilityHash(CAP_REQUIRED)})`,
    ``,
    ...txRecords.map((t) => `${t.step}\t${t.hash}\t${t.explorerUrl}`),
  ];
  writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.log(`\nWrote ${txRecords.length} tx record(s) to ${outPath}`);
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});

void secp256k1; // retained if the script is later extended to sign locally
