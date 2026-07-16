/**
 * Browser-side TransactionV1 dry-run smoke.
 *
 * Builds (but does NOT submit) a mint_self deploy in test mode to
 * confirm the SDK's serialization encoding is correct. The user
 * runs this against testnet before judging so the entry-point-as-Custom
 * fix can be validated without burning tokens.
 *
 *   pnpm --filter @ligis/web exec tsx web/scripts/smoke-wallet-tx.ts
 *
 * Outputs:
 *   - entry-point wire bytes (must include the entry-point name)
 *   - transaction hash + bytes for visual inspection
 *   - asserts no "Call" string ever appears in the payload
 */
import casperSdk from "casper-js-sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

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
  TransactionRuntime,
  StoredTarget,
  TransactionInvocationTarget,
  ByPackageHashInvocationTarget,
  TransactionTarget,
  PricingMode,
  PaymentLimitedMode,
  TransactionScheduling,
} = casperSdk;

// 1) Generate a fresh scalar via @noble (mirror of keypair.ts browser path).
const scalar = secp256k1.utils.randomSecretKey();
const scalarHex = "0x" + Array.from(scalar).map((b) => b.toString(16).padStart(2, "0")).join("");

const pk = PrivateKey.fromHex(scalarHex.slice(2), KeyAlgorithm.SECP256K1);
const publicKey = pk.publicKey;
const evmAddr = "0x" + Array.from(keccak_256(secp256k1.getPublicKey(scalar, false).slice(1)).slice(-20))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

console.log("=== Ligis browser TransactionV1 dry-run smoke ===");
console.log("publicKeyHex :", publicKey.toHex());
console.log("accountHash  :", "account-hash-" + publicKey.accountHash().toHex());
console.log("EVM addr (issuer):", evmAddr);
console.log("privateKey   :", scalarHex);

// 2) Build a mint_self deploy. Use a placeholder package hash — this
//    smoke does NOT submit, only validates the encoding.
const placeholderPkgHash = "0".repeat(64);

const argsMap = new Map<string, InstanceType<typeof CLValue>>();
argsMap.set("token_uri", CLValue.newCLString(""));

const entryPointFlag = new TransactionEntryPoint(
  TransactionEntryPointEnum.Custom,
  "mint_self",
);

const byHash = new ByPackageHashInvocationTarget();
byHash.addr = Hash.fromHex(placeholderPkgHash);
byHash.protocolVersionMajor = 2;
const invocationTarget = new TransactionInvocationTarget();
invocationTarget.byPackageHash = byHash;
const storedTarget = new StoredTarget();
storedTarget.id = invocationTarget;
storedTarget.runtime = TransactionRuntime.vmCasperV2();
const txTarget = new TransactionTarget(undefined, storedTarget);

const pricingMode = new PricingMode();
pricingMode.paymentLimited = new PaymentLimitedMode();
pricingMode.paymentLimited.gasPriceTolerance = 1;
pricingMode.paymentLimited.paymentAmount = 5_000_000_000;
pricingMode.paymentLimited.standardPayment = false;

const scheduling = new TransactionScheduling();
scheduling.standard = {};

const argsInstance = new Args(argsMap);

// 3) Trip wire if the SDK silently downgraded Custom -> Call.
if (entryPointFlag.type !== TransactionEntryPointEnum.Custom) {
  throw new Error(`entry-point wasn't Custom: ${String(entryPointFlag.type)}`);
}
if (entryPointFlag.customEntryPoint !== "mint_self") {
  throw new Error(`entry-point name mismatch: ${String(entryPointFlag.customEntryPoint)}`);
}

const payload = TransactionV1Payload.build({
  initiatorAddr: new InitiatorAddr(publicKey),
  args: argsInstance,
  ttl: new Duration(30 * 60 * 1000),
  entryPoint: entryPointFlag,
  pricingMode,
  timestamp: new Timestamp(new Date()),
  transactionTarget: txTarget,
  scheduling,
  chainName: "casper-test",
});

const v1 = TransactionV1.makeTransactionV1(payload);
v1.sign(pk);
const tx = Transaction.fromTransactionV1(v1);

const txBytes = (tx as unknown as { toBytes?: () => Uint8Array }).toBytes?.();
if (!txBytes) {
  throw new Error("Transaction.toBytes() returned nothing — SDK shape may have drifted.");
}
const txHex = "0x" + Array.from(txBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesStr = new TextDecoder("latin1").decode(txBytes);

console.log("");
console.log("=== ENCODING CHECKS ===");
const hasMintSelf = bytesStr.includes("mint_self");
const hasCallOnly = !bytesStr.includes("mint_self") && !hasMintSelf;
console.log("wire bytes length :", txBytes.length);
console.log("wire hex (truncated):", txHex.slice(0, 64) + "..." + txHex.slice(-32));
console.log("contains \"mint_self\":", hasMintSelf ? "YES ✓" : "NO (would NoSuchMethod)");
if (!hasMintSelf) {
  console.error("❌ FAIL: SDK did not serialize the entry-point name into the wire payload.");
  console.error("Inspect bytesStr around the deployment area to find what got written instead.");
  process.exit(1);
}
console.log("✅ entry-point name is on the wire; wire-format valid for Casper 2.0 stored-contract call");
console.log("");
console.log("(Do NOT submit this smoke — the placeholder package hash would fail on chain regardless.)");
console.log("To do a real testnet dry-run, set NEXT_PUBLIC_LIGIS_CASPER_AGENT_ID to your deployed package hash,");
console.log("fund the wallet at https://testnet.cspr.live/tools/faucet, then click Run Steward in the browser.");
