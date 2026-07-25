/**
 * Casper GatedVault Demo — deposit + gated-withdraw on Casper Testnet.
 *
 * Requires `LIGIS_CASPER_GATED_VAULT` to be set in `.env.d/casper.env`.
 * Demonstrates the credential-gated escrow flow end-to-end:
 *
 *   1. ISSUE     — self-issue `rwa.accredited` on CredentialRegistry
 *   2. VERIFY    — confirm is_capable returns true
 *   3. DEPOSIT   — deposit 1 CSPR into GatedVault (payable via proxy_caller.wasm)
 *   4. WITHDRAW  — withdraw 0.5 CSPR; succeeds because credential is held
 *
 * Odra's payable entry points require the proxy_caller.wasm pattern:
 * the account funds a cargo_purse, then the proxy_caller wasm calls the
 * contract's entry point with the cargo_purse + attached_value. Direct
 * `--transferred-value` does not work because Odra reads attached_value
 * from the cargo_purse runtime arg, not from the native transfer.
 *
 * Output: tx hashes written to `scripts/casper-gated-vault-demo.lastrun.txt`.
 *
 * Usage:
 *   set -a && source .env.d/casper.env && set +a
 *   npx tsx scripts/casper-gated-vault-demo.ts
 */
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { CasperAdapter } from "@ligis/adapter-casper";
import { capabilityHash } from "@ligis/core";

const EXPLORER = "https://testnet.cspr.live";

const CAP_REQUIRED = "rwa.accredited";
const DEPOSIT_MOTES = "1000000000"; // 1 CSPR
const WITHDRAW_MOTES = "500000000"; // 0.5 CSPR
const PAYMENT_AMOUNT = "10000000000"; // 10 CSPR gas for contract calls

// CLType tags
const CLTYPE_BOOL = 0;
const CLTYPE_U512 = 6;
const CLTYPE_STRING = 10;
const CLTYPE_KEY = 11;
const CLTYPE_BYTE_ARRAY = 15;
const KEY_HASH = 1;

interface TxRecord {
  step: string;
  hash: string;
  explorerUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serialize Casper RuntimeArgs manually.
 * Format: u32 LE count, then for each: u32 LE name_len, name bytes, CLValue bytes.
 * CLValue = CLType bytes + u32 LE data_length + data bytes.
 */
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

    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32LE(data.length, 0);
    parts.push(clType, dataLen, data);
  }

  return Buffer.concat(parts);
}

function u512ToBytes(value: string): Buffer {
  const num = BigInt(value);
  const hex = num.toString(16);
  const padded = hex.length % 2 === 0 ? hex : "0" + hex;
  const buf = Buffer.from(padded, "hex");
  const lowByte = Buffer.from([buf.length]);
  return Buffer.concat([lowByte, buf]);
}

/**
 * Call a vault entry point via the Odra proxy_caller.wasm pattern.
 * This is required for payable entry points (deposit) and also works
 * for non-payable ones (withdraw).
 *
 * The proxy_caller.wasm expects:
 *   - contract_package_hash: byte_array_32 (raw 32-byte hash)
 *   - entry_point: string
 *   - args: bytes (serialized RuntimeArgs for the actual entry point)
 *   - attached_value: u512
 *   - amount: u512 (same as attached_value, enables purse access)
 */
async function callViaProxyCaller(params: {
  entryPoint: string;
  entryPointArgs: Array<{ name: string; clType: Buffer; data: Buffer }>;
  attachedValue: string; // motes as string
}): Promise<string> {
  const rpcUrl = process.env.LIGIS_CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
  const chainName = process.env.LIGIS_CASPER_CHAIN_NAME ?? "casper-test";
  const keyPath = process.env.LIGIS_CASPER_KEY_PATH ?? ".env.d/casper-deployer.pem";
  const vaultPkg = process.env.LIGIS_CASPER_GATED_VAULT!;
  const wasmPath = resolve(process.cwd(), "packages/contracts-casper/wasm/proxy_caller.wasm");

  if (!existsSync(wasmPath)) {
    throw new Error(`proxy_caller.wasm not found at ${wasmPath}. Download from Odra repo.`);
  }

  // Extract raw 32-byte package hash
  const pkgHashHex = vaultPkg.replace(/^contract-package-/, "").replace(/^hash-/, "").replace(/^0x/, "");
  const pkgHashBytes = Buffer.from(pkgHashHex, "hex");

  // Serialize the entry point args as RuntimeArgs (for the proxy_caller's `args` param)
  const serializedArgs = serializeRuntimeArgs(params.entryPointArgs);
  const argsHex = serializedArgs.toString("hex");

  // CLType for byte_array_32: tag 15 + u32 LE (32)
  const byteArray32ClType = Buffer.alloc(5);
  byteArray32ClType[0] = CLTYPE_BYTE_ARRAY;
  byteArray32ClType.writeUInt32LE(32, 1);

  // CLType for bytes (variable): tag 14 (List(U8)) — but casper-client uses "bytes" type
  // Actually for proxy_caller, the `args` arg is CLType::Bytes which is a List(U8)
  // casper-client represents this as byte_list
  // CLType for string: tag 10
  const stringClType = Buffer.from([CLTYPE_STRING]);
  // CLType for u512: tag 6
  const u512ClType = Buffer.from([CLTYPE_U512]);

  const argv = [
    "put-transaction", "session",
    "--node-address", rpcUrl,
    "--chain-name", chainName,
    "--secret-key", keyPath,
    "--wasm-path", wasmPath,
    "--payment-amount", PAYMENT_AMOUNT,
    "--gas-price-tolerance", "1",
    "--standard-payment", "true",
    // proxy_caller args
    `--session-arg=contract_package_hash:byte_array_32='${pkgHashHex}'`,
    `--session-arg=entry_point:string='${params.entryPoint}'`,
    `--session-arg=args:byte_list='${argsHex}'`,
    `--session-arg=attached_value:u512='${params.attachedValue}'`,
    `--session-arg=amount:u512='${params.attachedValue}'`,
  ];

  let output: string;
  try {
    output = execFileSync("casper-client", argv, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    throw new Error(`proxy_caller ${params.entryPoint} failed: ${stderr || stdout || e.message}`);
  }

  const hashMatch = output.match(/"transaction_hash":\s*\{[^}]*"Version1":\s*"([a-f0-9]+)"/);
  const txHash = hashMatch ? hashMatch[1] : "";
  if (!txHash) {
    throw new Error(`No transaction hash in output: ${output.slice(0, 500)}`);
  }

  // Poll for confirmation
  await sleep(15000);
  for (let i = 0; i < 30; i++) {
    try {
      const infoOutput = execFileSync(
        "casper-client",
        ["get-transaction", "--node-address", rpcUrl, txHash],
        { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
      );
      const info = JSON.parse(infoOutput);
      const execResult = info.execution_result?.result || info.execution_results?.[0]?.result;
      if (execResult?.Success) {
        return txHash;
      }
      if (execResult?.Failure) {
        throw new Error(`${params.entryPoint} failed on-chain: ${JSON.stringify(execResult.Failure).slice(0, 500)}`);
      }
    } catch (e: any) {
      if (e.message?.includes("failed on-chain")) throw e;
      // Not yet indexed — keep polling
    }
    await sleep(10000);
  }
  console.log(`  (polling timed out, check explorer: ${EXPLORER}/transaction/${txHash})`);
  return txHash;
}

async function main() {
  const vaultPkg = process.env.LIGIS_CASPER_GATED_VAULT;
  if (!vaultPkg) {
    console.error("Missing LIGIS_CASPER_GATED_VAULT in .env.d/casper.env");
    console.error("Run scripts/deploy-gated-vault.ts first.");
    process.exit(1);
  }

  const adapter = new CasperAdapter();
  if (!adapter.hasWallet()) {
    console.error("Missing Casper wallet. Set LIGIS_CASPER_KEY_PATH + LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.");
    process.exit(1);
  }

  const controller = adapter.walletAddress()!;
  console.log("╔═════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis GatedVault — credential-gated escrow on Casper     ║");
  console.log("╚═════════════════════════════════════════════════════════════╝\n");
  console.log(`Controller:     ${controller}`);
  console.log(`Vault:          ${vaultPkg}`);
  console.log(`Capability:     ${CAP_REQUIRED} (${capabilityHash(CAP_REQUIRED)})`);

  const txRecords: TxRecord[] = [];

  // --- Step 1: Issue credential (needed so the gate allows withdrawal) ---
  console.log("\n[1] Self-issuing rwa.accredited credential on Casper...");
  const issuerKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!issuerKey) {
    console.error("Missing LIGIS_CASPER_DEPLOYER_PRIVATE_KEY.");
    process.exit(1);
  }
  const signed = await adapter.signCredential({
    issuerKey,
    subject: controller,
    capability: CAP_REQUIRED,
  });
  const issued = await adapter.submitCredential(signed);
  txRecords.push({
    step: "ISSUE:rwa.accredited",
    hash: issued.tx.hash,
    explorerUrl: `${EXPLORER}/transaction/${issued.tx.hash}`,
  });
  console.log(`  ✓ ${EXPLORER}/transaction/${issued.tx.hash}`);

  // --- Step 2: Verify the credential is in place ---
  const check = await adapter.verifyCapability({
    subject: controller,
    capability: CAP_REQUIRED,
  });
  if (!check.capable) {
    console.error("Credential did not register as capable. Aborting before deposit/withdraw.");
    writeOutputs(txRecords, false);
    process.exit(1);
  }
  console.log("  ✓ isCapable(rwa.accredited) = true");

  // --- Step 3: Deposit 1 CSPR (payable via proxy_caller) ---
  console.log(`\n[2] Depositing 1 CSPR into GatedVault (via proxy_caller.wasm)...`);
  try {
    const depositTx = await callViaProxyCaller({
      entryPoint: "deposit",
      entryPointArgs: [], // deposit takes no args
      attachedValue: DEPOSIT_MOTES,
    });
    txRecords.push({
      step: "DEPOSIT:1 CSPR",
      hash: depositTx,
      explorerUrl: `${EXPLORER}/transaction/${depositTx}`,
    });
    console.log(`  ✓ ${EXPLORER}/transaction/${depositTx}`);
  } catch (e: any) {
    console.error(`  ✗ Deposit failed: ${e.message}`);
    writeOutputs(txRecords, false);
    process.exit(1);
  }

  // --- Step 4: Withdraw 0.5 CSPR (gated by is_capable cross-contract) ---
  console.log(`\n[3] Withdrawing 0.5 CSPR via GatedVault.withdraw (cross-contract gate)...`);
  try {
    // Serialize the withdraw args (amount: U512) as RuntimeArgs for the proxy_caller
    const u512ClType = Buffer.from([CLTYPE_U512]);
    const withdrawArgs = [
      { name: "amount", clType: u512ClType, data: u512ToBytes(WITHDRAW_MOTES) },
    ];
    const withdrawTx = await callViaProxyCaller({
      entryPoint: "withdraw",
      entryPointArgs: withdrawArgs,
      attachedValue: "0",
    });
    txRecords.push({
      step: "WITHDRAW:0.5 CSPR",
      hash: withdrawTx,
      explorerUrl: `${EXPLORER}/transaction/${withdrawTx}`,
    });
    console.log(`  ✓ ${EXPLORER}/transaction/${withdrawTx}`);
  } catch (e: any) {
    console.error(`  ✗ Withdraw failed: ${e.message}`);
    writeOutputs(txRecords, false);
    process.exit(1);
  }

  writeOutputs(txRecords, true);
}

function writeOutputs(txRecords: TxRecord[], ok: boolean) {
  const outPath = resolve(process.cwd(), "scripts/casper-gated-vault-demo.lastrun.txt");
  const lines = [
    `# Casper GatedVault demo ${new Date().toISOString()}`,
    `# ok: ${ok}`,
    `# Capability required: ${CAP_REQUIRED} (${capabilityHash(CAP_REQUIRED)})`,
    `# Vault: ${process.env.LIGIS_CASPER_GATED_VAULT}`,
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
