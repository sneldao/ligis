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
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
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
} from "casper-js-sdk";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PAYMENT_AMOUNT = 200_000_000_000; // 200 CSPR for install

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
  const hexKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY || process.env.LIGIS_CASPER_PRIVATE_KEY;
  if (!hexKey) {
    throw new Error(
      "No deployer key. Set LIGIS_CASPER_DEPLOYER_PRIVATE_KEY or LIGIS_CASPER_PRIVATE_KEY env var.",
    );
  }
  const clean = hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey;
  return PrivateKey.fromHex(clean, KeyAlgorithm.SECP256K1);
}

/**
 * Build a TransactionV1 that installs a WASM module as session code.
 * This is how Odra contracts are deployed to Casper.
 */
function buildInstallTransaction(params: {
  chainName: string;
  privateKey: PrivateKey;
  wasmBytes: Uint8Array;
  args?: Map<string, CLValue>;
  ttlMs?: number;
  paymentAmount?: number;
}): Transaction {
  const {
    chainName,
    privateKey,
    wasmBytes,
    args = new Map(),
    ttlMs = DEFAULT_TTL_MS,
    paymentAmount = DEFAULT_PAYMENT_AMOUNT,
  } = params;

  const publicKey = privateKey.publicKey;
  const initiatorAddr = new InitiatorAddr(publicKey);
  const argsObj = new Args(args);
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
  pricingMode.paymentLimited.standardPayment = true;

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
        if (transform.transform === "WriteContractPackage" || transform.kind === "WriteContractPackage") {
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
  const { rpc, chainName, privateKey, contractName, wasmPath } = params;
  const wasmBytes = new Uint8Array(readFileSync(wasmPath));

  console.log(`  Deploying ${contractName} from ${wasmPath}...`);
  const tx = buildInstallTransaction({
    chainName,
    privateKey,
    wasmBytes,
  });

  await rpc.putTransaction(tx);
  const result = await rpc.waitForTransaction(tx, 120);
  const txHash = result.transaction?.hash?.transactionV1?.toHex() ?? "";
  const blockHeight = result.executionInfo?.blockHeight?.toString() ?? "0";
  const packageHash = extractPackageHash(result);

  console.log(`    tx: ${txHash}`);
  console.log(`    block: ${blockHeight}`);
  if (packageHash) {
    console.log(`    package hash: ${packageHash}`);
  } else {
    console.log(`    package hash: (check explorer for ${txHash})`);
  }

  return { contractName, txHash, blockHeight: blockHeight, packageHash };
}

async function main() {
  const rpcUrl = process.env.LIGIS_CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
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

  // Find the WASM files
  const wasmDir = resolve(process.cwd(), "packages/contracts-casper/wasm");
  const contracts = [
    { name: "AgentId", path: join(wasmDir, "AgentId.wasm") },
    { name: "CredentialRegistry", path: join(wasmDir, "CredentialRegistry.wasm") },
  ];

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

  const agentIdHash = results.find((r) => r.contractName === "AgentId")?.packageHash;
  const credRegHash = results.find((r) => r.contractName === "CredentialRegistry")?.packageHash;

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
