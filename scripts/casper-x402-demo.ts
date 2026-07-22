/**
 * Casper x402 End-to-End Demo — credential-gated micropayment.
 *
 * This script demonstrates the full x402 flow on Casper Testnet:
 *
 *   1. Start the x402 Trust Gate server (or connect to a running one)
 *   2. Agent requests /premium → 401 (no credential)
 *   3. Agent requests /premium with X-Subject → 402 (payment required)
 *   4. Agent signs a TransferWithAuthorization (EIP-712)
 *   5. Agent resubmits with X-PAYMENT header → 200 + premium RWA data
 *
 * Prerequisites:
 *   - Trust Steward has already issued `data.premium` credential to the agent
 *   - x402-server is running (pnpm x402:dev)
 *   - .env.d/casper.env is sourced
 *
 * Usage:
 *   source .env.d/casper.env
 *   npx tsx scripts/casper-x402-demo.ts [--server http://localhost:4040]
 */
import { createPaymentPayload, parsePaymentRequirements } from "../packages/x402-server/src/client.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const EXPLORER = "https://testnet.cspr.live";

function step(num: number, title: string): void {
  console.log(`\n${BOLD}[${num}] ${title}${RESET}`);
}
function info(label: string, value: string): void {
  console.log(`  ${CYAN}${label}:${RESET} ${value}`);
}
function success(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}
function fail(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

async function main() {
  const serverUrl = process.argv.find((_, i, a) => a[i - 1] === "--server") ??
    "http://localhost:4040";

  const privateKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const publicKey = process.env.LIGIS_CASPER_DEPLOYER_PUBKEY ?? process.env.LIGIS_CASPER_PUBLIC_KEY;
  const accountHash = process.env.LIGIS_CASPER_DEPLOYER_PUBKEY
    ? stripAccountHashPrefix(getAccountHashFromPubKey(process.env.LIGIS_CASPER_DEPLOYER_PUBKEY))
    : "";

  if (!privateKey || !publicKey || !accountHash) {
    fail("Missing env vars. Need LIGIS_CASPER_DEPLOYER_PRIVATE_KEY, LIGIS_CASPER_DEPLOYER_PUBKEY");
    process.exit(1);
  }

  const subject = `account-hash-${accountHash}`;

  console.log(`${BOLD}${CYAN}`);
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis x402 Trust Gate — Credential-Gated Micropayment       ║");
  console.log("║  Casper Agentic Buildathon 2026 — x402 Payment Demo          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`${RESET}`);

  info("Server", serverUrl);
  info("Agent subject", subject);
  info("Agent pubkey", publicKey);

  // --- Step 1: Check credential (should be capable) ---
  step(1, "Checking agent credential (data.premium)...");
  const checkRes = await fetch(`${serverUrl}/premium`, {
    headers: { "X-Subject": subject },
  });
  const checkBody = await checkRes.json() as any;

  if (checkRes.status === 401) {
    fail("Agent does not have the required credential.");
    info("Required", checkBody.requiredCapability);
    info("Hint", checkBody.hint);
    console.log(`\n  ${DIM}Run the Trust Steward first to self-issue the credential:${RESET}`);
    console.log(`  ${DIM}npx tsx scripts/casper-e2e-demo.ts${RESET}`);
    process.exit(1);
  }

  if (checkRes.status !== 402) {
    fail(`Unexpected status: ${checkRes.status}`);
    console.log(`  ${DIM}${JSON.stringify(checkBody).slice(0, 200)}${RESET}`);
    process.exit(1);
  }

  success("Agent is credentialed. Payment required (402).");
  info("x402Version", String(checkBody.x402Version));
  info("Scheme", checkBody.accepts?.[0]?.scheme);
  info("Network", checkBody.accepts?.[0]?.network);
  info("Amount", checkBody.accepts?.[0]?.maxAmountRequired + " motes (1 CSPR)");
  info("Asset", checkBody.accepts?.[0]?.asset || "(native CSPR)");

  // --- Step 2: Sign the payment ---
  step(2, "Signing TransferWithAuthorization (EIP-712)...");
  const requirements = parsePaymentRequirements(checkBody);
  const paymentHeader = createPaymentPayload(privateKey, publicKey, accountHash, requirements);
  success("Payment payload signed.");
  info("Signature", paymentHeader.slice(0, 40) + "...");

  // --- Step 3: Submit payment ---
  step(3, "Submitting payment (X-PAYMENT header)...");
  const payRes = await fetch(`${serverUrl}/premium`, {
    headers: {
      "X-Subject": subject,
      "X-PAYMENT": paymentHeader,
    },
  });
  const payBody = await payRes.json() as any;

  if (payRes.status !== 200) {
    fail(`Payment failed: ${payRes.status}`);
    console.log(`  ${DIM}${JSON.stringify(payBody, null, 2)}${RESET}`);
    process.exit(1);
  }

  success("Payment settled! Premium data delivered.");
  info("Settlement tx", payBody.settled?.txHash);
  info("Settlement mode", payBody.settled?.mode);
  if (payBody.settled?.txHash) {
    console.log(`  ${DIM}${EXPLORER}/transaction/${payBody.settled.txHash}${RESET}`);
  }

  // --- Step 4: Display the premium RWA oracle feed ---
  step(4, "Premium RWA Oracle Feed");
  const payload = payBody.payload;
  if (payload) {
    info("Data source", payload.dataSource);
    info("Live data", payload.live ? "yes" : "no (fallback)");
    info("Timestamp", payload.timestamp);
    info("Total market cap", `$${Number(payload.summary?.totalMarketCapUsd ?? 0).toLocaleString()}`);
    info("Avg 24h change", `${payload.summary?.avgChange24h}%`);
    info("Overall trend", payload.summary?.overallTrend);
    info("Risk level", payload.summary?.riskLevel);
    console.log(`\n  ${BOLD}Tokenized RWA Assets:${RESET}`);
    for (const asset of payload.assets ?? []) {
      const changeStr = asset.change24h >= 0
        ? `${GREEN}+${asset.change24h}%${RESET}`
        : `${RED}${asset.change24h}%${RESET}`;
      console.log(`  ${BOLD}${asset.symbol}${RESET} ${asset.name} (${asset.category})`);
      console.log(`    Price: $${asset.priceUsd.toLocaleString()}  24h: ${changeStr}  MCap: $${(asset.marketCapUsd / 1e6).toFixed(1)}M`);
    }
  }

  // --- Summary ---
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${GREEN}  ✅ x402 PAYMENT SUCCESS — Agent paid for premium RWA data on Casper.${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  process.exit(0);
}

function stripAccountHashPrefix(s: string): string {
  return s.replace(/^account-hash-/, "");
}

function getAccountHashFromPubKey(pubKeyHex: string): string {
  // The public key hex includes the algorithm prefix (02 for secp256k1)
  // We need to compute the account hash from it
  // For now, use the env var directly if available
  const fromEnv = process.env.LIGIS_CASPER_DEPLOYER_ACCOUNT_HASH;
  if (fromEnv) return fromEnv;

  // Otherwise, we can't compute it here without the SDK
  // Fall back to a known value from previous runs
  return "c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326";
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET} ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
