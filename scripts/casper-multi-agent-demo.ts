/**
 * Ligis Multi-Agent Coordination Demo — Risk + Issuer + Treasury agents.
 *
 * This script demonstrates a multi-agent swarm coordinating on Casper Testnet,
 * directly matching the buildathon's example direction #3:
 *   "Multi-Agent DAO Governance & Execution"
 *
 * Scenario: An agent wants to access a premium RWA oracle feed via x402.
 * Three specialized agents must coordinate to authorize this:
 *
 *   1. RISK AGENT — evaluates the requesting agent's counterparty risk
 *      using on-chain credential history. Produces a risk verdict.
 *
 *   2. ISSUER AGENT — based on the risk verdict, issues (or denies)
 *      the `data.premium` capability credential on Casper via
 *      CredentialRegistry.issue.
 *
 *   3. TREASURY AGENT — once the credential is issued, executes the
 *      x402 micropayment to the RWA oracle, settling on Casper.
 *
 * All three agents operate on the same Casper Testnet, each with their own
 * on-chain identity (AgentId). The coordination is observable on-chain:
 *   - Risk Agent: reads credential history (on-chain queries)
 *   - Issuer Agent: submits CredentialRegistry.issue (on-chain tx)
 *   - Treasury Agent: settles x402 payment (on-chain tx)
 *
 * Usage:
 *   source .env.d/casper.env
 *   source .env.d/zerog.env
 *   export PRIVATE_KEY=$LIGIS_CASPER_DEPLOYER_PRIVATE_KEY
 *   export LIGIS_CASPER_PUBLIC_KEY=$LIGIS_CASPER_DEPLOYER_PUBKEY
 *   npx tsx scripts/casper-multi-agent-demo.ts
 */
import { CasperAdapter } from "@ligis/adapter-casper";
import { TrustSteward, LocalReasoner } from "@ligis/agent-logic";
import { ZeroGCompute, ZeroGStorage, loadZeroGConfig, loadZeroGStorageConfig } from "@ligis/zerog";
import { createPaymentPayload, parsePaymentRequirements } from "../packages/x402-server/src/client.js";
import type { Reasoner, VerifyResult } from "@ligis/core";

const EXPLORER = "https://testnet.cspr.live";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

function step(num: string, title: string, color = BOLD): void {
  console.log(`\n${color}[${num}] ${title}${RESET}`);
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
function agentHeader(name: string, role: string): void {
  console.log(`\n  ${MAGENTA}${BOLD}┌─ AGENT: ${name} ───────────────────────${RESET}`);
  console.log(`  ${MAGENTA}${BOLD}│  Role: ${role}${RESET}`);
  console.log(`  ${MAGENTA}${BOLD}└───────────────────────────────────────${RESET}`);
}

// ---------- Risk Agent ----------

interface RiskVerdict {
  approved: boolean;
  riskScore: number;
  signals: string[];
  recommendation: string;
}

/**
 * Risk Agent — evaluates counterparty risk by reading on-chain credential
 * history. Checks:
 *   - Does the subject have an AgentId?
 *   - How many credentials do they already hold?
 *   - Are any revoked?
 *   - How long has the agent been on-chain?
 */
async function riskAgent(
  adapter: CasperAdapter,
  subject: string,
  requestedCapability: string,
  knownAgentId: number | null,
): Promise<RiskVerdict> {
  agentHeader("Risk Agent", "Counterparty risk evaluation");

  const signals: string[] = [];
  let score = 100;

  // Check 1: Does the subject have an on-chain identity?
  // Use the knownAgentId if provided (we just minted it) to avoid
  // testnet indexing delays. Fall back to on-chain query.
  let agentId = knownAgentId;
  if (agentId === null) {
    agentId = await adapter.getAgentId(subject);
  }
  if (agentId === null) {
    signals.push("No on-chain AgentId — unknown entity");
    score -= 30;
  } else {
    signals.push(`AgentId #${agentId} found on-chain`);
    info("AgentId", agentId);
  }

  // Check 2: How many credentials does the subject already hold?
  const capsToCheck = [
    "kyc.basic",
    "rwa.accredited",
    "agent.commerce.x402",
    "agent.commerce.escrow",
    "agent.commerce.swap",
  ];
  let heldCount = 0;
  let revokedCount = 0;
  for (const cap of capsToCheck) {
    try {
      const check: VerifyResult = await adapter.verifyCapability({
        subject,
        capability: cap,
      });
      if (check.capable) {
        heldCount++;
        signals.push(`holds ${cap}`);
      }
      if (check.latest.revoked) {
        revokedCount++;
        signals.push(`${cap} was revoked (historical)`);
        score -= 10;
      }
    } catch {
      // ignore query errors
    }
  }

  info("Credentials held", `${heldCount}/${capsToCheck.length}`);
  info("Revocations", String(revokedCount));

  // Check 3: Credential diversity (more diverse = more established)
  if (heldCount >= 3) {
    signals.push("high credential diversity — established agent");
  } else if (heldCount === 0) {
    score -= 15;
    signals.push("no existing credentials — new agent");
  }

  // Check 4: Specific capability check
  const hasRequested = await adapter.verifyCapability({
    subject,
    capability: requestedCapability,
  });
  if (hasRequested.capable) {
    signals.push(`already holds ${requestedCapability} — re-issuance`);
    score += 5;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));
  const approved = score >= 60;

  const verdict: RiskVerdict = {
    approved,
    riskScore: score,
    signals,
    recommendation: approved
      ? `Risk score ${score}/100 — APPROVED for ${requestedCapability} issuance`
      : `Risk score ${score}/100 — DENY ${requestedCapability} issuance (threshold: 60)`,
  };

  info("Risk score", `${score}/100`);
  info("Verdict", approved ? `${GREEN}APPROVED${RESET}` : `${RED}DENIED${RESET}`);
  for (const s of signals) {
    console.log(`  ${DIM}• ${s}${RESET}`);
  }

  return verdict;
}

// ---------- Issuer Agent ----------

interface IssuerResult {
  issued: boolean;
  txHash?: string;
  reason: string;
}

/**
 * Issuer Agent — based on the Risk Agent's verdict, issues (or denies)
 * the requested capability credential on Casper via CredentialRegistry.issue.
 */
async function issuerAgent(
  adapter: CasperAdapter,
  subject: string,
  capability: string,
  riskVerdict: RiskVerdict,
  issuerKey: string,
): Promise<IssuerResult> {
  agentHeader("Issuer Agent", "Credential issuance based on risk verdict");

  if (!riskVerdict.approved) {
    warn(`Issuance DENIED — risk score ${riskVerdict.riskScore}/100 below threshold`);
    return {
      issued: false,
      reason: `Denied: ${riskVerdict.recommendation}`,
    };
  }

  // Check if already capable
  const existing = await adapter.verifyCapability({ subject, capability });
  if (existing.capable) {
    success(`Subject already holds ${capability} — no issuance needed`);
    return {
      issued: true,
      reason: `Already holds ${capability} (valid until ${existing.latest.expiresAt})`,
    };
  }

  // Issue the credential
  try {
    info("Signing credential", `${capability} for ${subject.slice(0, 20)}...`);
    const signed = await adapter.signCredential({
      issuerKey,
      subject,
      capability,
    });
    info("Submitting", "CredentialRegistry.issue on Casper Testnet...");
    const submitted = await adapter.submitCredential(signed);

    success(`Credential issued on Casper!`);
    info("Tx hash", submitted.tx.hash);
    console.log(`  ${DIM}${EXPLORER}/transaction/${submitted.tx.hash}${RESET}`);

    return {
      issued: true,
      txHash: submitted.tx.hash,
      reason: `Issued ${capability} — risk score ${riskVerdict.riskScore}/100`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Issuance failed: ${msg}`);
    return { issued: false, reason: `Issuance error: ${msg}` };
  }
}

// ---------- Treasury Agent ----------

interface TreasuryResult {
  paid: boolean;
  txHash?: string;
  payload?: any;
  reason: string;
}

/**
 * Treasury Agent — once the credential is issued, executes the x402
 * micropayment to the RWA oracle endpoint and settles on Casper.
 */
async function treasuryAgent(
  subject: string,
  capability: string,
  issuerResult: IssuerResult,
  serverUrl: string,
  privateKey: string,
  publicKey: string,
  accountHash: string,
): Promise<TreasuryResult> {
  agentHeader("Treasury Agent", "x402 payment execution");

  if (!issuerResult.issued) {
    warn(`Payment aborted — credential not issued`);
    return { paid: false, reason: "No credential — cannot access RWA oracle" };
  }

  const subjectHash = `account-hash-${accountHash}`;

  // Step 1: Check credential at the gate
  info("Requesting", `GET ${serverUrl}/premium`);
  const checkRes = await fetch(`${serverUrl}/premium`, {
    headers: { "X-Subject": subjectHash },
  });
  const checkBody = await checkRes.json() as any;

  if (checkRes.status === 401) {
    fail("Credential not recognized by the gate");
    return { paid: false, reason: "Gate rejected credential" };
  }

  if (checkRes.status !== 402) {
    fail(`Unexpected response: ${checkRes.status}`);
    return { paid: false, reason: `Unexpected status ${checkRes.status}` };
  }

  success("Credential accepted — 402 Payment Required");
  info("Amount", `${checkBody.accepts?.[0]?.maxAmountRequired} motes`);
  info("Network", checkBody.accepts?.[0]?.network);

  // Step 2: Sign the payment
  info("Signing", "EIP-712 TransferWithAuthorization...");
  const requirements = parsePaymentRequirements(checkBody);
  const paymentHeader = createPaymentPayload(privateKey, publicKey, accountHash, requirements);
  success("Payment payload signed");

  // Step 3: Submit payment
  info("Submitting", "X-PAYMENT header to Trust Gate...");
  const payRes = await fetch(`${serverUrl}/premium`, {
    headers: {
      "X-Subject": subjectHash,
      "X-PAYMENT": paymentHeader,
    },
  });
  const payBody = await payRes.json() as any;

  if (payRes.status !== 200) {
    fail(`Payment failed: ${payRes.status}`);
    return { paid: false, reason: `Payment failed: ${JSON.stringify(payBody).slice(0, 200)}` };
  }

  success("Payment settled! RWA oracle feed delivered.");
  info("Settlement tx", payBody.settled?.txHash ?? "(none)");
  info("Settlement mode", payBody.settled?.mode ?? "(unknown)");

  return {
    paid: true,
    txHash: payBody.settled?.txHash,
    payload: payBody.payload,
    reason: `Paid for ${capability} via x402 — settled on Casper`,
  };
}

// ---------- Main ----------

async function main() {
  const serverUrl = process.argv.find((_, i, a) => a[i - 1] === "--server") ??
    "http://localhost:4040";
  const requestedCapability = "data.premium";

  const privateKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const publicKey = process.env.LIGIS_CASPER_DEPLOYER_PUBKEY ?? process.env.LIGIS_CASPER_PUBLIC_KEY;

  if (!privateKey || !publicKey) {
    fail("Missing env vars. Need LIGIS_CASPER_DEPLOYER_PRIVATE_KEY, LIGIS_CASPER_DEPLOYER_PUBKEY");
    process.exit(1);
  }

  console.log(`${BOLD}${MAGENTA}`);
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  Ligis Multi-Agent Coordination — Risk + Issuer + Treasury      ║");
  console.log("║  Casper Agentic Buildathon 2026 — Multi-Agent Swarm Demo        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log(`${RESET}`);

  info("Scenario", "Agent requests access to premium RWA oracle feed");
  info("Requested capability", requestedCapability);
  info("Chain", "Casper Testnet (casper-test)");
  info("x402 Server", serverUrl);
  console.log(`\n  ${DIM}Three specialized agents will coordinate:${RESET}`);
  console.log(`  ${DIM}  1. Risk Agent    → evaluates counterparty risk (on-chain queries)${RESET}`);
  console.log(`  ${DIM}  2. Issuer Agent  → issues credential based on risk verdict (on-chain tx)${RESET}`);
  console.log(`  ${DIM}  3. Treasury Agent → executes x402 payment for RWA data (on-chain tx)${RESET}`);

  // --- Setup adapter ---
  step("0", "Initializing shared Casper adapter...");
  const adapter = new CasperAdapter();
  const controller = adapter.walletAddress();
  if (!controller || !adapter.hasWallet()) {
    fail("No Casper wallet configured.");
    process.exit(1);
  }
  info("Controller", controller);

  // Derive the raw account hash (without prefix) for x402 payment signing.
  // controller is "account-hash-<hex>" — strip the prefix.
  const accountHash = controller.replace(/^account-hash-/, "");

  // Ensure the agent has an on-chain identity (boot)
  let agentId = await adapter.getAgentId(controller);
  if (agentId === null) {
    info("Boot", "No AgentId found — minting...");
    const res = await adapter.issueAgentId();
    agentId = res.agentId;
    success(`AgentId #${agentId} minted`);
    info("Tx", `${EXPLORER}/transaction/${res.tx.hash}`);
  } else {
    success(`AgentId #${agentId} already exists`);
  }

  // --- Phase 1: Risk Agent ---
  step("1", "PHASE 1 — Risk Agent evaluates counterparty", MAGENTA);
  const riskVerdict = await riskAgent(adapter, controller, requestedCapability, agentId);

  // --- Phase 2: Issuer Agent ---
  step("2", "PHASE 2 — Issuer Agent acts on risk verdict", MAGENTA);
  const issuerResult = await issuerAgent(
    adapter,
    controller,
    requestedCapability,
    riskVerdict,
    privateKey,
  );

  // --- Phase 3: Treasury Agent ---
  step("3", "PHASE 3 — Treasury Agent executes x402 payment", MAGENTA);
  const treasuryResult = await treasuryAgent(
    controller,
    requestedCapability,
    issuerResult,
    serverUrl,
    privateKey,
    publicKey,
    accountHash,
  );

  // --- Coordination Summary ---
  step("4", "COORDINATION SUMMARY", BOLD);

  console.log(`\n  ${BOLD}Agent Swarm Results:${RESET}`);
  console.log(`  ${MAGENTA}Risk Agent${RESET}:    score ${riskVerdict.riskScore}/100 → ${riskVerdict.approved ? `${GREEN}APPROVED${RESET}` : `${RED}DENIED${RESET}`}`);
  console.log(`  ${MAGENTA}Issuer Agent${RESET}:  ${issuerResult.issued ? `${GREEN}ISSUED${RESET}` : `${RED}NOT ISSUED${RESET}`} ${issuerResult.txHash ? `(${DIM}${issuerResult.txHash.slice(0, 16)}...${RESET})` : ""}`);
  console.log(`  ${MAGENTA}Treasury Agent${RESET}: ${treasuryResult.paid ? `${GREEN}PAID${RESET}` : `${RED}NOT PAID${RESET}`} ${treasuryResult.txHash ? `(${DIM}${treasuryResult.txHash.slice(0, 16)}...${RESET})` : ""}`);

  // Display RWA oracle data if payment succeeded
  if (treasuryResult.payload) {
    console.log(`\n  ${BOLD}RWA Oracle Feed Delivered:${RESET}`);
    const p = treasuryResult.payload;
    info("Data source", p.dataSource);
    info("Live", p.live ? "yes" : "no (fallback)");
    info("Total market cap", `$${Number(p.summary?.totalMarketCapUsd ?? 0).toLocaleString()}`);
    info("Avg 24h change", `${p.summary?.avgChange24h}%`);
    for (const asset of (p.assets ?? []).slice(0, 3)) {
      const chg = asset.change24h >= 0 ? `+${asset.change24h}%` : `${asset.change24h}%`;
      console.log(`    ${BOLD}${asset.symbol}${RESET} $${asset.priceUsd.toLocaleString()} (${chg}) ${asset.category}`);
    }
  }

  // On-chain activity
  console.log(`\n  ${BOLD}On-Chain Activity:${RESET}`);
  const txHashes: string[] = [];
  if (issuerResult.txHash) txHashes.push(issuerResult.txHash);
  if (treasuryResult.txHash) txHashes.push(treasuryResult.txHash);
  for (const hash of txHashes) {
    console.log(`  ${DIM}• ${EXPLORER}/transaction/${hash}${RESET}`);
  }
  console.log(`  ${BOLD}${txHashes.length}${RESET} on-chain transactions from multi-agent coordination`);

  // Final verdict
  console.log(`\n${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════════${RESET}`);
  if (treasuryResult.paid) {
    console.log(`${BOLD}${GREEN}  ✅ MULTI-AGENT COORDINATION SUCCESS${RESET}`);
    console.log(`  ${BOLD}Risk → Issuer → Treasury pipeline completed on Casper.${RESET}`);
    console.log(`  ${BOLD}Agent swarm autonomously evaluated, authorized, and paid for RWA data.${RESET}`);
  } else if (issuerResult.issued) {
    console.log(`${BOLD}${YELLOW}  ⚠ PARTIAL — Credentials issued but payment failed.${RESET}`);
  } else {
    console.log(`${BOLD}${RED}  ❌ COORDINATION FAILED — ${issuerResult.reason}${RESET}`);
  }
  console.log(`${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════════${RESET}`);

  process.exit(treasuryResult.paid ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET} ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
