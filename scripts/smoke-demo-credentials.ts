#!/usr/bin/env tsx
/**
 * Read-only smoke for /gate demo samples.
 *
 * Checks every DEMO_GATE_SAMPLES entry still matches its expected outcome
 * (GO / revoked STOP / no credential). Run in CI on a schedule so expired
 * or accidentally re-issued fixtures fail loudly instead of the live site
 * quietly flipping to the wrong verdict.
 *
 * Usage:
 *   npx tsx scripts/smoke-demo-credentials.ts
 *   npx tsx scripts/smoke-demo-credentials.ts monad-testnet
 *
 * Public RPCs from assets/networks.json — no deployer keys required.
 */
import { readFileSync, existsSync } from "node:fs";
import { EvmAdapter } from "@ligis/adapter-evm";
import { CasperAdapter } from "@ligis/adapter-casper";

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

// Casper reads need the public deployment values (RPC, registry package
// hash). Load the local env file when present; CI passes the same values as
// workflow env vars (see .github/workflows/demo-credentials.yml).
loadEnvFiles(".env.d/casper.env");

// Keep in sync with web/lib/demo-subjects.ts (duplicated so this script has
// no web/ import path / server-only coupling).
const SAMPLES: Record<
  string,
  Array<{
    label: string;
    subject: string;
    capability: string;
    expect: "go" | "revoked" | "none";
  }>
> = {
  "pharos-atlantic": [
    {
      label: "verified agent",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "kyc.basic",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
  "monad-testnet": [
    {
      label: "verified agent",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "agent.commerce.escrow",
      expect: "go",
    },
    {
      label: "revoked credential",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "demo.metropolis.revocation",
      expect: "revoked",
    },
    {
      label: "passkey-issued",
      subject: "0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec",
      capability: "demo.passkey",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
  "casper-testnet": [
    {
      label: "verified agent",
      subject:
        "account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326",
      capability: "kyc.basic",
      expect: "go",
    },
    {
      label: "unverified wallet",
      subject:
        "account-hash-0000000000000000000000000000000000000000000000000000000000000001",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
};

const NETWORK_ENV: Record<string, string> = {
  "pharos-atlantic": "atlantic-testnet",
  "monad-testnet": "monad-testnet",
};

async function checkSample(
  chainLabel: string,
  sample: (typeof SAMPLES)[string][number],
): Promise<string | null> {
  const networkId = NETWORK_ENV[chainLabel];
  // Casper reads use the CasperAdapter (env-driven config, no keys needed
  // for reads); EVM chains use EvmAdapter pinned to their LIGIS_NETWORK.
  if (chainLabel === "casper-testnet") {
    return checkCasper(chainLabel, sample);
  }
  if (!networkId) return `no network mapping for ${chainLabel}`;
  return checkEvm(chainLabel, networkId, sample);
}

async function checkCasper(
  chainLabel: string,
  sample: (typeof SAMPLES)[string][number],
): Promise<string | null> {
  const adapter = new CasperAdapter();
  const result = await adapter.verifyCapability({
    subject: sample.subject,
    capability: sample.capability,
  });
  return evaluateResult(chainLabel, sample, result);
}

type VerifyLike = {
  capable: boolean;
  latest: {
    issuer?: string | null;
    revoked?: boolean;
    expiresAt?: bigint | number | string;
  } | null;
};

function evaluateResult(
  chainLabel: string,
  sample: (typeof SAMPLES)[string][number],
  result: VerifyLike,
): string | null {
  const latest = result.latest;
  const now = Math.floor(Date.now() / 1000);
  const expired =
    latest != null &&
    Number(latest.expiresAt) > 0 &&
    Number(latest.expiresAt) < now;

  if (sample.expect === "go") {
    if (!result.capable) {
      return `${chainLabel} · ${sample.label}: expected GO, got STOP (revoked=${latest?.revoked} expired=${expired})`;
    }
    if (expired) {
      return `${chainLabel} · ${sample.label}: GO but expiresAt is in the past — re-seed`;
    }
    // Check self-issued: the demo agent must not self-vouch.
    // EVM: issuer === subject. Casper: the demo subject IS the deployer
    // account-hash, so also compare issuer against the deployer EVM address.
    const issuerLower = latest?.issuer?.toLowerCase();
    const selfIssuedEvm =
      !!issuerLower && issuerLower === sample.subject.toLowerCase();
    const deployerEvm = process.env.LIGIS_CASPER_DEPLOYER_EVM_ADDRESS;
    const selfIssuedCasper =
      chainLabel === "casper-testnet" &&
      !!issuerLower &&
      !!deployerEvm &&
      issuerLower === deployerEvm.toLowerCase();
    if (selfIssuedEvm || selfIssuedCasper) {
      return `${chainLabel} · ${sample.label}: SELF-ISSUED (issuer=${latest?.issuer}) — re-issue with steward key`;
    }
    return null;
  }
  if (sample.expect === "revoked") {
    if (result.capable) {
      return `${chainLabel} · ${sample.label}: expected revoked STOP, got GO — do not re-issue demo.metropolis.revocation`;
    }
    if (!latest?.revoked) {
      return `${chainLabel} · ${sample.label}: expected revoked credential on-chain (revoked=${latest?.revoked})`;
    }
    return null;
  }
  if (result.capable) {
    return `${chainLabel} · ${sample.label}: expected no credential, got GO`;
  }
  return null;
}

async function checkEvm(
  chainLabel: string,
  networkId: string,
  sample: (typeof SAMPLES)[string][number],
): Promise<string | null> {
  const prev = process.env.LIGIS_NETWORK;
  process.env.LIGIS_NETWORK = networkId;
  try {
    const adapter = new EvmAdapter();
    const result = await adapter.verifyCapability({
      subject: sample.subject,
      capability: sample.capability,
    });
    return evaluateResult(chainLabel, sample, result);
  } finally {
    if (prev === undefined) delete process.env.LIGIS_NETWORK;
    else process.env.LIGIS_NETWORK = prev;
  }
}

async function main() {
  const only = process.argv[2]?.toLowerCase();
  // Accept "pharos", "monad", "casper" shorthands plus full chain/network ids.
  const keys = only
    ? Object.keys(SAMPLES).filter(
        (k) =>
          k === only ||
          NETWORK_ENV[k] === only ||
          k.startsWith(only) ||
          k.endsWith(only),
      )
    : Object.keys(SAMPLES);

  if (keys.length === 0) {
    console.error(`Unknown chain filter: ${only}`);
    process.exit(1);
  }

  let failed = 0;
  for (const label of keys) {
    for (const sample of SAMPLES[label]!) {
      try {
        const err = await checkSample(label, sample);
        if (err) {
          console.error(`FAIL  ${err}`);
          failed++;
        } else {
          console.log(
            `ok    ${label} · ${sample.label} (${sample.capability} → ${sample.expect})`,
          );
        }
      } catch (e) {
        console.error(
          `FAIL  ${label} · ${sample.label}: ${e instanceof Error ? e.message : String(e)}`,
        );
        failed++;
      }
    }
  }

  if (failed) {
    console.error(`\nsmoke-demo-credentials: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nsmoke-demo-credentials: all samples match expectations");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
