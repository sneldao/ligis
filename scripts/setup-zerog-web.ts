/**
 * One-time setup for the web steward wallet on 0G Compute.
 *
 * Uses minimal amounts: 3 OG ledger deposit (minimum) + 1.0 OG provider
 * transfer (Qwen 2.5 7B minimum). Total ~4 OG needed.
 *
 * Usage:
 *   source .env.d/steward.env
 *   export ZEROG_PRIVATE_KEY=$LIGIS_STEWARD_KEY
 *   export ZEROG_RPC_URL=https://evmrpc-testnet.0g.ai
 *   export ZEROG_PROVIDER=0xa48f01287233509FD694a22Bf840225062E67836
 *   npx tsx scripts/setup-zerog-web.ts
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { ethers } = require("ethers") as typeof import("ethers");
const { createZGComputeNetworkBroker } = require("@0gfoundation/0g-compute-ts-sdk") as {
  createZGComputeNetworkBroker: typeof import("@0gfoundation/0g-compute-ts-sdk").createZGComputeNetworkBroker;
};

const QWEN_PROVIDER = "0xa48f01287233509FD694a22Bf840225062E67836";

async function main() {
  const privateKey = process.env.ZEROG_PRIVATE_KEY;
  if (!privateKey) throw new Error("ZEROG_PRIVATE_KEY not set");

  const rpcUrl = process.env.ZEROG_RPC_URL || "https://evmrpc-testnet.0g.ai";
  const providerAddr = process.env.ZEROG_PROVIDER || QWEN_PROVIDER;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} OG`);
  console.log(`Provider: ${providerAddr}`);
  console.log(`RPC: ${rpcUrl}`);

  if (balance < ethers.parseEther("3.9")) {
    throw new Error(`Insufficient balance: ${ethers.formatEther(balance)} OG. Need ~4 OG minimum.`);
  }

  console.log("\n1/3: Creating ledger with 3 OG deposit (minimum)...");
  const broker = await createZGComputeNetworkBroker(
    wallet as unknown as Parameters<typeof createZGComputeNetworkBroker>[0],
  );
  await broker.ledger.addLedger(3);
  console.log("   Ledger created.");

  console.log("2/3: Acknowledging provider signer...");
  await broker.inference.acknowledgeProviderSigner(providerAddr);
  console.log("   Provider acknowledged.");

  console.log("3/3: Transferring 1.0 OG to provider (Qwen minimum)...");
  await broker.ledger.transferFund(
    providerAddr,
    "inference",
    ethers.parseEther("1.0"),
  );
  console.log("   Transfer complete.");

  const finalBalance = await provider.getBalance(wallet.address);
  console.log(`\nSetup complete! Remaining balance: ${ethers.formatEther(finalBalance)} OG`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
