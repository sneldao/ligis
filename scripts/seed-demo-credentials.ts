#!/usr/bin/env tsx
/**
 * Seed the web demo's sample agents with credentials so the public
 * /gate landing can show GO for the "verified agent" samples.
 *
 * Idempotent: verifies first and only issues what is missing or expired.
 * Credentials are issued for one year by the steward key (a SEPARATE key
 * from the deployer). Using the deployer key would create self-issued
 * credentials that the gate rejects.
 *
 * The demo agent subject is 0xd21a... on both EVM chains (Pharos + Monad).
 * The Casper subject is the account-hash listed in DEMO_GATE_SAMPLES.
 *
 * Usage:
 *   LIGIS_STEWARD_KEY=0x... npx tsx scripts/seed-demo-credentials.ts [pharos|monad|casper]
 */
import { readFileSync, existsSync } from "node:fs";
import { CasperAdapter } from "@ligis/adapter-casper";
import { EvmAdapter } from "@ligis/adapter-evm";
import type { ChainAdapter } from "@ligis/core";

const CAPABILITIES = ["kyc.basic", "agent.commerce.escrow", "rwa.accredited"];
const ONE_YEAR = 365 * 24 * 60 * 60;

function loadEnvFiles(...files: string[]): void {
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      if (!process.env[key]) {
        process.env[key] = t
          .slice(eq + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

/**
 * The demo agent subject per DEMO_GATE_SAMPLES — the same address
 * on both EVM chains (Pharos + Monad). Must NOT equal the steward
 * key address, or we'd create self-issued credentials.
 */
const DEMO_SUBJECT =
  process.env.LIGIS_DEMO_SUBJECT ??
  "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec";

const CASPER_DEMO_SUBJECT =
  process.env.LIGIS_DEMO_SUBJECT_CASPER ??
  "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326";

async function seed(
  label: string,
  adapter: ChainAdapter,
  subject: string,
  issuerKey: string,
) {
  console.log(`\n== ${label} · subject ${subject}`);
  for (const capability of CAPABILITIES) {
    const before = await adapter.verifyCapability({ subject, capability });
    if (before.capable) {
      // Verify not self-issued (issuer === subject)
      if (
        before.latest.issuer &&
        before.latest.issuer.toLowerCase() === subject.toLowerCase()
      ) {
        console.log(
          `  ${capability}: SELF-ISSUED → re-issuing with steward key`,
        );
      } else {
        console.log(`  ${capability}: already GO`);
        continue;
      }
    }
    const signed = await adapter.signCredential({
      issuerKey,
      subject,
      capability,
      expiresInSeconds: ONE_YEAR,
    });
    const { tx } = await adapter.submitCredential(signed);
    const after = await adapter.verifyCapability({ subject, capability });
    // Verify the new credential is not self-issued
    if (
      after.latest.issuer &&
      after.latest.issuer.toLowerCase() === subject.toLowerCase()
    ) {
      console.error(
        `  ${capability}: FATAL — re-issued but still self-issued! ` +
          `issuer=${after.latest.issuer}`,
      );
      process.exit(1);
    }
    console.log(
      `  ${capability}: issued → ${after.capable ? "GO" : "STILL STOP"} · ${tx.explorerUrl}`,
    );
  }
}

async function main() {
  loadEnvFiles(
    ".env.d/casper.env",
    ".env.d/steward.env",
    ".env.d/deployer.env",
  );

  const issuerKey = process.env.LIGIS_STEWARD_KEY;
  if (!issuerKey)
    throw new Error(
      "LIGIS_STEWARD_KEY not set (.env.d/steward.env). " +
        "The seed script must NOT use the deployer key — it would create " +
        "self-issued credentials that the gate rejects.",
    );
  process.env.PRIVATE_KEY = issuerKey;

  // The demo subject is NOT the steward wallet — it's the agent
  // address from DEMO_GATE_SAMPLES. This prevents self-issued creds.
  const demoSubject = DEMO_SUBJECT.toLowerCase();

  const only = process.argv[2];

  if (!only || only === "pharos") {
    // Pin the network explicitly: the adapter resolves from LIGIS_NETWORK
    // (falling back to networks.json default), so a shell exporting
    // LIGIS_NETWORK=monad-testnet would otherwise seed Monad twice.
    const prev = process.env.LIGIS_NETWORK;
    process.env.LIGIS_NETWORK = "atlantic-testnet";
    try {
      const pharos = new EvmAdapter();
      const wallet = pharos.walletAddress()?.toLowerCase();
      if (wallet && wallet === demoSubject) {
        console.error(
          `FATAL: steward wallet (${wallet}) === demo subject (${demoSubject}). ` +
            `This would create self-issued credentials the gate rejects. ` +
            `Set LIGIS_DEMO_SUBJECT to a non-steward address.`,
        );
        process.exit(1);
      }
      await seed(pharos.chainName, pharos, DEMO_SUBJECT, issuerKey);
    } finally {
      if (prev !== undefined) process.env.LIGIS_NETWORK = prev;
      else delete process.env.LIGIS_NETWORK;
    }
  }
  if (!only || only === "monad") {
    const prev = process.env.LIGIS_NETWORK;
    process.env.LIGIS_NETWORK = "monad-testnet";
    const monad = new EvmAdapter();
    const wallet = monad.walletAddress()?.toLowerCase();
    if (wallet && wallet === demoSubject) {
      console.error(
        `FATAL: steward wallet (${wallet}) === demo subject (${demoSubject}). ` +
          `This would create self-issued credentials the gate rejects. ` +
          `Set LIGIS_DEMO_SUBJECT to a non-steward address.`,
      );
      process.exit(1);
    }
    await seed(monad.chainName, monad, DEMO_SUBJECT, issuerKey);
    if (prev !== undefined) process.env.LIGIS_NETWORK = prev;
    else delete process.env.LIGIS_NETWORK;
  }
  if (!only || only === "casper") {
    const casper = new CasperAdapter();
    await seed(casper.chainName, casper, CASPER_DEMO_SUBJECT, issuerKey);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
