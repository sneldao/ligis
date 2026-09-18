#!/usr/bin/env tsx
/**
 * Monad Testnet — Credential Lifecycle Demo
 *
 * The canonical one-command reproduction of the Ligis trust gate on Monad
 * Testnet (chainId 10143). It runs the full decision loop against the
 * contracts recorded at `deployment.monad-testnet` in assets/networks.json:
 *
 *   1. BOOT    — AgentId.mintSelf (skipped if the controller already holds an ID)
 *   2. ISSUE   — sign an EIP-712 credential off-chain, submit to CredentialRegistry
 *   3. GATE    — isCapable(subject, capability) → expect GO (true)
 *   4. REVOKE  — CredentialRegistry.revoke (issuer action)
 *   5. RE-GATE — isCapable(subject, capability) → expect STOP (false)
 *
 * The credential is signed and revoked by the same key, so the issuer address
 * equals the controller. This is the self-issued demo path, not a third-party
 * attestation flow.
 *
 * Usage:
 *   set -a && source .env.d/deployer.env && set +a
 *   npx tsx scripts/monad-lifecycle-demo.ts
 *
 * Optional env:
 *   LIGIS_MONAD_CAPABILITY   capability to exercise (default "kyc.basic")
 *   LIGIS_MONAD_RPC_URL      RPC override (default from assets/networks.json)
 *
 * Tx hashes are written to scripts/monad-lifecycle-demo.lastrun.txt so a
 * submission document can link to verified explorer pages. Exits 0 on
 * success, 1 on any checked failure.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EvmAdapter } from "@ligis/adapter-evm";
import { capabilityHash } from "@ligis/core";

const NETWORK = "monad-testnet";
const EXPECTED_CHAIN_ID = 10143;
const CAPABILITY = process.env.LIGIS_MONAD_CAPABILITY ?? "kyc.basic";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

interface TxRecord {
  step: string;
  hash: string;
  explorerUrl: string;
}

function sep(): void {
  console.log(
    `\n${DIM}────────────────────────────────────────────────────${RESET}\n`,
  );
}

function info(label: string, value: string): void {
  console.log(`  ${CYAN}${label}:${RESET} ${value}`);
}

function ok(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.error(`  ${RED}✗${RESET} ${msg}`);
}

async function main(): Promise<void> {
  console.log(`${BOLD}${CYAN}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  Ligis on Monad Testnet — Credential Lifecycle               ║",
  );
  console.log(
    "║  mint → issue → GO → revoke → STOP                           ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );
  console.log(`${RESET}`);

  // The adapter resolves its network from LIGIS_NETWORK. Force Monad so this
  // script cannot silently run against Pharos when that env var is already set.
  process.env.LIGIS_NETWORK = NETWORK;
  if (process.env.LIGIS_MONAD_RPC_URL) {
    process.env.LIGIS_RPC_URL = process.env.LIGIS_MONAD_RPC_URL;
  }

  const adapter = new EvmAdapter();
  const controller = adapter.walletAddress();
  if (!controller) {
    fail(
      "No EVM wallet configured. Set PRIVATE_KEY (or source .env.d/deployer.env).",
    );
    process.exit(1);
  }

  // Verify the RPC really is Monad before any write is attempted.
  const chainId = await adapter.ctx.publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    fail(
      `Expected Monad Testnet (${EXPECTED_CHAIN_ID}); the RPC reports ${chainId}.`,
    );
    process.exit(1);
  }

  const capHash = capabilityHash(CAPABILITY);
  const txs: TxRecord[] = [];

  console.log(`${BOLD}[1] Boot — agent identity${RESET}`);
  info(
    "Network",
    `${adapter.chainName} (${adapter.chainId} · chainId ${chainId})`,
  );
  info("Controller", controller);
  info("Capability", `${CAPABILITY} → ${capHash}`);

  // Idempotent: mintSelf reverts with AlreadyHasID if the wallet is registered.
  const existing = await adapter.getAgentId(controller);
  if (existing) {
    info("Agent ID", `${existing} (already minted — reusing)`);
    ok("Agent identity already present");
  } else {
    const minted = await adapter.issueAgentId({
      tokenUri: "ipfs://ligis-monad-demo",
    });
    info("Agent ID", minted.agentId);
    info("DID", minted.did);
    txs.push({
      step: "mintSelf",
      hash: minted.tx.hash,
      explorerUrl: minted.tx.explorerUrl ?? "",
    });
    ok(`Minted agent identity (tx ${minted.tx.hash.slice(0, 12)}…)`);
  }

  sep();
  console.log(`${BOLD}[2] Issue — signed EIP-712 credential${RESET}`);
  const signed = await adapter.signCredential({
    issuerKey: process.env.PRIVATE_KEY as string,
    subject: controller,
    capability: CAPABILITY,
  });
  info("Issuer", signed.issuer);
  info("Digest", signed.digest);
  info("Nonce", signed.nonce);

  const submitted = await adapter.submitCredential(signed);
  txs.push({
    step: "issue",
    hash: submitted.tx.hash,
    explorerUrl: submitted.tx.explorerUrl ?? "",
  });
  ok(`Credential recorded on-chain (tx ${submitted.tx.hash.slice(0, 12)}…)`);

  sep();
  console.log(
    `${BOLD}[3] Gate — the read an agent makes before it pays${RESET}`,
  );
  const before = await adapter.verifyCapability({
    subject: controller,
    capability: CAPABILITY,
  });
  info("isCapable()", String(before.capable));
  if (!before.capable) {
    fail("Expected GO (true) after issuing the credential.");
    process.exit(1);
  }
  ok("GO — the gate opens");

  sep();
  console.log(
    `${BOLD}[4] Revoke — the issuer withdraws the credential${RESET}`,
  );
  const revoked = await adapter.revokeCredential({
    subject: controller,
    capability: CAPABILITY,
    nonce: signed.nonce,
  });
  txs.push({
    step: "revoke",
    hash: revoked.tx.hash,
    explorerUrl: revoked.tx.explorerUrl ?? "",
  });
  ok(`Revoked (tx ${revoked.tx.hash.slice(0, 12)}…)`);

  sep();
  console.log(`${BOLD}[5] Re-gate — the same read, after revocation${RESET}`);
  const after = await adapter.verifyCapability({
    subject: controller,
    capability: CAPABILITY,
  });
  info("isCapable()", String(after.capable));
  if (after.capable) {
    fail("Expected STOP (false) after revocation.");
    process.exit(1);
  }
  ok("STOP — the gate closes");

  sep();
  console.log(`${BOLD}Summary${RESET}`);
  for (const tx of txs) {
    console.log(`  ${tx.step.padEnd(10)} ${tx.hash}`);
    if (tx.explorerUrl)
      console.log(`  ${" ".repeat(10)} ${DIM}${tx.explorerUrl}${RESET}`);
  }

  const outPath = resolve(
    import.meta.dirname,
    "monad-lifecycle-demo.lastrun.txt",
  );
  writeFileSync(
    outPath,
    [
      `network=${NETWORK}`,
      `chainId=${chainId}`,
      `controller=${controller}`,
      `capability=${CAPABILITY}`,
      `capabilityHash=${capHash}`,
      `gateBefore=${before.capable}`,
      `gateAfter=${after.capable}`,
      ...txs.map((t) => `${t.step}=${t.hash}`),
      "",
    ].join("\n"),
  );
  console.log(`\n  ${DIM}Tx record: ${outPath}${RESET}`);
  console.log(
    `\n${GREEN}${BOLD}SUCCESS${RESET} — GO then STOP, both read from Monad state.\n`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
