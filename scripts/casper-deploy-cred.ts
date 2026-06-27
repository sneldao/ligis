/**
 * Deploy the CredentialRegistry contract to Casper Testnet.
 * Uses the SDK's SessionTarget with isInstallUpgrade=true.
 */
import { readFileSync } from "node:fs";
import casperSdk from "casper-js-sdk";

const {
  RpcClient,
  PrivateKey,
  InitiatorAddr,
  Args,
  CLValue,
  Duration,
  Timestamp,
  TransactionV1Payload,
  TransactionV1,
  Transaction,
  TransactionEntryPoint,
  TransactionEntryPointEnum,
  TransactionTarget,
  SessionTarget,
  TransactionRuntime,
  PricingMode,
  PaymentLimitedMode,
  TransactionScheduling,
  HttpHandler,
} = casperSdk;

async function main() {
  const rpcUrl = process.env.LIGIS_CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
  const privKeyHex = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY!;
  const keyName = process.argv[2] ?? "ligis_credentialregistry_v2";

  console.log(`Deploying CredentialRegistry to ${rpcUrl}...`);
  console.log(`Package hash key name: ${keyName}`);

  const handler = new HttpHandler(rpcUrl, "fetch");
  const rpc = new RpcClient(handler);

  const privateKey = PrivateKey.fromHex(privKeyHex);
  const publicKey = privateKey.publicKey;

  const wasmBytes = readFileSync("./packages/contracts-casper/wasm/CredentialRegistry.wasm");
  console.log(`WASM size: ${wasmBytes.length} bytes`);

  const odraArgs = new Map<string, any>();
  odraArgs.set("odra_cfg_package_hash_key_name", CLValue.newCLString(keyName));
  odraArgs.set("entry_point", CLValue.newCLString("init"));
  odraArgs.set("args", CLValue.newCLByteArray(new Uint8Array(0)));
  odraArgs.set("attached_value", CLValue.newCLUint512(0));
  odraArgs.set("amount", CLValue.newCLUint512(0));

  const argsObj = new Args(odraArgs);
  const ttl = new Duration(1800000);
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
  pricingMode.paymentLimited.paymentAmount = 50000000000;
  pricingMode.paymentLimited.standardPayment = true;

  const scheduling = new TransactionScheduling();
  scheduling.standard = {};

  const payload = TransactionV1Payload.build({
    initiatorAddr: new InitiatorAddr(publicKey),
    args: argsObj,
    ttl,
    entryPoint,
    pricingMode,
    timestamp,
    transactionTarget: target,
    scheduling,
    chainName: "casper-test",
  });

  const v1 = TransactionV1.makeTransactionV1(payload);
  v1.sign(privateKey);
  const tx = Transaction.fromTransactionV1(v1);

  const result: any = await rpc.putTransaction(tx);
  console.log("Put result:", JSON.stringify(result, null, 2));

  const txHash = result.transactionHash ?? result.transaction_hash;
  if (!txHash) {
    console.error("No transaction hash returned");
    process.exit(1);
  }
  console.log(`Transaction hash: ${txHash}`);
  console.log(`Explorer: https://testnet.cspr.live/transaction/${txHash}`);
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
