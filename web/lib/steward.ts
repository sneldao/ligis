import "server-only";
import {
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  publicClient,
  pharosAtlantic,
  addresses,
  capabilities as knownCapabilities,
  isCapableMulti,
  readAgentId,
  type CapabilityRef,
} from "./chain";
import { CREDENTIAL_REGISTRY_ABI, PHAROS_AGENT_ID_ABI } from "@ligis/abi";
import type { StewardEvent } from "./steward-events";

// ---------- Helpers ----------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function encode(event: StewardEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function capabilityHash(name: string): Hex {
  return keccak256(toBytes(name)) as Hex;
}

// ---------- Reasoning (local policy) ----------

const GOAL_KEYWORDS: Array<{ pattern: RegExp; caps: string[] }> = [
  { pattern: /escrow|hold.*fund|custod/i, caps: ["agent.commerce.escrow"] },
  { pattern: /swap|trade|exchange.*token/i, caps: ["agent.commerce.swap"] },
  { pattern: /bridge|cross.chain|transfer.*chain/i, caps: ["agent.commerce.bridge"] },
  { pattern: /recurring|subscription|mandate|recurring.*payment/i, caps: ["agent.commerce.recurring"] },
  { pattern: /x402|http.*payment|pay.*per.*request/i, caps: ["agent.commerce.x402"] },
  { pattern: /kyc|identity.*verif|accred/i, caps: ["kyc.basic"] },
  { pattern: /accredited|investor|rwa|real.*world/i, caps: ["rwa.accredited"] },
  { pattern: /premium.*data|data.*feed|oracle/i, caps: ["data.premium"] },
  { pattern: /cex|retail.*trad|exchange/i, caps: ["trade.cex-retail"] },
];

function localReason(goal: string): { reasoning: string; capabilities: CapabilityRef[] } {
  const matched = new Set<string>();
  for (const { pattern, caps } of GOAL_KEYWORDS) {
    if (pattern.test(goal)) {
      for (const c of caps) matched.add(c);
    }
  }

  if (matched.size === 0) {
    matched.add("agent.commerce.escrow");
    matched.add("agent.commerce.swap");
  }

  const caps = knownCapabilities.filter((c) => matched.has(c.id));
  const reasoning = `The goal calls for an agent that ${goal.toLowerCase().includes("escrow") ? "participates in escrow-backed commerce" : "operates as a Pharos agent"}. Detected capabilities: ${caps.map((c) => c.id).join(", ")}.`;

  return { reasoning, capabilities: caps };
}

// ---------- Wallet client (for write ops) ----------

function getStewardAccount() {
  const key = process.env.LIGIS_STEWARD_KEY as Hex | undefined;
  if (!key) return null;
  return privateKeyToAccount(key);
}

function getWalletClient() {
  const account = getStewardAccount();
  if (!account) return null;
  const rpc = process.env.PHAROS_RPC_URL ?? pharosAtlantic.rpcUrls.default.http[0];
  return {
    client: createWalletClient({ account, transport: http(rpc, { retryCount: 3, timeout: 20_000 }), chain: pharosAtlantic }),
    account,
  };
}

// ---------- Main loop ----------

export async function* stewardLoop(
  goal: string,
  opts: { live: boolean }
): AsyncGenerator<StewardEvent> {
  const { live } = opts;
  let rpcCalls = 0;

  // === 1. BOOT ===
  yield { type: "phase", phase: "BOOT", status: "start" };

  const wallet = getWalletClient();
  const subject = wallet?.account.address ?? ("0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec" as Address);

  let tokenId = "0";
  let minted = false;

  if (live && wallet) {
    const existing = await readAgentId(subject);
    rpcCalls++;
    if (existing === 0n) {
      const hash = await wallet.client.writeContract({
        address: addresses.pharosAgentId,
        abi: PHAROS_AGENT_ID_ABI,
        functionName: "mintSelf",
        args: ["ipfs://steward-agent"],
        chain: pharosAtlantic,
        account: wallet.account.address,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const newId = await readAgentId(subject);
      rpcCalls++;
      tokenId = newId.toString();
      minted = true;
    } else {
      tokenId = existing.toString();
    }
  } else {
    await sleep(450);
    tokenId = "2";
  }

  yield { type: "boot", phase: "BOOT", tokenId, minted };
  yield { type: "phase", phase: "BOOT", status: "done" };

  // === 2. REASON ===
  yield { type: "phase", phase: "REASON", status: "start" };

  const { reasoning, capabilities: requiredCaps } = localReason(goal);

  for (const chunk of reasoning.split(/(\s+)/)) {
    await sleep(35 + Math.random() * 40);
    yield { type: "delta", phase: "REASON", text: chunk };
  }
  await sleep(200);
  yield { type: "phase", phase: "REASON", status: "done" };

  // === 3. GATE ===
  yield { type: "phase", phase: "GATE", status: "start" };

  const hashes = requiredCaps.map((c) => c.hash);
  let capableResults: boolean[];

  if (live) {
    capableResults = await isCapableMulti(subject, hashes).catch(() =>
      requiredCaps.map(() => false)
    );
    rpcCalls++;
  } else {
    await sleep(380);
    capableResults = requiredCaps.map((c) => {
      if (c.id === "agent.commerce.escrow") return true;
      if (c.id === "agent.commerce.swap") return false;
      return false;
    });
  }

  for (let i = 0; i < requiredCaps.length; i++) {
    await sleep(live ? 100 : 380);
    yield {
      type: "capability",
      phase: "GATE",
      name: requiredCaps[i].id,
      hash: requiredCaps[i].hash,
      capable: capableResults[i],
      selfIssued: false,
    };
  }
  yield { type: "phase", phase: "GATE", status: "done" };

  // === 4. ACT — self-issue missing credentials ===
  yield { type: "phase", phase: "ACT", status: "start" };

  let allGated = true;
  const finalCapable: boolean[] = [...capableResults];

  for (let i = 0; i < requiredCaps.length; i++) {
    if (capableResults[i]) continue;

    if (live && wallet) {
      try {
        const issuer = wallet.account.address;
        const capHash = requiredCaps[i].hash;
        const issuedAt = BigInt(Math.floor(Date.now() / 1000));
        const expiresAt = issuedAt + 2592000n;

        const nonce = (await publicClient.readContract({
          address: addresses.credentialRegistry,
          abi: CREDENTIAL_REGISTRY_ABI,
          functionName: "issuerNonce",
          args: [issuer],
        })) as bigint;
        rpcCalls++;

        const digest = (await publicClient.readContract({
          address: addresses.credentialRegistry,
          abi: CREDENTIAL_REGISTRY_ABI,
          functionName: "hashTypedData",
          args: [issuer, subject, capHash, issuedAt, expiresAt, nonce],
        })) as Hex;
        rpcCalls++;

        const signature = await wallet.account.sign({ hash: digest });

        const issueHash = await wallet.client.writeContract({
          address: addresses.credentialRegistry,
          abi: CREDENTIAL_REGISTRY_ABI,
          functionName: "issue",
          args: [issuer, subject, capHash, issuedAt, expiresAt, nonce, signature],
          chain: pharosAtlantic,
          account: wallet.account.address,
        });
        await publicClient.waitForTransactionReceipt({ hash: issueHash });

        finalCapable[i] = true;
        yield {
          type: "capability",
          phase: "GATE",
          name: requiredCaps[i].id,
          hash: requiredCaps[i].hash,
          capable: true,
          selfIssued: true,
          issueTxHash: issueHash,
        };
        yield { type: "tx", phase: "ACT", name: requiredCaps[i].id, txHash: issueHash };
      } catch {
        allGated = false;
        await sleep(300);
      }
    } else {
      await sleep(900);
      const fakeHash = "0x" + Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
      finalCapable[i] = true;
      yield {
        type: "capability",
        phase: "GATE",
        name: requiredCaps[i].id,
        hash: requiredCaps[i].hash,
        capable: true,
        selfIssued: true,
        issueTxHash: fakeHash,
      };
      yield { type: "tx", phase: "ACT", name: requiredCaps[i].id, txHash: fakeHash };
    }
  }

  allGated = finalCapable.every((c) => c);
  yield { type: "phase", phase: "ACT", status: "done" };

  // === 5. RECORD — anchor evidence on-chain ===
  yield { type: "phase", phase: "RECORD", status: "start" };

  let rootHash: string;
  let anchorTx: string;
  let tokenUri: string;
  const storageType: "0g" | "local" = "local";

  if (live && wallet) {
    // Build a local evidence manifest and hash it
    const manifest = {
      version: 1,
      agentId: tokenId,
      controller: subject,
      goal,
      reasoning,
      capabilities: requiredCaps.map((c, i) => ({
        name: c.id,
        hash: c.hash,
        capable: finalCapable[i],
        selfIssued: !capableResults[i] && finalCapable[i],
      })),
      gated: allGated,
      recordedAt: Math.floor(Date.now() / 1000),
    };
    rootHash = keccak256(toBytes(JSON.stringify(manifest))) as string;

    // Anchor via setTokenURI
    tokenUri = `0g://${rootHash.slice(2, 34)}`;
    try {
      const anchorHash = await wallet.client.writeContract({
        address: addresses.pharosAgentId,
        abi: PHAROS_AGENT_ID_ABI,
        functionName: "setTokenURI",
        args: [BigInt(tokenId), tokenUri],
        chain: pharosAtlantic,
        account: wallet.account.address,
      });
      await publicClient.waitForTransactionReceipt({ hash: anchorHash });
      anchorTx = anchorHash;
    } catch {
      anchorTx = "0x0000000000000000000000000000000000000000000000000000000000000000";
    }
  } else {
    await sleep(1400);
    rootHash = "0x" + Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    anchorTx = "0x" + Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    tokenUri = `0g://${rootHash.slice(2, 34)}`;
  }

  yield {
    type: "manifest",
    phase: "RECORD",
    rootHash,
    anchorTx,
    storageType,
    tokenUri,
  };
  yield { type: "phase", phase: "RECORD", status: "done" };

  // === Summary ===
  yield {
    type: "summary",
    ok: true,
    tokenId,
    gated: allGated,
    live,
    rpcCalls,
  };
}

export { encode };
