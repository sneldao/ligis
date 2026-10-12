#!/usr/bin/env tsx
/**
 * Seed the web demo's sample agents with the credentials the named
 * situations on /gate check, so a visitor's first live verdict can be GO.
 *
 * Idempotent: verifies first and only issues what is missing or expired.
 * Credentials are issued for one year by the steward key (NOT the deployer)
 * so the demo agent is NOT self-issued. The steward key is a separate key
 * that the operator uses for signing credentials.
 *
 * Usage:
 *   LIGIS_STEWARD_KEY=0x... npx tsx scripts/seed-demo-credentials.ts [pharos|casper]
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
      // Verify not self-issued
      if (
        before.latest.issuer &&
        before.latest.issuer.toLowerCase() === subject.toLowerCase()
      ) {
        console.log(
          `  ${capability}: SELF-ISSUED → will re-issue with steward key`,
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
      console.log(
        `  ${capability}: RE-ISSUED but still self-issued! Issuer=${after.latest.issuer}`,
      );
    } else {
      console.log(
        `  ${capability}: issued → ${after.capable ? "GO" : "STILL STOP"} · ${tx.explorerUrl}`,
      );
    }
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

  const only = process.argv[2];
  if (!only || only === "pharos") {
    const pharos = new EvmAdapter();
    const subject = pharos.walletAddress();
    if (!subject) throw new Error("Pharos adapter has no wallet");
    await seed(pharos.chainName, pharos, subject, issuerKey);
  }
  if (!only || only === "casper") {
    const casper = new CasperAdapter();
    const subject = casper.walletAddress();
    if (!subject) throw new Error("Casper adapter has no wallet");
    await seed(casper.chainName, casper, subject, issuerKey);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
