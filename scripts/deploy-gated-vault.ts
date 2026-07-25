/**
 * Deploy GatedVault contract to Casper Testnet (Casper 2.x).
 *
 * Uses `casper-client put-transaction session` (Casper 2.x TransactionV1)
 * with the `--install-upgrade` flag and separate session args for the
 * Odra constructor. The legacy `put-deploy` format also works but
 * `put-transaction session` is the recommended path for Casper 2.x.
 *
 * Usage:
 *   set -a && source .env.d/casper.env && set +a
 *   npx tsx scripts/deploy-gated-vault.ts
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { capabilityHash } from "@ligis/core";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rpcUrl = process.env.LIGIS_CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
  const chainName = process.env.LIGIS_CASPER_CHAIN_NAME ?? "casper-test";
  const keyPath = process.env.LIGIS_CASPER_KEY_PATH ?? ".env.d/casper-deployer.pem";
  const credRegHash = process.env.LIGIS_CASPER_CREDENTIAL_REGISTRY;
  const wasmPath = resolve(process.cwd(), "packages/contracts-casper/wasm/GatedVault.wasm");

  if (!credRegHash) {
    console.error("Missing LIGIS_CASPER_CREDENTIAL_REGISTRY env var");
    process.exit(1);
  }

  const packageHashHex = credRegHash.replace(/^contract-package-/, "").replace(/^hash-/, "");
  const capHashHex = capabilityHash("rwa.accredited").replace(/^0x/, "");

  console.log("Deploying GatedVault to Casper Testnet (put-transaction session + install-upgrade)");
  console.log(`  CredentialRegistry: ${credRegHash}`);
  console.log(`  Required capability: rwa.accredited (0x${capHashHex})`);
  console.log();

  const keyName = "ligis_gatedvault_v1";
  const paymentAmount = "500000000000"; // 500 CSPR — Odra contract installs need ~300+

  const args = [
    `--node-address ${rpcUrl}`,
    `--chain-name ${chainName}`,
    `--secret-key ${keyPath}`,
    `--payment-amount ${paymentAmount}`,
    `--gas-price-tolerance 1`,
    `--standard-payment true`,
    `--wasm-path ${wasmPath}`,
    `--install-upgrade`,
    `--session-arg "odra_cfg_package_hash_key_name:string='${keyName}'"`,
    `--session-arg "odra_cfg_is_upgradable:bool='false'"`,
    `--session-arg "odra_cfg_is_upgrade:bool='false'"`,
    `--session-arg "odra_cfg_allow_key_override:bool='true'"`,
    `--session-arg "odra_cfg_constructor:string='init'"`,
    `--session-arg "credential_registry:key='hash-${packageHashHex}'"`,
    `--session-arg "required_capability:byte_array_32='${capHashHex}'"`,
  ];

  console.log("Submitting deploy...");
  let output: string;
  try {
    output = execFileSync(
      "casper-client",
      ["put-transaction", "session", ...args],
      { encoding: "utf-8", shell: true, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (e: any) {
    console.error("casper-client error:");
    console.error("stdout:", e.stdout?.toString());
    console.error("stderr:", e.stderr?.toString());
    process.exit(1);
  }
  const jsonStart = output.indexOf("{");
  const jsonStr = jsonStart >= 0 ? output.slice(jsonStart) : output;
  const parsed = JSON.parse(jsonStr);
  const txHash = parsed.result?.transaction_hash?.Version1 ?? parsed.result?.deploy_hash ?? parsed.deploy_hash;

  console.log(`  Tx hash: ${txHash}`);
  console.log(`  Explorer: https://testnet.cspr.live/transaction/${txHash}`);
  console.log();
  console.log("Waiting for confirmation...");

  await sleep(15000);
  for (let i = 0; i < 30; i++) {
    try {
      const infoOutput = execFileSync(
        "casper-client",
        ["get-transaction", "--node-address", rpcUrl, txHash],
        { encoding: "utf-8", shell: true, stdio: ["pipe", "pipe", "pipe"] }
      );
      const info = JSON.parse(infoOutput);
      const execResult = info.execution_result?.result || info.execution_results?.[0]?.result;
      if (execResult?.Success) {
        console.log("  Deploy confirmed!");
        const deployerPubKey = process.env.LIGIS_CASPER_DEPLOYER_PUBKEY;
        if (deployerPubKey) {
          try {
            const acctOutput = execFileSync(
              "casper-client",
              ["query-state", "--node-address", rpcUrl, "--key", deployerPubKey, "--state-identifier", "latest"],
              { encoding: "utf-8", shell: true, stdio: ["pipe", "pipe", "pipe"] }
            );
            const acctInfo = JSON.parse(acctOutput);
            const namedKeys = acctInfo.Account?.named_keys || acctInfo.result?.Account?.named_keys || [];
            const pkgEntry = namedKeys.find((k: any) => k.name === keyName);
            if (pkgEntry) {
              const pkgHash = `contract-package-${pkgEntry.key.replace(/^hash-/, "")}`;
              console.log(`  Package hash: ${pkgHash}`);
              console.log();
              console.log("Add to .env.d/casper.env:");
              console.log(`  LIGIS_CASPER_GATED_VAULT=${pkgHash}`);
              return;
            } else {
              console.log("  Package hash not yet in named_keys; check explorer:");
              console.log(`    https://testnet.cspr.live/account/${deployerPubKey}`);
            }
          } catch (e: any) {
            console.log("  (could not query named keys:", e.message, ")");
          }
        }
        process.exit(0);
      }
      if (execResult?.Failure) {
        console.error("  Deploy FAILED:", JSON.stringify(execResult.Failure).slice(0, 800));
        process.exit(1);
      }
    } catch (e: any) {
      // 404 / not yet indexed — keep polling
    }
    await sleep(10000);
  }
  console.log("  Timed out waiting for confirmation. Check explorer:");
  console.log(`    https://testnet.cspr.live/transaction/${txHash}`);
  process.exit(1);
}

main().catch((e: any) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
