/**
 * Deploy Odra contracts to Casper Testnet.
 *
 * Reads the WASM files from packages/contracts-casper/wasm/, builds a
 * TransactionV1 with session code (moduleBytes), signs with the deployer
 * key, submits, and extracts the contract package hash from the execution
 * result.
 *
 * Usage:
 *   source .env.d/casper.env
 *   npx tsx packages/adapter-casper/src/deploy.ts
 *
 * Or via the CLI:
 *   pnpm --filter @ligis/adapter-casper deploy
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import casperSdk from "casper-js-sdk";
import type {
  Hash as HashType,
  CLValue as CLValueType,
  Transaction as TransactionType,
} from "casper-js-sdk";

const {
  Args,
  CLValue,
  Duration,
  Hash,
  InitiatorAddr,
  KeyAlgorithm,
  PrivateKey,
  Timestamp,
  Transaction,
  TransactionV1,
  TransactionV1Payload,
  TransactionEntryPoint,
  TransactionEntryPointEnum,
  TransactionTarget,
  TransactionRuntime,
  SessionTarget,
  PricingMode,
  PaymentLimitedMode,
  TransactionScheduling,
  HttpHandler,
  RpcClient,
} = casperSdk;

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PAYMENT_AMOUNT = 800_000_000_000; // 50 CSPR for install (testnet)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface DeployResult {
  contractName: string;
  txHash: string;
  blockHeight: string;
  packageHash: string | null;
}

/**
 * Load the deployer's private key from env.
 */
function loadDeployerKey(): PrivateKey {
  const hexKey =
    process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ||
    process.env.LIGIS_CASPER_PRIVATE_KEY;
  if (!hexKey) {
    throw new Error(
      "No deployer key. Set LIGIS_CASPER_DEPLOYER_PRIVATE_KEY or LIGIS_CASPER_PRIVATE_KEY env var.",
    );
  }
  const clean = hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey;
  return PrivateKey.fromHex(clean, KeyAlgorithm.SECP256K1);
}

/**
 * Build a TransactionV1 that installs an Odra WASM module as session code.
 *
 * Odra contracts expect specific runtime args when installed:
 *   - odra_cfg_package_hash_key_name: name to store the package hash under
 *   - entry_point: "init" (the constructor)
 *   - args: serialized args for the init function (empty for no-arg init)
 *   - attached_value: 0
 *   - amount: 0
 */
function buildInstallTransaction(params: {
  chainName: string;
  privateKey: PrivateKey;
  wasmBytes: Uint8Array;
  contractName: string;
  ttlMs?: number;
  paymentAmount?: number;
}): TransactionType {
  const {
    chainName,
    privateKey,
    wasmBytes,
    contractName,
    ttlMs = DEFAULT_TTL_MS,
    paymentAmount = DEFAULT_PAYMENT_AMOUNT,
  } = params;

  const publicKey = privateKey.publicKey;
  const initiatorAddr = new InitiatorAddr(publicKey);

  // Odra-required runtime args for contract installation
  const odraArgs = new Map<string, CLValueType>();
  // Name under which the package hash is stored in account's named keys
  odraArgs.set(
    "odra_cfg_package_hash_key_name",
    CLValue.newCLString(`ligis_${contractName.toLowerCase()}_v5`),
  );
  // Entry point to call during install — Odra uses "init"
  odraArgs.set("entry_point", CLValue.newCLString("init"));
  // Serialized args for the init function — empty bytes for no-arg init
  odraArgs.set("args", CLValue.newCLByteArray(new Uint8Array(0)));
  // No attached value, no transfer
  odraArgs.set("attached_value", CLValue.newCLUInt512(0));
  odraArgs.set("amount", CLValue.newCLUInt512(0));
  // Odra config flags
  odraArgs.set("odra_cfg_is_upgradable", CLValue.newCLValueBool(false));
  odraArgs.set("odra_cfg_is_upgrade", CLValue.newCLValueBool(false));
  odraArgs.set("odra_cfg_allow_key_override", CLValue.newCLValueBool(true));
  odraArgs.set("odra_cfg_create_upgrade_group", CLValue.newCLValueBool(false));

  const argsObj = new Args(odraArgs);
  const ttl = new Duration(ttlMs);
  const entryPoint = new TransactionEntryPoint(TransactionEntryPointEnum.Call);
  const timestamp = new Timestamp(new Date());

  const sessionTarget = new SessionTarget();
  sessionTarget.moduleBytes = wasmBytes;
  sessionTarget.runtime = TransactionRuntime.vmCasperV1();
  sessionTarget.isInstallUpgrade = true;

  const target = new TransactionTarget(undefined, undefined, sessionTarget);

  const pricingMode = new PricingMode();
  pricingMode.paymentLimited = new PaymentLimitedMode();
  pricingMode.paymentLimited.gasPriceTolerance = 1;
  pricingMode.paymentLimited.paymentAmount = paymentAmount;
  pricingMode.paymentLimited.standardPayment = false;

  const scheduling = new TransactionScheduling();
  scheduling.standard = {};

  const payload = TransactionV1Payload.build({
    initiatorAddr,
    args: argsObj,
    ttl,
    entryPoint,
    pricingMode,
    timestamp,
    transactionTarget: target,
    scheduling,
    chainName,
  });

  const v1 = TransactionV1.makeTransactionV1(payload);
  v1.sign(privateKey);
  return Transaction.fromTransactionV1(v1);
}

/**
 * Extract the contract package hash from the execution result.
 * The Casper runtime emits a "contract_package_hash" transform in the
 * execution effects when a new contract is installed.
 */
function extractPackageHash(result: any): string | null {
  // The execution result contains transforms in the effects.
  // Look for a WriteContractPackage transform.
  try {
    const effects = result?.executionInfo?.executionResult?.effects;
    if (effects?.transforms) {
      for (const transform of effects.transforms) {
        if (
          transform.transform === "WriteContractPackage" ||
          transform.kind === "WriteContractPackage"
        ) {
          const hash = transform.key ?? transform.hash ?? transform.value;
          if (typeof hash === "string") return hash;
        }
      }
    }
    // Also check the raw JSON for contract_package_hash
    const raw = result?.rawJSON;
    if (raw) {
      const json = typeof raw === "string" ? JSON.parse(raw) : raw;
      const executionResult = json?.execution_info?.execution_result;
      if (executionResult?.Success?.effect?.transforms) {
        for (const t of executionResult.Success.effect.transforms) {
          if (t.transform === "WriteContractPackage") {
            return t.key ?? null;
          }
        }
      }
    }
  } catch {
    // Best-effort extraction — the caller can check the explorer manually.
  }
  return null;
}

async function deployContract(params: {
  rpc: RpcClient;
  chainName: string;
  privateKey: PrivateKey;
  contractName: string;
  wasmPath: string;
}): Promise<DeployResult> {
  const { chainName, contractName, wasmPath } = params;
  const rpcUrl =
    process.env.LIGIS_CASPER_RPC_URL ??
    "https://node.testnet.casper.network/rpc";
  const keyPath =
    process.env.LIGIS_CASPER_KEY_PATH ?? ".env.d/casper-deployer.pem";
  const paymentAmount = "800000000000"; // 800 CSPR max (refund for unused)
  const keyName = `ligis_${contractName.toLowerCase()}_v7`;

  console.log(`  Deploying ${contractName} from ${wasmPath}...`);

  // Use legacy put-deploy (TransactionV1 is_install_upgrade flag is not
  // recognized by the testnet node for contract installation)
  const { execSync } = await import("node:child_process");
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
    `--session-arg "args:byte_array_0=''"`,
    `--session-arg "attached_value:u512='0'"`,
    `--session-arg "amount:u512='0'"`,
  ].join(" ");

  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
  } catch (e: any) {
    console.error(`    deploy failed:`, e.stderr?.toString() ?? e.message);
    throw e;
  }

  const hashMatch = output.match(/"deploy_hash":\s*"([a-f0-9]+)"/);
  const txHash = hashMatch ? hashMatch[1] : "";
  console.log(`    tx hash: ${txHash}`);

  // Poll for confirmation
  console.log(`    polling for confirmation...`);
  let blockHeight = "0";
  let errorMessage: string | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5000);
    try {
      const pollOutput = execSync(
        `casper-client get-deploy --node-address ${rpcUrl} ${txHash} 2>&1`,
        { encoding: "utf-8", timeout: 15000 },
      );
      const blockMatch = pollOutput.match(/"block_height":\s*(\d+)/);
      if (blockMatch) {
        blockHeight = blockMatch[1];
        console.log(`    confirmed after ${(attempt + 1) * 5}s`);
        const errMatch = pollOutput.match(/"error_message":\s*"([^"]+)"/);
        if (errMatch && errMatch[1] !== "null") {
          errorMessage = errMatch[1];
          console.error(`    execution failed: ${errorMessage}`);
        }
        break;
      }
    } catch {
      // Not found yet
    }
  }

  console.log(`    tx: ${txHash}`);
  console.log(`    block: ${blockHeight}`);

  // Extract the package hash from the deployer's named keys.
  let packageHash: string | null = null;
  try {
    const publicKeyHex = privateKey.publicKey.toHex();
    const queryOutput = execSync(
      `casper-client query-global-state --node-address ${rpcUrl} --key ${publicKeyHex} 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const namedKeysMatch = queryOutput.match(/"named_keys":\s*(\[.*?\])/s);
    if (namedKeysMatch) {
      const namedKeys = JSON.parse(namedKeysMatch[1]);
      const packageEntry = namedKeys.find(
        (k: any) => k.name === keyName && k.key.startsWith("hash-"),
      );
      if (packageEntry) {
        packageHash = `contract-package-${packageEntry.key.replace(/^hash-/, "")}`;
      }
    }
  } catch (e) {
    // Package hash extraction is best-effort; fall back to empty.
  }

  if (packageHash) {
    console.log(`    package hash: ${packageHash}`);
  } else {
    console.log(`    package hash: (check explorer for ${txHash})`);
  }

  return { contractName, txHash, blockHeight, packageHash };
}

async function main() {
  const rpcUrl =
    process.env.LIGIS_CASPER_RPC_URL ??
    "https://node.testnet.casper.network/rpc";
  const chainName = process.env.LIGIS_CASPER_CHAIN_NAME ?? "casper-test";

  console.log(`Casper Testnet deployment`);
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  Chain: ${chainName}`);
  console.log();

  const privateKey = loadDeployerKey();
  const publicKey = privateKey.publicKey;
  console.log(`  Deployer: ${publicKey.toHex()}`);
  console.log();

  const handler = new HttpHandler(rpcUrl, "fetch");
  const rpc = new RpcClient(handler);

  // Find the WASM files — resolve from monorepo root
  const wasmDir = resolve(
    process.cwd(),
    "../../packages/contracts-casper/wasm",
  );
  if (!existsSync(wasmDir)) {
    // Fallback: try from repo root
    const altDir = resolve(process.cwd(), "packages/contracts-casper/wasm");
    if (existsSync(altDir)) {
      // use altDir
    } else {
      console.error(
        `Cannot find wasm directory. Tried: ${wasmDir} and ${altDir}`,
      );
      process.exit(1);
    }
  }
  const actualWasmDir = existsSync(
    resolve(process.cwd(), "packages/contracts-casper/wasm"),
  )
    ? resolve(process.cwd(), "packages/contracts-casper/wasm")
    : wasmDir;
  const allContracts = [
    { name: "AgentId", path: join(actualWasmDir, "AgentId.wasm") },
    {
      name: "CredentialRegistry",
      path: join(actualWasmDir, "CredentialRegistry.wasm"),
    },
  ];
  // Allow filtering by contract name via CLI arg
  const filter = process.argv[2];
  const contracts = filter
    ? allContracts.filter((c) => c.name === filter)
    : allContracts;

  const results: DeployResult[] = [];
  for (const contract of contracts) {
    const result = await deployContract({
      rpc,
      chainName,
      privateKey,
      contractName: contract.name,
      wasmPath: contract.path,
    });
    results.push(result);
    console.log();
  }

  // Write the package hashes to the env file
  const envPath = resolve(process.cwd(), ".env.d/casper.env");
  let envContent = "";
  try {
    envContent = readFileSync(envPath, "utf-8");
  } catch {
    // File may not exist yet
  }

  const agentIdHash = results.find(
    (r) => r.contractName === "AgentId",
  )?.packageHash;
  const credRegHash = results.find(
    (r) => r.contractName === "CredentialRegistry",
  )?.packageHash;

  const newLines: string[] = [];
  if (agentIdHash) {
    newLines.push(`LIGIS_CASPER_AGENT_ID=${agentIdHash}`);
  }
  if (credRegHash) {
    newLines.push(`LIGIS_CASPER_CREDENTIAL_REGISTRY=${credRegHash}`);
  }

  if (newLines.length > 0) {
    // Append or update the env file
    const appendContent = `\n# Contract package hashes — deployed by deploy.ts\n${newLines.join("\n")}\n`;
    if (envContent) {
      // Check if the hashes already exist and replace them
      let updated = envContent;
      for (const line of newLines) {
        const key = line.split("=")[0]!;
        if (updated.includes(`${key}=`)) {
          updated = updated.replace(new RegExp(`${key}=.*`), line);
        } else {
          updated += `\n${line}`;
        }
      }
      const { writeFileSync } = await import("node:fs");
      writeFileSync(envPath, updated, { mode: 0o600 });
    } else {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(envPath, appendContent, { mode: 0o600 });
    }
    console.log(`  Contract hashes written to ${envPath}`);
  }

  console.log();
  console.log("Deployment complete. Next steps:");
  console.log("  1. source .env.d/casper.env");
  console.log("  2. Verify the contracts on the explorer:");
  console.log("     https://testnet.cspr.live");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
