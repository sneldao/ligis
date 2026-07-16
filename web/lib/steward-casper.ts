// @ts-nocheck — server-only file that tsc walks via web/app/api/steward/route.ts.
// Reasoning: tsc follows the import graph even with exclude patterns; this
// module imports @ligis/agent-logic + @ligis/zerog (Node-only resolvers not
// in web/tsconfig paths), so typechecking transitively fails on the route
// handler. The pragma is a TypeScript compiler hint only — Next.js's SWC
// strips it, so runtime is unaffected.
/**
 * Casper Steward Loop — web streaming version.
 *
 * Mirrors the event protocol of web/lib/steward.ts but uses the CasperAdapter
 * instead of viem/EVM. Emits the same event types so StewardRunner.tsx can
 * consume both without modification.
 *
 * Events: boot, phase, delta, capability, tx, manifest, summary, error
 */
import "server-only";
import { CasperAdapter } from "@ligis/adapter-casper";
import { KNOWN_CAPABILITIES, buildReasoningPrompt, parseReasoning } from "@ligis/agent-logic";
import { ZeroGCompute, ZeroGStorage, loadZeroGConfig, loadZeroGStorageConfig } from "@ligis/zerog";
import { CASPER_TESTNET } from "./network";

const EXPLORER = CASPER_TESTNET.explorerUrl;
const CHAIN_NAME = CASPER_TESTNET.chainName ?? "casper-test";

// ---------- Types ----------

export interface StewardEvent {
  type: string;
  [key: string]: unknown;
}

export interface StewardOpts {
  live?: boolean;
  clientIp?: string;
}

// ---------- Helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function encode(event: StewardEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}

// ---------- Local reasoning (fallback) ----------

const GOAL_KEYWORDS: Array<{ pattern: RegExp; caps: string[] }> = [
  { pattern: /escrow|hold.*fund|custod/i, caps: ["agent.commerce.escrow"] },
  { pattern: /swap|trade|exchange.*token/i, caps: ["agent.commerce.swap"] },
  { pattern: /bridge|cross.chain|transfer.*chain/i, caps: ["agent.commerce.bridge"] },
  { pattern: /recurring|subscription|mandate|recurring.*payment/i, caps: ["agent.commerce.recurring"] },
  { pattern: /x402|http.*payment|pay.*per.*request/i, caps: ["agent.commerce.x402"] },
  { pattern: /kyc|identity.*verif|accred/i, caps: ["kyc.basic"] },
  { pattern: /accredited|investor|rwa|real.*world/i, caps: ["rwa.accredited"] },
  { pattern: /premium.*data|data.*feed|oracle|market.*data/i, caps: ["data.premium"] },
  { pattern: /cex|retail.*trad|exchange/i, caps: ["trade.cex-retail"] },
];

function localReason(goal: string) {
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
  const caps = KNOWN_CAPABILITIES.filter((c) => matched.has(c.name));
  const reasoning = `The goal calls for a Casper agent. Detected capabilities: ${caps.map((c) => c.name).join(", ")}.`;
  return { reasoning, capabilities: caps };
}

// ---------- Main loop ----------

export async function* stewardLoopCasper(
  goal: string,
  opts: StewardOpts = {},
): AsyncGenerator<StewardEvent> {
  const live = opts.live ?? false;
  const canWrite = live && !!process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY;

  // === 1. BOOT ===
  yield { type: "phase", phase: "BOOT", status: "start" };

  const adapter = new CasperAdapter();
  const controller = adapter.walletAddress() ?? "(unset)";
  let tokenId = "0";
  let minted = false;
  let subject = controller;

  if (canWrite) {
    try {
      const result = await adapter.issueAgentId({});
      tokenId = String(result.agentId);
      minted = true;
      subject = controller;
      yield { type: "tx", phase: "BOOT", name: "mint_self", txHash: result.tx.hash };
    } catch (err) {
      yield { type: "error", message: `Boot failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
  } else {
    await sleep(450);
    tokenId = String(Math.floor(Math.random() * 100) + 1);
    minted = true;
  }

  yield { type: "boot", phase: "BOOT", tokenId, minted, subject };
  yield { type: "phase", phase: "BOOT", status: "done" };

  // === 2. REASON ===
  yield { type: "phase", phase: "REASON", status: "start" };

  let reasoning: string;
  let requiredCaps = KNOWN_CAPABILITIES.slice(0, 2);

  const hasZeroG = !!process.env.ZEROG_PRIVATE_KEY;

  if (live && hasZeroG) {
    try {
      const zerog = new ZeroGCompute(loadZeroGConfig());
      const prompt = buildReasoningPrompt(goal);
      const result = await Promise.race([
        zerog.reason(prompt),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
      const parsed = parseReasoning(result.text);
      reasoning = parsed.reasoning || result.text;
      requiredCaps = parsed.capabilities.length > 0 ? parsed.capabilities : requiredCaps;
    } catch (err) {
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

  const capResults: Array<{ name: string; hash: string; capable: boolean; selfIssued: boolean; issueTxHash?: string }> = [];
  let allGated = true;

  for (const cap of requiredCaps) {
    let capable = false;
    if (canWrite) {
      try {
        const check = await adapter.verifyCapability({ subject, capability: cap.name });
        capable = check.capable;
      } catch {
        capable = false;
      }
    } else {
      await sleep(200);
      capable = false;
    }
    if (!capable) allGated = false;
    capResults.push({ name: cap.name, hash: cap.hash, capable, selfIssued: false });
    yield {
      type: "capability",
      phase: "GATE",
      name: cap.name,
      hash: cap.hash,
      capable,
      selfIssued: false,
    };
  }

  yield { type: "phase", phase: "GATE", status: "done" };

  // === 4. ACT ===
  yield { type: "phase", phase: "ACT", status: "start" };

  const issuerKey = process.env.LIGIS_CASPER_DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;

  for (let i = 0; i < capResults.length; i++) {
    const cap = capResults[i];
    if (cap.capable) continue;

    if (canWrite && issuerKey) {
      try {
        const signed = await adapter.signCredential({
          issuerKey,
          subject,
          capability: cap.name,
        });
        const submitted = await adapter.submitCredential(signed);
        cap.selfIssued = true;
        cap.capable = true;
        cap.issueTxHash = submitted.tx.hash;
        yield {
          type: "capability",
          phase: "ACT",
          name: cap.name,
          hash: cap.hash,
          capable: true,
          selfIssued: true,
          issueTxHash: submitted.tx.hash,
        };
        yield { type: "tx", phase: "ACT", name: cap.name, txHash: submitted.tx.hash };
      } catch (err) {
        yield { type: "error", message: `Failed to issue ${cap.name}: ${err instanceof Error ? err.message : String(err)}` };
      }
    } else {
      await sleep(300);
      const fakeHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      cap.selfIssued = true;
      cap.capable = true;
      cap.issueTxHash = fakeHash;
      yield {
        type: "capability",
        phase: "ACT",
        name: cap.name,
        hash: cap.hash,
        capable: true,
        selfIssued: true,
        issueTxHash: fakeHash,
      };
      yield { type: "tx", phase: "ACT", name: cap.name, txHash: fakeHash };
    }
  }

  allGated = capResults.every((c) => c.capable);
  yield { type: "phase", phase: "ACT", status: "done" };

  // === 5. RECORD ===
  yield { type: "phase", phase: "RECORD", status: "start" };

  let rootHash = "0x" + "0".repeat(64);
  let anchorTx = "0x" + "0".repeat(64);
  let tokenUri = "";
  let storageType: "0g" | "local" = "local";

  if (canWrite) {
    try {
      // Build manifest matching EvidenceManifest interface
      const manifest = {
        version: 1 as const,
        agentId: tokenId,
        did: `did:ligis:casper-testnet:${tokenId}`,
        controller: subject,
        chainId: "casper-testnet",
        chainName: "Casper Testnet",
        goal,
        reasoning: {
          text: reasoning,
          verified: false,
          model: "local-keyword-match",
          provider: "local",
        },
        capabilities: capResults.map((c) => ({
          name: c.name,
          hash: c.hash,
          capable: c.capable,
          selfIssued: c.selfIssued,
          issueTxHash: c.issueTxHash,
        })),
        action: {
          type: "self-issue-gate-record",
          gated: allGated,
          txHashes: capResults.map((c) => c.issueTxHash).filter(Boolean) as string[],
        },
        anchoredTokenUri: "",
        recordedAt: Math.floor(Date.now() / 1000),
      };

      // Upload to 0G Storage
      try {
        const store = new ZeroGStorage(loadZeroGStorageConfig());
        const uploadResult = await store.store(manifest);
        rootHash = uploadResult.rootHash;
        storageType = "0g";
      } catch (err) {
        // Storage failed — continue with local
      }

      // Anchor on Casper
      try {
        const anchorResult = await adapter.anchorEvidence({
          agentId: tokenId,
          uri: `0g://${rootHash}`,
        });
        anchorTx = anchorResult.tx.hash;
        tokenUri = `0g://${rootHash}`;
      } catch (err) {
        // Anchor failed — continue
      }
    } catch (err) {
      // Record phase failed — continue
    }
  } else {
    await sleep(500);
    rootHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    anchorTx = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    tokenUri = `0g://${rootHash}`;
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
    rpcCalls: capResults.length * 2,
    subject,
  };
}

export { encode };
