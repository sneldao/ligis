/**
 * Sweep OG from funder wallets into the steward wallet.
 *
 * Usage:
 *   npx tsx scripts/sweep-zerog-web.ts
 *
 * Reads .env.d/zerog-funders-web.json and sends all balances
 * (minus gas) to the steward wallet (0x76eCFC...).
 */
import { createRequire } from "module";
import { readFileSync } from "fs";

const require = createRequire(import.meta.url);
const { ethers } = require("ethers") as typeof import("ethers");

const TARGET = "0x76eCFC63742b154e24dECf3c00Ea8DFED5061833";
const RPC = "https://evmrpc-testnet.0g.ai";

async function main() {
  const funders = JSON.parse(
    readFileSync(".env.d/zerog-funders-web.json", "utf-8"),
  ) as Array<{ index: number; address: string; privateKey: string }>;

  const provider = new ethers.JsonRpcProvider(RPC);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 1_000_000_000n;
  const gasCost = gasPrice * 21000n;

  console.log(`Target: ${TARGET}`);
  console.log(`Gas price: ${gasPrice.toString()} wei (${ethers.formatEther(gasCost)} OG per tx)`);
  console.log(`Funder wallets: ${funders.length}\n`);

  let totalSwept = 0n;

  for (const f of funders) {
    const balance = await provider.getBalance(f.address);
    const balStr = ethers.formatEther(balance);

    if (balance <= gasCost) {
      console.log(`#${f.index} ${f.address}: ${balStr} OG — skip (insufficient for gas)`);
      continue;
    }

    const amount = balance - gasCost;
    console.log(`#${f.index} ${f.address}: ${balStr} OG → sending ${ethers.formatEther(amount)} OG`);

    const wallet = new ethers.Wallet(f.privateKey, provider);
    const tx = await wallet.sendTransaction({
      to: TARGET,
      value: amount,
      gasLimit: 21000,
      gasPrice,
    });
    console.log(`  tx: ${tx.hash}`);
    await tx.wait();
    totalSwept += amount;
  }

  const stewardBal = await provider.getBalance(TARGET);
  console.log(`\nTotal swept: ${ethers.formatEther(totalSwept)} OG`);
  console.log(`Steward balance: ${ethers.formatEther(stewardBal)} OG`);
}

main().catch((err) => {
  console.error("Sweep failed:", err);
  process.exit(1);
});
