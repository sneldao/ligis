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
import { EvmAdapter } from "@ligis/adapter-evm";

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
      label: "unverified wallet",
      subject: "0x000000000000000000000000000000000000dEaD",
      capability: "kyc.basic",
      expect: "none",
    },
  ],
};

const NETWORK_ENV: Record<string, string> = {
  "pharos-atlantic": "atlantic-testnet",
  "monad-testnet": "monad-testnet",
};

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
  } finally {
    if (prev === undefined) delete process.env.LIGIS_NETWORK;
    else process.env.LIGIS_NETWORK = prev;
  }
}

async function main() {
  const only = process.argv[2];
  const keys = only
    ? Object.keys(SAMPLES).filter((k) => k === only || NETWORK_ENV[k] === only)
    : Object.keys(SAMPLES);

  if (keys.length === 0) {
    console.error(`Unknown chain filter: ${only}`);
    process.exit(1);
  }

  let failed = 0;
  for (const label of keys) {
    const networkId = NETWORK_ENV[label];
    if (!networkId) continue;
    for (const sample of SAMPLES[label]) {
      try {
        const err = await checkEvm(label, networkId, sample);
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
