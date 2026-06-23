/**
 * Ligis — CLI
 *
 * Usage:
 *   ligis issue [--token-uri <uri>] [--controller <addr>]
 *   ligis verify --subject <addr> --capability <name|hash> [--issuer <addr>]
 *   ligis revoke --subject <addr> --capability <name|hash> --nonce <n> [--issuer-key <key>]
 *   ligis rotate --token-id <id> --new-controller <addr>
 *   ligis hash --capability <name>
 *   ligis sign --issuer-key <key> --subject <addr> --capability <name|hash> [--expires-in <seconds>]
 *   ligis info
 */

import { type Hex } from "viem";
import {
  CREDENTIAL_REGISTRY_ABI,
  PHAROS_AGENT_ID_ABI,
  capabilityHash,
  getClients,
  issueId,
  loadConfig,
  revoke,
  rotate,
  signCredential,
  verify,
} from "../lib/index.js";
import { TrustSteward } from "../agent/index.js";
import { ZeroGCompute, loadZeroGConfig } from "../zerog/compute.js";
import { ZeroGStorage, loadZeroGStorageConfig } from "../zerog/storage.js";

// Re-export for downstream consumers (e.g. integration tests)
export { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI };

/** Read a --flag <value> or --flag=value argument. */
function arg(name: string, aliases: string[] = []): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` || aliases.includes(args[i])) {
      return args[i + 1];
    }
    if (args[i]?.startsWith(`--${name}=`)) {
      return args[i]!.slice(`--${name}=`.length);
    }
  }
  return undefined;
}

function usage() {
  console.log(`ligis — Ligis CLI

Usage:
  ligis info
  ligis hash --capability <name>
  ligis issue [--token-uri <uri>] [--controller <addr>]
  ligis verify --subject <addr> --capability <name|hash> [--issuer <addr>]
  ligis revoke --subject <addr> --capability <name|hash> --nonce <n> [--issuer-key <key>]
  ligis rotate --token-id <id> --new-controller <addr>
  ligis sign --issuer-key <key> --subject <addr> --capability <name|hash> [--expires-in <seconds>]
  ligis agent run --goal <text> [--dry-run]

Environment:
  PRIVATE_KEY           wallet private key (for write operations)
  PHAROS_NETWORK        'atlantic' (default) or 'mainnet'
  PHAROS_RPC_URL        override the default RPC URL
`);
}

// ---------- Commands (thin: parse args → call lib → print JSON) ----------

async function cmdInfo() {
  const { networkName, network, deployment } = loadConfig();
  console.log(JSON.stringify({ networkName, network, deployment }, null, 2));
}

async function cmdHash() {
  const cap = arg("capability");
  if (!cap) throw new Error("--capability <name> required");
  console.log(JSON.stringify({ capability: cap, keccak256: capabilityHash(cap) }, null, 2));
}

async function cmdIssue() {
  const ctx = getClients();
  const result = await issueId(ctx, {
    controller: arg("controller"),
    tokenUri: arg("token-uri"),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdVerify() {
  const ctx = getClients();
  const subject = arg("subject");
  const cap = arg("capability");
  if (!subject || !cap) throw new Error("--subject and --capability required");
  const result = await verify(ctx, { subject, capability: cap, issuer: arg("issuer") });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdRevoke() {
  const ctx = getClients();
  const subject = arg("subject");
  const cap = arg("capability");
  const nonce = arg("nonce");
  if (!subject || !cap || !nonce) throw new Error("--subject, --capability, --nonce required");
  const issuerKey = (arg("issuer-key") || process.env.PRIVATE_KEY) as Hex | undefined;
  if (!issuerKey) throw new Error("--issuer-key or PRIVATE_KEY required");
  const result = await revoke(ctx, { subject, capability: cap, nonce, issuerKey });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdRotate() {
  const ctx = getClients();
  const tokenId = arg("token-id");
  const newController = arg("new-controller");
  if (!tokenId || !newController) throw new Error("--token-id and --new-controller required");
  const result = await rotate(ctx, { tokenId, newController });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdSign() {
  const ctx = getClients();
  const issuerKey = arg("issuer-key") as Hex;
  const subject = arg("subject");
  const cap = arg("capability");
  if (!issuerKey || !subject || !cap)
    throw new Error("--issuer-key, --subject, --capability required");
  const expiresIn = arg("expires-in") ? Number(arg("expires-in")) : undefined;
  const result = await signCredential(ctx, { issuerKey, subject, capability: cap, expiresInSeconds: expiresIn });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdAgentRun() {
  const goal = arg("goal");
  if (!goal) throw new Error("--goal required");
  const dryRun = process.argv.includes("--dry-run");

  const ctx = getClients();
  const reasoner = new ZeroGCompute(loadZeroGConfig());
  const store = new ZeroGStorage(loadZeroGStorageConfig());
  const steward = new TrustSteward(ctx, reasoner, store);
  const result = await steward.run(goal, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

// ---------- Main ----------

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }
  switch (cmd) {
    case "info":
      return cmdInfo();
    case "hash":
      return cmdHash();
    case "issue":
      return cmdIssue();
    case "verify":
      return cmdVerify();
    case "revoke":
      return cmdRevoke();
    case "rotate":
      return cmdRotate();
    case "sign":
      return cmdSign();
    case "agent":
      if (process.argv[3] === "run") return cmdAgentRun();
      console.error(`Unknown agent subcommand: ${process.argv[3] ?? "(none)"}`);
      console.error("Usage: ligis agent run --goal <text> [--dry-run]");
      process.exit(1);
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
