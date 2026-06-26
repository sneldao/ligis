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
  const hexKey = process.env.LIGIS_CASPER_PRIVATE_KEY || process.env.PRIVATE_KEY;

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
    throw new Error("Casper signer: LIGIS_CASPER_KEY_PATH (PEM) required for casper-client CLI");
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

  // Build the command
  const cmd = [
    "casper-client put-transaction package",
    `--node-address ${rpcUrl}`,
    `--secret-key ${keyPath}`,
    `--contract-package-hash ${finalHash}`,
    `--session-entry-point ${entryPoint}`,
    `--chain-name ${chainName}`,
    "--gas-price-tolerance 1",
    `--payment-amount ${paymentAmount}`,
    "--standard-payment true",
    ...sessionArgs.map((a) => `--session-arg ${JSON.stringify(a)}`),
  ].join(" ");

  const { execSync } = await import("node:child_process");
  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    throw new Error(`casper-client failed: ${stderr || stdout || e.message}`);
  }
  const hashMatch = output.match(/"Version1":\s*"([a-f0-9]+)"/);
  const txHash = hashMatch ? hashMatch[1] : "";

  if (!txHash) {
    throw new Error(`casper-client failed to submit transaction: ${output}`);
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
  // Check the CLType by inspecting the clValue
  const any = clValue as any;
  const clType = any?.clType?.value ?? any?.clType?.toString?.() ?? "";

  // String
  if (clType === "String" || any?.parsed !== undefined && typeof any.parsed === "string") {
    return `${name}:string='${any.parsed}'`;
  }
  // U512 / U64 / U32
  if (clType === "U512" || clType === "U64" || clType === "U32" || clType === "U256" || clType === "U128") {
    const val = any.parsed?.toString?.() ?? "0";
    return `${name}:u512='${val}'`;
  }
  // Bool
  if (clType === "Bool") {
    return `${name}:bool='${any.parsed}'`;
  }
  // ByteArray
  if (typeof clType === "object" && clType?.ByteArray !== undefined) {
    const val = any.parsed ?? "";
    return `${name}:byte_array_${clType.ByteArray}='${val}'`;
  }
  // PublicKey
  if (clType === "PublicKey") {
    return `${name}:public_key='${any.parsed}'`;
  }
  // Fallback: try as string
  const val = any?.parsed?.toString?.() ?? "";
  return `${name}:string='${val}'`;
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
async function pollTransactionWithCli(txHash: string, timeoutMs: number): Promise<string> {
  const rpcUrl = process.env.LIGIS_CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
  const maxAttempts = Math.floor(timeoutMs / 5000);
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000);
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(
        `casper-client get-transaction --node-address ${rpcUrl} ${txHash} 2>&1`,
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
