/**
 * Deploy GatedVault contract to Casper Testnet.
 *
 * Usage:
 *   set -a && source .env.d/casper.env && set +a
 *   npx tsx scripts/deploy-gated-vault.ts
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { capabilityHash } from "@ligis/core";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// CLType tags (from casper-types)
const CLTYPE_KEY = 11;
const CLTYPE_BYTE_ARRAY = 15;

// Key variant tags
const KEY_HASH = 1;

// Serialize Casper RuntimeArgs manually.
// Format: u32 LE count, then for each: u32 LE name_len, name bytes, CLValue bytes.
// CLValue = CLType bytes + u32 LE data_length + data bytes.
function serializeRuntimeArgs(args: Array<{ name: string; clType: Buffer; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const count = Buffer.alloc(4);
  count.writeUInt32LE(args.length, 0);
  parts.push(count);

  for (const { name, clType, data } of args) {
    const nameBuf = Buffer.from(name, "utf-8");
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32LE(nameBuf.length, 0);
    parts.push(nameLen, nameBuf);

    // CLValue = CLType bytes + u32 LE data_length + data
    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32LE(data.length, 0);
    parts.push(clType, dataLen, data);
  }

  return Buffer.concat(parts);
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

  console.log("Deploying GatedVault to Casper Testnet");
  console.log(`  CredentialRegistry: ${credRegHash}`);
  console.log(`  Required capability: rwa.accredited (0x${capHashHex})`);
  console.log();

  // Odra's Address serializes as Casper Key (CLType::Key, tag 11).
  // For a contract package hash: Key::Hash = 1 byte tag (0x01) + 32 bytes hash.
  const keyData = Buffer.alloc(33);
  keyData[0] = KEY_HASH; // Key::Hash variant
  Buffer.from(packageHashHex, "hex").copy(keyData, 1);

  // CLType for Key: single byte (11)
  const keyClType = Buffer.from([CLTYPE_KEY]);

  // [u8; 32] serializes as CLType::ByteArray(32): tag 15 + u32 LE (32)
  const capHashBytes = Buffer.from(capHashHex, "hex");
  const byteArrayClType = Buffer.alloc(5);
  byteArrayClType[0] = CLTYPE_BYTE_ARRAY;
  byteArrayClType.writeUInt32LE(32, 1);

  // Serialize the init args as Casper RuntimeArgs
  const serialized = serializeRuntimeArgs([
    { name: "credential_registry", clType: keyClType, data: keyData },
    { name: "required_capability", clType: byteArrayClType, data: capHashBytes },
  ]);
  const argsHex = serialized.toString("hex");

  console.log(`  Init args size: ${serialized.length} bytes`);
  console.log(`  Init args (hex): ${argsHex.slice(0, 80)}...`);
  console.log();

  const keyName = "ligis_gatedvault_v1";
  const paymentAmount = "50000000000"; // 50 CSPR max
  const argsType = `byte_array_${serialized.length}`;

  const cmd = [
    "casper-client put-deploy",
    `--node-address ${rpcUrl}`,
    `--secret-key ${keyPath}`,
    `--session-path ${wasmPath}`,
    `--chain-name ${chainName}`,
    "--gas-price 1",
    `--payment-amount ${paymentAmount}`,
    `--session-arg "odra_cfg_package_hash_key_name:string='${keyName}'"`,
    `--session-arg "odra_cfg_is_upgradable:bool='false'"`,
    `--session-arg "odra_cfg_is_upgrade:bool='false'"`,
    `--session-arg "odra_cfg_allow_key_override:bool='true'"`,
    `--session-arg "odra_cfg_create_upgrade_group:bool='false'"`,
    `--session-arg "entry_point:string='init'"`,
    `--session-arg "args:${argsType}='${argsHex}'"`,
    `--session-arg "attached_value:u512='0'"`,
    `--session-arg "amount:u512='0'"`,
  ].join(" ");

  console.log("Submitting deploy...");
  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (e: any) {
    console.error("casper-client error:");
    console.error("stdout:", e.stdout?.toString());
    console.error("stderr:", e.stderr?.toString());
    process.exit(1);
  }
  // Strip any warning banners before the JSON
  const jsonStart = output.indexOf("{");
  const jsonStr = jsonStart >= 0 ? output.slice(jsonStart) : output;
  const parsed = JSON.parse(jsonStr);
  const txHash = parsed.result?.deploy_hash ?? parsed.deploy_hash;

  console.log(`  Tx hash: ${txHash}`);
  console.log(`  Explorer: https://testnet.cspr.live/transaction/${txHash}`);
  console.log();
  console.log("Waiting for confirmation...");

  await sleep(15000);
  for (let i = 0; i < 12; i++) {
    try {
      const infoCmd = `casper-client get-deploy --node-address ${rpcUrl} ${txHash}`;
      const infoOutput = execSync(infoCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      const info = JSON.parse(infoOutput);
      const execResult = info.execution_result?.result || info.execution_results?.[0]?.result;
      if (execResult?.Success) {
        console.log("  Deploy confirmed!");
        const deployerPubKey = process.env.LIGIS_CASPER_DEPLOYER_PUBKEY;
        if (deployerPubKey) {
          try {
            const acctCmd = `casper-client query-state --node-address ${rpcUrl} --key ${deployerPubKey} --state-identifier latest`;
            const acctInfo = JSON.parse(execSync(acctCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }));
            const namedKeys = acctInfo.Account?.named_keys || acctInfo.result?.Account?.named_keys || [];
            const pkgEntry = namedKeys.find((k: any) => k.name === keyName);
            if (pkgEntry) {
              const pkgHash = `contract-package-${pkgEntry.key.replace(/^hash-/, "")}`;
              console.log(`  Package hash: ${pkgHash}`);
              console.log();
              console.log("Add to .env.d/casper.env:");
              console.log(`  LIGIS_CASPER_GATED_VAULT=${pkgHash}`);
            } else {
              console.log("  Package hash: check explorer for named keys");
              console.log(`  https://testnet.cspr.live/transaction/${txHash}`);
            }
          } catch {}
        }
        process.exit(0);
      }
      if (execResult?.Failure) {
        console.error("  Deploy FAILED:", JSON.stringify(execResult.Failure).slice(0, 500));
        process.exit(1);
      }
    } catch {}
    await sleep(10000);
  }
  console.log("  Timed out waiting for confirmation. Check explorer:");
  console.log(`  https://testnet.cspr.live/transaction/${txHash}`);
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
