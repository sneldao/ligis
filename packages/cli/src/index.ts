/**
 * Ligis — CLI
 *
 * A thin command-line surface over the ChainAdapter interface. Today the
 * `--chain` flag accepts `evm` (default); `casper` is reserved for the
 * upcoming Casper adapter and will route to @ligis/adapter-casper.
 *
 * Usage:
 *   ligis info
 *   ligis hash --capability <name>
 *   ligis issue [--token-uri <uri>] [--controller <addr>]
 *   ligis verify --subject <addr> --capability <name|hash> [--issuer <addr>]
 *   ligis revoke --subject <addr> --capability <name|hash> --nonce <n> [--issuer-key <key>]
 *   ligis rotate --token-id <id> --new-controller <addr>
 *   ligis sign --issuer-key <key> --subject <addr> --capability <name|hash> [--expires-in <seconds>]
 *   ligis agent run --goal <text> [--dry-run]
 *
 * Global flags:
 *   --chain <evm|casper>   chain to target (default: evm)
 */

import { capabilityHash, loadConfig, type ChainAdapter } from "@ligis/core";
import { EvmAdapter } from "@ligis/adapter-evm";
import { TrustSteward } from "@ligis/agent-logic";
import { ZeroGCompute, ZeroGStorage, loadZeroGConfig, loadZeroGStorageConfig } from "@ligis/zerog";

/** Read a --flag <value> or --flag=value argument. */
function arg(name: string, aliases: string[] = []): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` || aliases.includes(args[i]!)) return args[i + 1];
    if (args[i]?.startsWith(`--${name}=`)) return args[i]!.slice(`--${name}=`.length);
  }
  return undefined;
}

/** Resolve the chain adapter from the global --chain flag. */
function getAdapter(): ChainAdapter {
  const chain = (arg("chain") ?? "evm").toLowerCase();
  switch (chain) {
    case "evm":
    case "pharos":
      return new EvmAdapter();
    case "casper":
      throw new Error("Casper adapter not yet implemented (planned: @ligis/adapter-casper).");
    default:
      throw new Error(`Unknown --chain: ${chain}. Supported: evm, casper.`);
  }
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

Global flags:
  --chain <evm|casper>  chain to target (default: evm)

Environment:
  PRIVATE_KEY           wallet private key (for write operations)
  LIGIS_NETWORK         network alias from assets/networks.json (default: defaultNetwork)
  LIGIS_RPC_URL         override the default RPC URL
`);
}

function emit(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

// ---------- Commands ----------

async function cmdInfo() {
  const { networkName, network, deployment } = loadConfig();
  emit({ networkName, network, deployment });
}

async function cmdHash() {
  const cap = arg("capability");
  if (!cap) throw new Error("--capability <name> required");
  emit({ capability: cap, keccak256: capabilityHash(cap) });
}

async function cmdIssue() {
  const adapter = getAdapter();
  const result = await adapter.issueAgentId({
    controller: arg("controller"),
    tokenUri: arg("token-uri"),
  });
  emit({ ok: true, action: "issue", ...result });
}

async function cmdVerify() {
  const adapter = getAdapter();
  const subject = arg("subject");
  const cap = arg("capability");
  if (!subject || !cap) throw new Error("--subject and --capability required");
  const result = await adapter.verifyCapability({ subject, capability: cap, issuer: arg("issuer") });
  emit({ ok: true, action: "verify", chainId: adapter.chainId, ...result });
}

async function cmdRevoke() {
  const adapter = getAdapter();
  const subject = arg("subject");
  const cap = arg("capability");
  const nonce = arg("nonce");
  if (!subject || !cap || !nonce) throw new Error("--subject, --capability, --nonce required");
  const issuerKey = arg("issuer-key") || process.env.PRIVATE_KEY;
  if (!issuerKey) throw new Error("--issuer-key or PRIVATE_KEY required");
  const result = await adapter.revokeCredential({ subject, capability: cap, nonce, issuerKey });
  emit({ ok: true, action: "revoke", subject, capability: cap, nonce, ...result });
}

async function cmdRotate() {
  const adapter = getAdapter();
  const tokenId = arg("token-id");
  const newController = arg("new-controller");
  if (!tokenId || !newController) throw new Error("--token-id and --new-controller required");
  const result = await adapter.rotateAgentId({ agentId: tokenId, newController });
  emit({ ok: true, action: "rotate", agentId: tokenId, newController, ...result });
}

async function cmdSign() {
  const adapter = getAdapter();
  const issuerKey = arg("issuer-key");
  const subject = arg("subject");
  const cap = arg("capability");
  if (!issuerKey || !subject || !cap)
    throw new Error("--issuer-key, --subject, --capability required");
  const expiresIn = arg("expires-in") ? Number(arg("expires-in")) : undefined;
  const result = await adapter.signCredential({
    issuerKey,
    subject,
    capability: cap,
    expiresInSeconds: expiresIn,
  });
  emit({ ok: true, action: "sign", ...result });
}

async function cmdAgentRun() {
  const goal = arg("goal");
  if (!goal) throw new Error("--goal required");
  const dryRun = process.argv.includes("--dry-run");
  const adapter = getAdapter();
  const reasoner = new ZeroGCompute(loadZeroGConfig());
  const store = new ZeroGStorage(loadZeroGStorageConfig());
  const steward = new TrustSteward(adapter, reasoner, store);
  const result = await steward.run(goal, { dryRun });
  emit(result);
}

// ---------- Main ----------

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }
  switch (cmd) {
    case "info":   return cmdInfo();
    case "hash":   return cmdHash();
    case "issue":  return cmdIssue();
    case "verify": return cmdVerify();
    case "revoke": return cmdRevoke();
    case "rotate": return cmdRotate();
    case "sign":   return cmdSign();
    case "agent":
      if (process.argv[3] === "run") return cmdAgentRun();
      console.error(`Unknown agent subcommand: ${process.argv[3] ?? "(none)"}`);
      console.error("Usage: ligis agent run --goal <text> [--dry-run]");
      process.exit(1);
      return;
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
