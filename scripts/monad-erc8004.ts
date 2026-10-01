#!/usr/bin/env tsx
/**
 * Monad Testnet — ERC-8004 integration proof.
 *
 * 1. Registers the Ligis steward on the official ERC-8004 IdentityRegistry
 *    (singleton at 0x8004A818…) with agentURI → ligis.vercel.app/agent-registration.json
 * 2. Registers a demo counterparty agent (the wallet Ligis gates)
 * 3. An oracle wallet writes gate verdicts to the ERC-8004 ReputationRegistry:
 *    isCapable(subject, cap) → giveFeedback(agentId, 100|0, "ligis.gate", cap)
 * 4. Reads the reputation back with getSummary / readAllFeedback
 *
 * Idempotent: registered agentIds are persisted in assets/erc8004-monad-testnet.json
 * so reruns only append new feedback. Set LIGIS_8004_FRESH=1 to re-register.
 *
 * Usage:
 *   set -a && source .env.d/deployer.env && source .env.d/zerog.env && set +a
 *   export PRIVATE_KEY=$PHAROS_DEPLOYER_KEY
 *   npx tsx scripts/monad-erc8004.ts
 *
 * Env:
 *   PRIVATE_KEY              deployer/owner wallet (funds registrations)
 *   LIGIS_8004_FEEDBACK_KEY  oracle wallet that writes feedback (default: ZEROG_PRIVATE_KEY)
 *   LIGIS_8004_FRESH         "1" = mint new agentIds instead of reusing persisted ones
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbiItem,
  parseEther,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capabilityHash } from "@ligis/core";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const STATE_FILE = resolve(
  import.meta.dirname,
  "../assets/erc8004-monad-testnet.json",
);
const LASTRUN_FILE = resolve(import.meta.dirname, "monad-erc8004.lastrun.txt");

const networks = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../assets/networks.json"), "utf8"),
);
const REGISTRY = networks.deployment["monad-testnet"].credentialRegistry as Hex;
const AGENT_URI = "https://ligis.vercel.app/agent-registration.json";

const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
} as const;

const IDENTITY_ABI = [
  parseAbiItem("function register(string agentURI) returns (uint256)"),
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)"),
  parseAbiItem(
    "function getAgentWallet(uint256 agentId) view returns (address)",
  ),
];

const REPUTATION_ABI = [
  parseAbiItem(
    "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  ),
  parseAbiItem(
    "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  ),
];

const REGISTRY_ABI = [
  parseAbiItem(
    "function isCapable(address subject, bytes32 capabilityHash) view returns (bool)",
  ),
];

interface State {
  stewardAgentId?: string;
  counterpartyAgentId?: string;
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function registerAgent(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  agentURI: string,
): Promise<bigint> {
  const hash = await wallet.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [agentURI],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const registeredTopic = keccak256(
    toHex("Registered(uint256,string,address)"),
  );
  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      l.topics[0] === registeredTopic,
  );
  if (!log?.topics[1]) throw new Error("Registered event not found in receipt");
  const agentId = BigInt(log.topics[1]);
  console.log(
    `    ${GREEN}✓${RESET} registered agentId=${agentId} · tx ${hash}`,
  );
  return agentId;
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set (source .env.d/deployer.env)");
  const owner = privateKeyToAccount(pk as Hex);

  const oraclePk =
    process.env.LIGIS_8004_FEEDBACK_KEY ?? process.env.ZEROG_PRIVATE_KEY;
  if (!oraclePk)
    throw new Error(
      "LIGIS_8004_FEEDBACK_KEY or ZEROG_PRIVATE_KEY required (feedback cannot come from the agent owner)",
    );
  const oracle = privateKeyToAccount(oraclePk as Hex);

  const transport = http(
    process.env.LIGIS_RPC_URL ?? monadTestnet.rpcUrls.default.http[0],
  );
  const publicClient = createPublicClient({ chain: monadTestnet, transport });
  const ownerWallet = createWalletClient({
    account: owner,
    chain: monadTestnet,
    transport,
  });
  const oracleWallet = createWalletClient({
    account: oracle,
    chain: monadTestnet,
    transport,
  });

  console.log(
    `${BOLD}${CYAN}Ligis × ERC-8004 — identity + gate-decision reputation on Monad${RESET}\n`,
  );
  console.log(`  IdentityRegistry:   ${IDENTITY_REGISTRY}`);
  console.log(`  ReputationRegistry: ${REPUTATION_REGISTRY}`);
  console.log(`  Owner:              ${owner.address}`);
  console.log(`  Oracle (feedback):  ${oracle.address}`);

  // Fund the oracle if needed (feedback txs need gas).
  const oracleBal = await publicClient.getBalance({ address: oracle.address });
  if (oracleBal < parseEther("0.1")) {
    const fundTx = await ownerWallet.sendTransaction({
      to: oracle.address,
      value: parseEther("0.15"),
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });
    console.log(
      `  ${GREEN}✓${RESET} oracle funded 0.15 MON · tx ${fundTx.slice(0, 14)}…`,
    );
  }

  const fresh = process.env.LIGIS_8004_FRESH === "1";
  const state: State = fresh ? {} : loadState();

  // 1. Steward identity.
  if (!state.stewardAgentId) {
    console.log(`\n  Registering Ligis steward → ${AGENT_URI}`);
    state.stewardAgentId = (
      await registerAgent(ownerWallet, publicClient, AGENT_URI)
    ).toString();
  } else {
    console.log(
      `\n  Steward already registered · agentId=${state.stewardAgentId}`,
    );
  }

  // 2. Demo counterparty — the agent Ligis gates.
  if (!state.counterpartyAgentId) {
    console.log(`  Registering demo counterparty agent`);
    state.counterpartyAgentId = (
      await registerAgent(
        ownerWallet,
        publicClient,
        "https://ligis.vercel.app/agent-registration.json#counterparty",
      )
    ).toString();
  } else {
    console.log(
      `  Counterparty already registered · agentId=${state.counterpartyAgentId}`,
    );
  }

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

  const counterpartyId = BigInt(state.counterpartyAgentId);
  const counterpartyWallet = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "getAgentWallet",
    args: [counterpartyId],
  });
  console.log(`  Counterparty wallet: ${counterpartyWallet}`);

  // 3. Gate decisions → ERC-8004 reputation. One GO, one STOP.
  // Monad testnet feeHistory can return pathological baseFees; cap explicitly.
  const gasPrice = await publicClient.getGasPrice();
  const maxFeePerGas = gasPrice * 2n;
  const maxPriorityFeePerGas = parseEther("2", "gwei");

  const verdicts = [
    { capability: "agent.commerce.escrow", tag2: "agent.commerce.escrow" },
    {
      capability: "demo.metropolis.revocation",
      tag2: "demo.metropolis.revocation",
    },
  ];
  const feedbackTxs: string[] = [];
  for (const v of verdicts) {
    const cap = capabilityHash(v.capability) as Hex;
    const capable = await publicClient.readContract({
      address: REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "isCapable",
      args: [counterpartyWallet, cap],
    });
    const value = capable ? 100n : 0n;
    const hash = await oracleWallet.writeContract({
      address: REPUTATION_REGISTRY,
      abi: REPUTATION_ABI,
      functionName: "giveFeedback",
      args: [
        counterpartyId,
        value,
        0,
        "ligis.gate",
        v.tag2,
        "https://ligis.vercel.app/gate",
        "",
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      ],
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    feedbackTxs.push(hash);
    console.log(
      `  ${GREEN}✓${RESET} isCapable(${v.capability})=${capable} → giveFeedback(value=${value}) · tx ${hash.slice(0, 14)}…`,
    );
  }

  // 4. Read reputation back.
  const [count, summaryValue, summaryDecimals] =
    await publicClient.readContract({
      address: REPUTATION_REGISTRY,
      abi: REPUTATION_ABI,
      functionName: "getSummary",
      args: [counterpartyId, [oracle.address], "ligis.gate", ""],
    });
  console.log(
    `\n  Reputation for agentId=${counterpartyId}: ${count} feedback, summary=${summaryValue} (decimals ${summaryDecimals})`,
  );

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  writeFileSync(
    LASTRUN_FILE,
    [
      `network=monad-testnet`,
      `chainId=${monadTestnet.id}`,
      `identityRegistry=${IDENTITY_REGISTRY}`,
      `reputationRegistry=${REPUTATION_REGISTRY}`,
      `stewardAgentId=${state.stewardAgentId}`,
      `counterpartyAgentId=${state.counterpartyAgentId}`,
      `counterpartyWallet=${counterpartyWallet}`,
      `oracle=${oracle.address}`,
      `feedbackCount=${count}`,
      `summaryValue=${summaryValue}`,
      ...feedbackTxs.map((t, i) => `feedbackTx${i}=${t}`),
      "",
    ].join("\n"),
  );

  console.log(
    `\n${GREEN}${BOLD}ERC-8004 REGISTRATION + GATE-FEEDBACK VERIFIED ON MONAD TESTNET${RESET}`,
  );
  console.log(
    `  stewardAgentId=${state.stewardAgentId} · counterpartyAgentId=${state.counterpartyAgentId}\n`,
  );
}

main().catch((e) => {
  console.error(`${RED}✗${RESET}`, e instanceof Error ? e.message : e);
  process.exit(1);
});
