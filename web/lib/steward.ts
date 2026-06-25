import "server-only";
import { createRequire } from "module";
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
import { CREDENTIAL_REGISTRY_ABI, PHAROS_AGENT_ID_ABI } from "@ligis/adapter-evm";
import type { StewardEvent } from "./steward-events";

// 0G SDKs (CJS — use createRequire for ESM compat)
const require = createRequire(import.meta.url);

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

// ---------- Reasoning prompt (shared with CLI policy) ----------

function buildReasoningPrompt(goal: string): string {
  const capList = knownCapabilities
    .map((c) => `  - ${c.id}: ${c.label}`)
    .join("\n");

  return `You are a Trust Steward agent on the Pharos Network. Given a natural-language goal, determine which capabilities are required to accomplish it.

Available capabilities:
${capList}

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "capabilities": ["agent.commerce.escrow", ...],
  "reasoning": "brief explanation of why these capabilities are required"
}

Only include capabilities from the list above. If no capabilities are needed, return an empty array.

Goal: ${goal}`;
}

function extractJson(text: string): { capabilities?: unknown; reasoning?: unknown } | null {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]); } catch {} }
  return null;
}

function parseReasoning(text: string, goal: string): { reasoning: string; capabilities: CapabilityRef[] } {
  const json = extractJson(text);
  if (!json) return { reasoning: text, capabilities: [] };
  const rawCaps: string[] = Array.isArray(json.capabilities) ? json.capabilities as string[] : [];
  const reasoning: string = typeof json.reasoning === "string" ? json.reasoning : "";
  const caps = knownCapabilities.filter((c) => rawCaps.includes(c.id));
  if (caps.length === 0) {
    const fallback = knownCapabilities.filter((c) => {
      const kw = c.id.split(".").pop() ?? "";
      return goal.toLowerCase().includes(kw);
    });
    return { reasoning: reasoning || text, capabilities: fallback.length > 0 ? fallback : knownCapabilities.slice(3, 5) };
  }
  return { reasoning, capabilities: caps };
}

// ---------- Local reasoning (fallback when 0G Compute is unavailable) ----------

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

// ---------- 0G Compute (reasoning) ----------

let computeBroker: any = null;
let computeMetadata: { endpoint: string; model: string } | null = null;

async function zeroGReason(prompt: string): Promise<{ text: string; verified: boolean; model: string }> {
  const { ethers } = await import("ethers");
  const privateKey = process.env.ZEROG_PRIVATE_KEY;
  if (!privateKey) throw new Error("ZEROG_PRIVATE_KEY not set");
  const rpcUrl = process.env.ZEROG_RPC_URL || "https://evmrpc-testnet.0g.ai";
  const provider = process.env.ZEROG_PROVIDER || "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08";

  if (!computeBroker) {
    const { createZGComputeNetworkBroker } = require("@0gfoundation/0g-compute-ts-sdk");
    const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, rpcProvider);
    computeBroker = await createZGComputeNetworkBroker(wallet);
  }

  if (!computeMetadata) {
    computeMetadata = await computeBroker.inference.getServiceMetadata(provider);
  }
  const meta = computeMetadata!;

  const headers = await computeBroker.inference.getRequestHeaders(provider);
  const response = await fetch(`${meta.endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: headers.Authorization },
    body: JSON.stringify({ model: meta.model, messages: [{ role: "user", content: prompt }] }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`0G inference failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
  }

  const completion = await response.json() as any;
  const text: string = completion.choices?.[0]?.message?.content ?? "";
  const chatID = response.headers.get("ZG-Res-Key") || completion.id;
  const usage = completion.usage ? JSON.stringify(completion.usage) : "";
  const verified = await computeBroker.inference.processResponse(provider, chatID, usage);

  return { text, verified: verified === true, model: meta.model };
}

// ---------- 0G Storage (evidence) ----------

async function zeroGStore(manifest: object): Promise<{ rootHash: string; txHash: string }> {
  const { ethers } = await import("ethers");
  const { Indexer, MemData } = await import("@0gfoundation/0g-storage-ts-sdk");
  const privateKey = process.env.ZEROG_PRIVATE_KEY;
  if (!privateKey) throw new Error("ZEROG_PRIVATE_KEY not set");
  const evmRpc = process.env.ZEROG_RPC_URL || "https://evmrpc-testnet.0g.ai";
  const indexerRpc = process.env.ZEROG_INDEXER_RPC || "https://indexer-storage-testnet-turbo.0g.ai";

  const provider = new ethers.JsonRpcProvider(evmRpc);
  const signer = new ethers.Wallet(privateKey, provider);
  const indexer = new Indexer(indexerRpc);

  const data = new TextEncoder().encode(JSON.stringify(manifest));
  const memData = new MemData(data);

  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null) throw new Error(`0G Storage merkle tree error: ${treeErr}`);

  const [tx, uploadErr] = await indexer.upload(memData, evmRpc, signer as any);
  if (uploadErr !== null) throw new Error(`0G Storage upload error: ${uploadErr}`);

  if ("rootHash" in tx) return { rootHash: tx.rootHash, txHash: tx.txHash };
  return { rootHash: tx.rootHashes[0], txHash: tx.txHashes[0] };
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

/**
 * Write to a contract by signing locally and sending via sendRawTransaction.
 * This bypasses eth_sendTransaction (not supported by some Pharos RPCs).
 */
async function sendWriteContract(
  wallet: NonNullable<ReturnType<typeof getWalletClient>>,
  params: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }
): Promise<Hex> {
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi: params.abi as any, functionName: params.functionName, args: params.args as any });

  // Estimate gas via public client
  const gas = await publicClient.estimateGas({
    account: wallet.account.address,
    to: params.address,
    data,
  }).catch(() => 200000n);

  // Sign transaction locally
  const serialized = await wallet.account.signTransaction({
    chainId: pharosAtlantic.id,
    to: params.address,
    data,
    gas,
    maxFeePerGas: 11000000000n,
    maxPriorityFeePerGas: 1100000000n,
  });

  // Send raw transaction via public client (uses eth_sendRawTransaction)
  return publicClient.sendRawTransaction({ serializedTransaction: serialized });
}

// ---------- Rate limiting (in-memory, per-IP) ----------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_LIVE = 3;
const liveHits = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (liveHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_LIVE) return false;
  hits.push(now);
  liveHits.set(ip, hits);
  return true;
}

// ---------- Main loop ----------

export async function* stewardLoop(
  goal: string,
  opts: { live: boolean; clientIp?: string }
): AsyncGenerator<StewardEvent> {
  const { live } = opts;
  let rpcCalls = 0;

  // Live writes require a dedicated steward wallet — separate from deployer.
  // Live reads (GATE) work without any key.
  const wallet = getWalletClient();
  const canWrite = live && wallet !== null;

  // Rate-limit live writes: max 3 runs/min per IP
  if (canWrite && opts.clientIp && !checkRateLimit(opts.clientIp)) {
    yield { type: "error", message: "Rate limit: too many live runs. Try again in a minute." };
    return;
  }

  // Subject address: use steward wallet if available, otherwise read-only mode
  // uses the wallet address if provided, or falls back to a query param.
  const subject = wallet?.account.address ?? ("0xd21a4c7ab1a52a2Ab48A6f0271984d5c3D4027Ec" as Address);

  let tokenId = "0";
  let minted = false;

  if (canWrite) {
    const existing = await readAgentId(subject);
    rpcCalls++;
    if (existing === 0n) {
      const hash = await sendWriteContract(wallet!, {
        address: addresses.pharosAgentId,
        abi: PHAROS_AGENT_ID_ABI,
        functionName: "mintSelf",
        args: ["ipfs://steward-agent"],
      });
      await publicClient.waitForTransactionReceipt({ hash });
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

  yield { type: "boot", phase: "BOOT", tokenId, minted, subject };
  yield { type: "phase", phase: "BOOT", status: "done" };

  // === 2. REASON ===
  yield { type: "phase", phase: "REASON", status: "start" };

  let reasoning: string;
  let requiredCaps: CapabilityRef[];

  const hasZeroG = !!process.env.ZEROG_PRIVATE_KEY;

  if (live && hasZeroG) {
    // 0G Compute: TEE-verified LLM inference
    try {
      const prompt = buildReasoningPrompt(goal);
      const result = await zeroGReason(prompt);
      const parsed = parseReasoning(result.text, goal);
      reasoning = parsed.reasoning || result.text;
      requiredCaps = parsed.capabilities;
    } catch (err) {
      // Fallback to local policy if 0G Compute fails
      reasoning = `(0G Compute unavailable: ${err instanceof Error ? err.message : String(err)}. Using local policy.) `;
      const fallback = localReason(goal);
      reasoning += fallback.reasoning;
      requiredCaps = fallback.capabilities;
    }
  } else {
    const fallback = localReason(goal);
    reasoning = fallback.reasoning;
    requiredCaps = fallback.capabilities;
  }

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
    // GATE is read-only — works even without a wallet key
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

    if (canWrite) {
      try {
        const issuer = wallet!.account.address;
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

        const issueHash = await sendWriteContract(wallet!, {
          address: addresses.credentialRegistry,
          abi: CREDENTIAL_REGISTRY_ABI,
          functionName: "issue",
          args: [issuer, subject, capHash, issuedAt, expiresAt, nonce, signature],
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
  let storageType: "0g" | "local" = "local";

  if (canWrite) {
    // Build evidence manifest
    const manifest = {
      version: 1,
      agentId: tokenId,
      controller: subject,
      network: pharosAtlantic.name,
      chainId: pharosAtlantic.id,
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

    // Try 0G Storage first, fall back to local hash
    if (process.env.ZEROG_PRIVATE_KEY) {
      try {
        const stored = await zeroGStore(manifest);
        rootHash = stored.rootHash;
        tokenUri = `0g://${stored.rootHash}`;
        storageType = "0g";
      } catch {
        rootHash = keccak256(toBytes(JSON.stringify(manifest))) as string;
        tokenUri = `0g://${rootHash.slice(2, 34)}`;
      }
    } else {
      rootHash = keccak256(toBytes(JSON.stringify(manifest))) as string;
      tokenUri = `0g://${rootHash.slice(2, 34)}`;
    }

    // Anchor via setTokenURI
    try {
      const anchorHash = await sendWriteContract(wallet!, {
        address: addresses.pharosAgentId,
        abi: PHAROS_AGENT_ID_ABI,
        functionName: "setTokenURI",
        args: [BigInt(tokenId), tokenUri],
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
    live: canWrite,
    rpcCalls,
    subject,
  };
}

export { encode };
