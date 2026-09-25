#!/usr/bin/env tsx
/**
 * Seed enough AgentId mints for the field to feel populated.
 *
 * When totalSupply < TARGET, mints AgentIds for deterministic demo
 * controllers via AgentId.mint(controller, uri). Idempotent: skips
 * addresses that already have an ID.
 *
 * Usage:
 *   set -a && source .env.d/deployer.env && set +a
 *   npx tsx scripts/seed-field-agents.ts              # pharos + monad
 *   npx tsx scripts/seed-field-agents.ts monad        # one network
 *   LIGIS_FIELD_TARGET=24 npx tsx scripts/seed-field-agents.ts pharos
 */
import { existsSync, readFileSync } from "node:fs";
import { capabilityHash } from "@ligis/core";
import { EvmAdapter, PHAROS_AGENT_ID_ABI } from "@ligis/adapter-evm";

const TARGET = Number(process.env.LIGIS_FIELD_TARGET ?? 24);

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

/** Deterministic demo controller — not a key we hold; mint-for-others path. */
function demoController(i: number): `0x${string}` {
  const hash = capabilityHash(
    `ligis:field-seed:${i.toString().padStart(3, "0")}`,
  );
  return `0x${hash.slice(-40)}` as `0x${string}`;
}

async function seedNetwork(network: string, privateKey: string) {
  process.env.LIGIS_NETWORK = network;
  process.env.PRIVATE_KEY = privateKey;
  const adapter = new EvmAdapter();
  const { publicClient, deployment } = adapter.ctx;
  const self = adapter.walletAddress();
  if (!self) throw new Error(`${network}: adapter has no wallet`);

  const supply = (await publicClient.readContract({
    address: deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "totalSupply",
    args: [],
  })) as bigint;

  console.log(
    `\n== ${adapter.chainName} · supply ${supply} · target ${TARGET}`,
  );

  if (supply >= BigInt(TARGET)) {
    console.log(`  already at density (${supply} ≥ ${TARGET}) — skip`);
    return;
  }

  const selfId = await adapter.getAgentId(self);
  if (!selfId) {
    const minted = await adapter.issueAgentId({
      tokenUri: "ligis://field/deployer",
    });
    console.log(`  deployer mint → #${minted.agentId} · ${minted.tx.hash}`);
  } else {
    console.log(`  deployer already #${selfId}`);
  }

  let minted = 0;
  let i = 1;
  while (true) {
    const current = (await publicClient.readContract({
      address: deployment.pharosAgentId,
      abi: PHAROS_AGENT_ID_ABI,
      functionName: "totalSupply",
      args: [],
    })) as bigint;
    if (current >= BigInt(TARGET)) break;
    if (i > TARGET * 3) {
      console.log(`  stopping after ${i} probes (gaps / already minted)`);
      break;
    }
    const controller = demoController(i);
    i++;
    const existing = await adapter.getAgentId(controller);
    if (existing) continue;
    const res = await adapter.issueAgentId({
      controller,
      tokenUri: `ligis://field/demo/${i - 1}`,
    });
    minted++;
    console.log(
      `  mint ${i - 1} → ${controller.slice(0, 10)}… #${res.agentId} · ${res.tx.hash}`,
    );
  }

  const after = (await publicClient.readContract({
    address: deployment.pharosAgentId,
    abi: PHAROS_AGENT_ID_ABI,
    functionName: "totalSupply",
    args: [],
  })) as bigint;
  console.log(`  done · supply now ${after} · minted this run ${minted}`);
}

async function main() {
  loadEnvFiles(".env.d/deployer.env", ".env.d/casper.env");
  const key = process.env.PHAROS_DEPLOYER_KEY ?? process.env.PRIVATE_KEY;
  if (!key)
    throw new Error("PHAROS_DEPLOYER_KEY not set (.env.d/deployer.env)");

  const only = process.argv[2];
  const networks =
    only === "monad" || only === "monad-testnet"
      ? ["monad-testnet"]
      : only === "pharos" || only === "atlantic-testnet"
        ? ["atlantic-testnet"]
        : ["atlantic-testnet", "monad-testnet"];

  for (const network of networks) {
    await seedNetwork(network, key);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
