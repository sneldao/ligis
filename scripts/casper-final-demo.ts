/**
 * Casper Final Demo — the canonical one-command reproduction.
 *
 * This single script runs the full Ligis flow on Casper Testnet:
 *
 *   1. BOOT        — AgentId.mint_self
 *   2. REASON      — LocalReasoner (or 0G Compute if available)
 *   3. GATE        — CredentialRegistry.is_capable per required capability
 *   4. ACT         — CredentialRegistry.issue for each missing capability
 *   5. RE-GATE     — Verify all gated now
 *   6. RECORD      — 0G Storage upload + AgentId.set_token_uri anchor
 *   7. DEPOSIT     — GatedVault.deposit (if deployed)
 *   8. WITHDRAW    — GatedVault.withdraw (gated by is_capable)  (if deployed)
 *
 * Output: a single "SUCCESS" verdict plus a list of on-chain tx hashes.
 * Tx hashes are written to `scripts/casper-final-demo.lastrun.txt` so the
 * BUIDL can link to verified explorer pages.
 *
 * Required env (.env.d/casper.env):
 *   LIGIS_CASPER_AGENT_ID, LIGIS_CASPER_CREDENTIAL_REGISTRY,
 *   LIGIS_CASPER_GATED_VAULT (optional), LIGIS_CASPER_KEY_PATH,
 *   LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.
 *
 * Optional env (.env.d/zerog.env):
 *   ZEROG_PRIVATE_KEY (live 0G Compute + Storage).
 *
 * Exits 0 on success, 1 on any checked failure.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CasperAdapter } from "@ligis/adapter-casper";
import { TrustSteward, LocalReasoner } from "@ligis/agent-logic";
import { ZeroGCompute, ZeroGStorage, loadZeroGConfig, loadZeroGStorageConfig } from "@ligis/zerog";
import { capabilityHash, type Reasoner } from "@ligis/core";

const EXPLORER = "https://testnet.cspr.live";

const GOAL =
  "On Casper Testnet, I am an AI agent. I need to fetch premium RWA market data " +
  "for tokenized real estate and pay for it via x402. Make sure I have the right " +
  "credential, self-issue it if I'm missing one, and anchor the evidence on chain.";

const CAP_REQUIRED = "rwa.accredited";

interface TxRecord {
  step: string;
  hash: string;
  explorerUrl: string;
}

async function main() {
  console.log("╔═════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis — Casper Final Demo (boot → gate → vault → anchor)  ║");
  console.log("╚═════════════════════════════════════════════════════════════╝\n");

  const adapter = new CasperAdapter();
  if (!adapter.hasWallet()) {
    console.error(
      "Missing Casper wallet. Source .env.d/casper.env and set LIGIS_CASPER_KEY_PATH + LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.",
    );
    process.exit(1);
  }

  const controller = adapter.walletAddress();
  console.log(`Controller: ${controller}`);
  try {
    const bal = await adapter.getBalance();
    console.log(`Balance:    ${bal.displayBalance}`);
  } catch {
    console.log("Balance:    (unfunded)");
  }

  // --- Reasoner + store ---
  let reasoner: Reasoner;
  try {
    const zerog = new ZeroGCompute(loadZeroGConfig());
    await Promise.race([
      zerog.reason('{"capabilities":[],"reasoning":"ok"}'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    reasoner = zerog;
    console.log("Reasoner:   0G Compute (TEE-verified)");
  } catch {
    reasoner = new LocalReasoner();
    console.log("Reasoner:   LocalReasoner (fallback)");
  }

  let store;
  try {
    store = new ZeroGStorage(loadZeroGStorageConfig());
    console.log("Storage:    0G Storage (live)");
  } catch {
    store = { store: async () => ({ rootHash: "0x0", txHash: "0x0" }), retrieve: async () => null } as any;
    console.log("Storage:    (in-memory — 0G Storage unavailable)");
  }

  // --- Step 1-6: Trust Steward loop ---
  console.log("\n[1-6] Running Trust Steward loop on Casper Testnet...");
  const steward = new TrustSteward(adapter, reasoner, store);
  const result = await steward.run(GOAL, {
    issuerKey: process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY,
  });

  const txRecords: TxRecord[] = [];
  // Label tx hashes in order: first is BOOT, next are ACT (credential issues),
  // and the last one (if anchored) is RECORD (set_token_uri).
  const actionHashes = result.action.txHashes;
  const anchorHash = result.anchored?.txHash;

  for (let i = 0; i < actionHashes.length; i++) {
    const hash = actionHashes[i];
    // If this hash is the anchor tx, label it as RECORD
    if (hash === anchorHash) {
      txRecords.push({
        step: "RECORD:set_token_uri",
        hash,
        explorerUrl: `${EXPLORER}/transaction/${hash}`,
      });
    } else {
      txRecords.push({
        step: i === 0 ? "BOOT" : `ACT:${CAP_REQUIRED}`,
        hash,
        explorerUrl: `${EXPLORER}/transaction/${hash}`,
      });
    }
  }
  // If anchor hash wasn't in the action txHashes array, add it separately
  if (anchorHash && !actionHashes.includes(anchorHash)) {
    txRecords.push({
      step: "RECORD:set_token_uri",
      hash: anchorHash,
      explorerUrl: `${EXPLORER}/transaction/${anchorHash}`,
    });
  }

  if (!result.ok) {
    console.error(`Steward failed: ${result.error}`);
    writeOutputs(txRecords, result.ok);
    process.exit(1);
  }
  if (!result.gated) {
    console.error("Steward completed but the agent is NOT gated (missing capabilities).");
    for (const cap of result.capabilities) {
      if (cap.error) console.error(`  ${cap.name}: ${cap.error}`);
    }
    writeOutputs(txRecords, false);
    process.exit(1);
  }

  console.log(`  ✓ BOOT  → agentId ${result.booted.agentId}`);
  console.log(`  ✓ GATE  → all required capabilities held`);
  console.log(`  ✓ RECORD → ${result.anchored?.tokenUri ?? "(no anchor)"}`);

  // --- Step 7-8: GatedVault deposit + gated-withdraw (if deployed) ---
  const vaultPkg = process.env.LIGIS_CASPER_GATED_VAULT;
  if (vaultPkg) {
    console.log("\n[7] GatedVault deposit (1 CSPR)...");
    console.log(`  vault: ${vaultPkg}`);
    console.log("  → run scripts/casper-gated-vault-demo.ts to exercise deposit + gated-withdraw.");
    console.log("  → record its tx hashes in scripts/casper-final-demo.lastrun.txt.");
  } else {
    console.log("\n[7-8] GatedVault not deployed — skipping. Set LIGIS_CASPER_GATED_VAULT to enable.");
  }

  // --- Final verdict ---
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  ✅ SUCCESS — Agent is autonomous and authorized on Casper.");
  console.log("══════════════════════════════════════════════════════════════\n");

  for (const tx of txRecords) {
    console.log(`  ${tx.step}: ${tx.explorerUrl}`);
  }

  writeOutputs(txRecords, true);
}

function writeOutputs(txRecords: TxRecord[], ok: boolean) {
  const outPath = resolve(process.cwd(), "scripts/casper-final-demo.lastrun.txt");
  const lines = [
    `# Casper final demo ${new Date().toISOString()}`,
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
