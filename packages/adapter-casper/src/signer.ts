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
 * Parse a package hash string (e.g. "hash-abc123..." or "0xabc123...") into a Hash.
 */
function parsePackageHash(hashStr: string): HashType {
  const clean = hashStr.startsWith("hash-")
    ? hashStr.slice("hash-".length)
    : hashStr.startsWith("0x")
      ? hashStr.slice(2)
      : hashStr;
  return Hash.fromHex(clean);
}

/**
 * Build a TransactionV1 that calls a stored contract by package hash,
 * wrap it in a Transaction, sign it, and return the wrapper.
 *
 * This is the standard pattern for calling an Odra-deployed contract:
 *   - target: ByPackageHashInvocationTarget with the contract's package hash
 *   - entry point: Custom with the method name
 *   - args: the method's named arguments
 */
export function buildStoredContractTransaction(params: {
  chainName: string;
  signer: Signer;
  packageHash: string;
  entryPoint: string;
  args: Map<string, CLValueType>;
  ttlMs?: number;
  paymentAmount?: number;
}): TransactionType {
  const {
    chainName,
    signer,
    packageHash,
    entryPoint,
    args,
    ttlMs = DEFAULT_TTL_MS,
    paymentAmount = DEFAULT_PAYMENT_AMOUNT,
  } = params;

  const initiatorAddr = new InitiatorAddr(signer.publicKey);
  const argsObj = new Args(args);
  const ttl = new Duration(ttlMs);
  const entryPointObj = new TransactionEntryPoint(TransactionEntryPointEnum.Custom, entryPoint);
  const timestamp = new Timestamp(new Date());

  const invocationTarget = new ByPackageHashInvocationTarget();
  invocationTarget.addr = parsePackageHash(packageHash);
  invocationTarget.version = undefined;
  invocationTarget.protocolVersionMajor = null;

  const storedTarget = new StoredTarget();
  storedTarget.id = invocationTarget;
  storedTarget.runtime = TransactionRuntime.vmCasperV1();

  const target = new TransactionTarget(undefined, storedTarget, undefined);

  const pricingMode = new PricingMode();
  pricingMode.paymentLimited = new PaymentLimitedMode();
  pricingMode.paymentLimited.gasPriceTolerance = DEFAULT_GAS_PRICE_TOLERANCE;
  pricingMode.paymentLimited.paymentAmount = paymentAmount;
  pricingMode.paymentLimited.standardPayment = true;

  const scheduling = new TransactionScheduling();
  scheduling.standard = {};

  const payload = TransactionV1Payload.build({
    initiatorAddr,
    args: argsObj,
    ttl,
    entryPoint: entryPointObj,
    pricingMode,
    timestamp,
    transactionTarget: target,
    scheduling,
    chainName,
  });

  const v1 = TransactionV1.makeTransactionV1(payload);
  v1.sign(signer.privateKey);
  return Transaction.fromTransactionV1(v1);
}

/**
 * Submit a transaction and wait for confirmation.
 * Returns the transaction hash and block height.
 */
export async function submitAndWait(
  rpc: RpcClient,
  tx: TransactionType,
  timeoutMs = 120_000,
): Promise<{ txHash: string; blockNumber: string }> {
  await rpc.putTransaction(tx);
  const result = await rpc.waitForTransaction(tx, timeoutMs / 1000);
  const txHash = result.transaction?.hash?.transactionV1?.toHex() ?? "";
  const blockHeight = result.executionInfo?.blockHeight?.toString() ?? "0";
  return { txHash, blockNumber: blockHeight };
}
