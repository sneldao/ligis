/**
 * Casper signer — loads a secp256k1 private key from a PEM file or hex env
 * var and provides helpers for building + signing TransactionV1 payloads.
 *
 * The signer is loaded lazily per-operation so a missing key is a
 * recoverable per-call error rather than a startup failure.
 */
import { readFileSync } from "node:fs";
import casperSdk from "casper-js-sdk";
import type {
  RpcClient,
  PrivateKey as PrivateKeyType,
  PublicKey as PublicKeyType,
  Hash as HashType,
  CLValue as CLValueType,
  Transaction as TransactionType,
} from "casper-js-sdk";

const {
  Args,
  CLValue,
  Hash,
  InitiatorAddr,
  KeyAlgorithm,
  PrivateKey,
  PublicKey,
  Timestamp,
  Duration,
  Transaction,
  TransactionV1,
  TransactionV1Payload,
  TransactionEntryPoint,
  TransactionEntryPointEnum,
  TransactionTarget,
  TransactionRuntime,
  ByPackageHashInvocationTarget,
  StoredTarget,
  PricingMode,
  PaymentLimitedMode,
  TransactionScheduling,
} = casperSdk;

/** Default TTL for Casper transactions: 30 minutes. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Default gas price tolerance. */
const DEFAULT_GAS_PRICE_TOLERANCE = 1;

/** Default payment amount for session/stored calls (in motes). */
const DEFAULT_PAYMENT_AMOUNT = 100_000_000_000;

export interface Signer {
  privateKey: PrivateKeyType;
  publicKey: PublicKeyType;
  publicKeyHex: string;
  accountHash: string;
}

/**
 * Load a secp256k1 signer from env. Tries PEM file first, then hex key.
 *
 * Env vars:
 *   LIGIS_CASPER_KEY_PATH  — path to a PEM file (secret_key.pem)
 *   LIGIS_CASPER_PRIVATE_KEY — hex private key (with or without 0x prefix)
 *   PRIVATE_KEY            — fallback hex private key
 */
export function loadSigner(): Signer {
  const pemPath = process.env.LIGIS_CASPER_KEY_PATH;
  const hexKey =
    process.env.LIGIS_CASPER_PRIVATE_KEY || process.env.PRIVATE_KEY;

  let privateKey: PrivateKeyType;
  if (pemPath) {
    const pemContent = readFileSync(pemPath, "utf-8");
    privateKey = PrivateKey.fromPem(pemContent, KeyAlgorithm.SECP256K1);
  } else if (hexKey) {
    const clean = hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey;
    privateKey = PrivateKey.fromHex(clean, KeyAlgorithm.SECP256K1);
  } else {
    throw new Error(
      "Casper signer: no key configured. Set LIGIS_CASPER_KEY_PATH (PEM) or LIGIS_CASPER_PRIVATE_KEY (hex).",
    );
  }

  const publicKey = privateKey.publicKey;
  const publicKeyHex = publicKey.toHex();
  const accountHash = publicKey.accountHash().toPrefixedString();

  return { privateKey, publicKey, publicKeyHex, accountHash };
}

/**
 * Parse a package hash string into a Hash.
 * Accepts formats:
 *   - "contract-package-abc123..." (Casper explorer format)
 *   - "hash-abc123..." (legacy format)
 *   - "0xabc123..." (hex with prefix)
 *   - "abc123..." (raw hex)
 */
function parsePackageHash(hashStr: string): HashType {
  const clean = hashStr
    .replace(/^contract-package-/, "")
    .replace(/^hash-/, "")
    .replace(/^0x/, "");
  return Hash.fromHex(clean);
}

/**
 * Build a TransactionV1 that calls a stored contract by package hash,
 * using casper-client CLI for reliable serialization.
 *
 * This bypasses the casper-js-sdk's broken CJS serialization of
 * ByPackageHashInvocationTarget by using the official casper-client CLI.
 *
 * Returns the transaction hash directly (no need for separate submission).
 */
export async function callStoredContractViaCli(params: {
  chainName: string;
  signer: Signer;
  packageHash: string;
  entryPoint: string;
  args: Map<string, CLValueType>;
  ttlMs?: number;
  paymentAmount?: number;
  rpcUrl: string;
}): Promise<{ txHash: string; blockNumber: string }> {
  const {
    chainName,
    signer,
    packageHash,
    entryPoint,
    args,
    rpcUrl,
    paymentAmount = 10_000_000_000, // 10 CSPR for contract calls
  } = params;

  const keyPath = process.env.LIGIS_CASPER_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "Casper signer: LIGIS_CASPER_KEY_PATH (PEM) required for casper-client CLI",
    );
  }

  // Build casper-client session-arg strings
  const sessionArgs: string[] = [];
  for (const [name, clValue] of args) {
    const argStr = clValueToCasperClientArg(name, clValue);
    sessionArgs.push(argStr);
  }

  // Normalize package hash: convert contract-package-XXX to hash-XXX for casper-client
  const normalizedHash = packageHash
    .replace(/^contract-package-/, "hash-")
    .replace(/^0x/, "hash-");
  const finalHash = normalizedHash.startsWith("hash-")
    ? normalizedHash
    : `hash-${normalizedHash}`;

  // Build the command — use legacy put-deploy (TransactionV1 is_install_upgrade
  // flag is not recognized by the testnet node for stored contract calls)
  const cmd = [
    "casper-client put-deploy",
    `--node-address ${rpcUrl}`,
    `--secret-key ${keyPath}`,
    `--session-package-hash ${finalHash}`,
    `--session-entry-point ${entryPoint}`,
    `--chain-name ${chainName}`,
    "--gas-price 1",
    `--payment-amount ${paymentAmount}`,
    ...sessionArgs.map((a) => `--session-arg ${JSON.stringify(a)}`),
  ].join(" ");

  console.log(`  casper-client cmd: ${cmd}`);

  const { execSync } = await import("node:child_process");
  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    throw new Error(`casper-client failed: ${stderr || stdout || e.message}`);
  }
  const hashMatch = output.match(/"deploy_hash":\s*"([a-f0-9]+)"/);
  const txHash = hashMatch ? hashMatch[1] : "";

  if (!txHash) {
    throw new Error(`casper-client failed to submit transaction: ${output}`);
  }

  // Poll for confirmation
  const blockNumber = await pollTransactionWithCli(txHash, 120_000);
  return { txHash, blockNumber };
}

/**
 * Build a TransactionV1 that calls a stored contract by package hash,
 * using the casper-js-sdk directly (no casper-client CLI required).
 *
 * This is the SDK-based alternative to callStoredContractViaCli for
 * environments where the casper-client Rust binary is not installed.
 */
export async function callStoredContractViaSdk(params: {
  chainName: string;
  signer: Signer;
  packageHash: string;
  entryPoint: string;
  args: Map<string, CLValueType>;
  ttlMs?: number;
  paymentAmount?: number;
  rpcUrl: string;
}): Promise<{ txHash: string; blockNumber: string }> {
  const {
    chainName,
    signer,
    packageHash,
    entryPoint,
    args,
    rpcUrl,
    ttlMs = DEFAULT_TTL_MS,
    paymentAmount = 10_000_000_000,
  } = params;

  // Normalize package hash to raw hex
  const hashHex = packageHash
    .replace(/^contract-package-/, "")
    .replace(/^hash-/, "")
    .replace(/^0x/, "");

  // Build the invocation target
  const byPackageHash = new ByPackageHashInvocationTarget();
  (byPackageHash as any).packageHash = Hash.fromHex(hashHex);
  (byPackageHash as any).entryPoint = entryPoint;

  const storedTarget = new StoredTarget();
  (storedTarget as any).byPackageHash = byPackageHash;

  const target = new TransactionTarget(undefined, storedTarget as any, undefined);

  // Build args
  const argsObj = new Args(args);

  const initiatorAddr = new InitiatorAddr(signer.publicKey);
  const ttl = new Duration(ttlMs);
  const timestamp = new Timestamp(new Date());
  const txnEntryPoint = new TransactionEntryPoint(TransactionEntryPointEnum.Call);

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
    entryPoint: txnEntryPoint,
    pricingMode,
    timestamp,
    transactionTarget: target,
    scheduling,
    chainName,
  });

  const v1 = TransactionV1.makeTransactionV1(payload);
  v1.sign(signer.privateKey);
  const tx = Transaction.fromTransactionV1(v1);

  // Submit via RPC
  const handler = new casperSdk.HttpHandler(rpcUrl, "fetch");
  const rpc = new casperSdk.RpcClient(handler);
  const putResult: any = await rpc.putTransaction(tx);
  const txHash =
    putResult.transactionHash ??
    putResult.deployHash ??
    (tx as any).hash?.transactionV1?.toHex?.() ??
    "";
  if (!txHash) {
    throw new Error(
      `Failed to get transaction hash from putTransaction: ${JSON.stringify(putResult)}`,
    );
  }

  // Poll for confirmation
  const blockNumber = await pollTransactionWithCli(txHash, 120_000);
  return { txHash, blockNumber };
}

/**
 * Convert a CLValue to a casper-client --session-arg string.
 * Format: "name:TYPE='value'"
 */
function clValueToCasperClientArg(name: string, clValue: CLValueType): string {
  const v = clValue as any;
  const typeName = v.type?.typeName ?? "";

  // ByteArray — detect by presence of `byteArray.data`
  if (v.byteArray?.data) {
    const size = v.type?.size ?? v.byteArray.data.length;
    const hex = Buffer.from(v.byteArray.data).toString("hex");
    return `${name}:byte_array_${size}='${hex}'`;
  }

  // String
  if (typeName === "String" || v.stringVal?.value !== undefined) {
    const val = v.stringVal?.value ?? "";
    return `${name}:string='${val}'`;
  }

  // U64
  if (typeName === "U64") {
    const val = v.ui64?.toString?.() ?? "0";
    return `${name}:u64='${val}'`;
  }
  // U512
  if (typeName === "U512") {
    const val = v.ui512?.toString?.() ?? "0";
    return `${name}:u512='${val}'`;
  }
  // U32
  if (typeName === "U32") {
    const val = v.ui32?.toString?.() ?? "0";
    return `${name}:u32='${val}'`;
  }
  // U8
  if (typeName === "U8") {
    const val = v.ui8?.toString?.() ?? "0";
    return `${name}:u8='${val}'`;
  }

  // Bool
  if (typeName === "Bool") {
    const val = v.boolVal?.value ?? v.parsed ?? false;
    return `${name}:bool='${val}'`;
  }

  // List — for Vec<u8> (signature), use byte_list
  if (v.list?.elements || Array.isArray(v.list?.values)) {
    const items = v.list?.elements ?? v.list?.values ?? [];
    const hex = items
      .map((item: any) => {
        const b = item.ui8?.toString?.() ?? item.parsed ?? 0;
        return Number(b).toString(16).padStart(2, "0");
      })
      .join("");
    return `${name}:byte_list='${hex}'`;
  }

  // Fallback
  throw new Error(`Unsupported CLValue type: ${typeName} for arg ${name}`);
}

/**
 * Submit a transaction and wait for confirmation.
 * Uses casper-client CLI for reliable serialization + polling.
 * Falls back to SDK if casper-client is not available.
 */
export async function submitAndWait(
  rpc: RpcClient,
  tx: TransactionType,
  timeoutMs = 120_000,
): Promise<{ txHash: string; blockNumber: string }> {
  // Try to extract the tx hash from the SDK transaction
  let txHash = "";
  try {
    txHash = (tx as any).hash?.transactionV1?.toHex?.() ?? "";
  } catch {}

  if (!txHash) {
    // Submit via SDK
    const putResult: any = await rpc.putTransaction(tx);
    txHash = putResult.transactionHash ?? "";
  }

  if (!txHash) {
    throw new Error("Failed to get transaction hash");
  }

  // Poll for confirmation using casper-client CLI (more reliable than SDK)
  const blockHeight = await pollTransactionWithCli(txHash, timeoutMs);
  return { txHash, blockNumber: blockHeight };
}

/**
 * Poll for transaction confirmation using casper-client CLI.
 * Returns the block height as a string, or "0" if not found.
 */
async function pollTransactionWithCli(
  txHash: string,
  timeoutMs: number,
): Promise<string> {
  const rpcUrl =
    process.env.LIGIS_CASPER_RPC_URL ??
    "https://node.testnet.casper.network/rpc";
  const maxAttempts = Math.floor(timeoutMs / 5000);
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000);
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(
        `casper-client get-deploy --node-address ${rpcUrl} ${txHash} 2>&1`,
        { encoding: "utf-8", timeout: 15000 },
      );
      const match = output.match(/"block_height":\s*(\d+)/);
      if (match) {
        // Check for errors
        const errMatch = output.match(/"error_message":\s*"([^"]+)"/);
        if (errMatch && errMatch[1] !== "null") {
          console.error(`  Transaction execution error: ${errMatch[1]}`);
        }
        return match[1];
      }
    } catch {
      // Transaction not found yet, keep polling
    }
  }
  return "0";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
