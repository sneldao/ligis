/**
 * Trust Steward — the autonomous agent loop.
 *
 * boot → reason (0G Compute) → gate (isCapable) → act (self-issue) → record (0G Storage)
 *
 * The Steward depends on three interfaces:
 *   - {@link ClientContext}  — on-chain identity ops (from lib)
 *   - {@link Reasoner}       — TEE-verified LLM inference (from zerog/compute)
 *   - {@link EvidenceStore}  — verifiable evidence storage (from zerog/storage)
 *
 * All three sit behind interfaces so the loop is testable offline with mocks.
 */
import type { Hex } from "viem";
import type { ClientContext } from "../lib/index.js";
import {
  getAgentId,
  issueId,
  signCredential,
  submitCredential,
  updateTokenUri,
  verify,
} from "../lib/index.js";
import type { Reasoner, ReasoningResult } from "../zerog/compute.js";
import type { EvidenceManifest, EvidenceStore, StorageResult } from "../zerog/storage.js";
import {
  buildReasoningPrompt,
  parseReasoning,
  type CapabilitySpec,
} from "./policy.js";

// ---------- Result types ----------

export interface StewardResult {
  ok: boolean;
  booted: { tokenId: string; minted: boolean };
  reasoning: ReasoningResult;
  capabilities: Array<{
    name: string;
    hash: string;
    capable: boolean;
    selfIssued: boolean;
    issueTxHash?: string;
  }>;
  unknownCapabilities: string[];
  gated: boolean;
  action: { type: string; txHashes: string[] };
  storage: { rootHash: string; txHash: string } | null;
  anchored: { tokenId: string; tokenUri: string; txHash: string } | null;
  manifest: EvidenceManifest;
  error?: string;
}

// ---------- Steward ----------

export class TrustSteward {
  constructor(
    private ctx: ClientContext,
    private reasoner: Reasoner,
    private store: EvidenceStore,
  ) {}

  async run(goal: string, opts?: { dryRun?: boolean }): Promise<StewardResult> {
    const dryRun = opts?.dryRun ?? false;

    if (!this.ctx.account) {
      throw new Error("PRIVATE_KEY is not set — the Steward needs a wallet to operate.");
    }
    const controller = this.ctx.account.address;
    const txHashes: string[] = [];

    // 1. BOOT — ensure the agent has a PharosAgentID
    let tokenId: string;
    let minted = false;
    const existingId = await getAgentId(this.ctx, controller);
    if (existingId === 0n) {
      if (dryRun) {
        tokenId = "0";
      } else {
        const issueResult = await issueId(this.ctx, {});
        tokenId = issueResult.tokenId;
        minted = true;
        txHashes.push(issueResult.txHash);
      }
    } else {
      tokenId = existingId.toString();
    }

    // 2. REASON — 0G Compute maps the goal to required capabilities
    let reasoning: ReasoningResult;
    try {
      reasoning = await this.reasoner.reason(buildReasoningPrompt(goal));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(goal, controller, tokenId, minted, txHashes, `reasoning failed: ${message}`);
    }

    // 3. PARSE — extract + validate capabilities from the LLM response
    const parsed = parseReasoning(reasoning.text);

    // 4. GATE — check isCapable for each required capability
    const capResults: StewardResult["capabilities"] = [];
    for (const cap of parsed.capabilities) {
      const check = await verify(this.ctx, { subject: controller, capability: cap.name });
      capResults.push({
        name: cap.name,
        hash: cap.hash,
        capable: check.capable,
        selfIssued: false,
      });
    }

    // 5. ACT — self-issue any missing capabilities
    if (!dryRun) {
      const issuerKey = process.env.PRIVATE_KEY as Hex;
      for (const cap of capResults) {
        if (!cap.capable) {
          try {
            const signed = await signCredential(this.ctx, {
              issuerKey,
              subject: controller,
              capability: cap.name,
            });
            const submitted = await submitCredential(this.ctx, signed);
            cap.selfIssued = true;
            cap.issueTxHash = submitted.txHash;
            txHashes.push(submitted.txHash);
          } catch {
            // self-issue failed for this capability — continue with the rest
          }
        }
      }
    }

    // 6. RE-GATE — verify all capabilities are now held
    let gated = true;
    for (const cap of capResults) {
      if (dryRun) {
        if (!cap.capable) gated = false;
      } else {
        const recheck = await verify(this.ctx, { subject: controller, capability: cap.name });
        if (!recheck.capable) gated = false;
      }
    }

    // 7. RECORD — build evidence manifest, store to 0G, anchor on-chain
    let storage: StorageResult | null = null;
    let anchored: { tokenId: string; tokenUri: string; txHash: string } | null = null;
    let anchoredTokenUri = "";

    if (!dryRun) {
      const manifest = this.buildManifest(
        tokenId, controller, goal, reasoning, capResults, gated, txHashes, "",
      );

      try {
        storage = await this.store.store(manifest);
        anchoredTokenUri = `0g://${storage.rootHash}`;

        const anchorResult = await updateTokenUri(this.ctx, { tokenId, tokenUri: anchoredTokenUri });
        anchored = { tokenId, tokenUri: anchoredTokenUri, txHash: anchorResult.txHash };
        txHashes.push(anchorResult.txHash);
      } catch {
        // storage or anchoring failed — the run still succeeded, evidence is partial
      }
    }

    const finalManifest = this.buildManifest(
      tokenId, controller, goal, reasoning, capResults, gated, txHashes, anchoredTokenUri,
    );

    return {
      ok: true,
      booted: { tokenId, minted },
      reasoning,
      capabilities: capResults,
      unknownCapabilities: parsed.unknown,
      gated,
      action: { type: "self-issue-gate-record", txHashes },
      storage,
      anchored,
      manifest: finalManifest,
    };
  }

  private buildManifest(
    tokenId: string,
    controller: string,
    goal: string,
    reasoning: ReasoningResult,
    capabilities: StewardResult["capabilities"],
    gated: boolean,
    txHashes: string[],
    anchoredTokenUri: string,
  ): EvidenceManifest {
    return {
      version: 1,
      agentId: tokenId,
      controller,
      network: this.ctx.network.name,
      chainId: this.ctx.network.chainId,
      goal,
      reasoning: {
        text: reasoning.text,
        verified: reasoning.verified,
        model: reasoning.model,
        provider: reasoning.provider,
      },
      capabilities,
      action: { type: "self-issue-gate-record", gated, txHashes },
      anchoredTokenUri,
      recordedAt: Math.floor(Date.now() / 1000),
    };
  }

  private fail(
    goal: string,
    controller: string,
    tokenId: string,
    minted: boolean,
    txHashes: string[],
    error: string,
  ): StewardResult {
    const manifest = this.buildManifest(
      tokenId, controller, goal,
      { text: "", verified: false, model: "", provider: "" },
      [], false, txHashes, "",
    );
    return {
      ok: false,
      booted: { tokenId, minted },
      reasoning: { text: "", verified: false, model: "", provider: "" },
      capabilities: [],
      unknownCapabilities: [],
      gated: false,
      action: { type: "self-issue-gate-record", txHashes },
      storage: null,
      anchored: null,
      manifest,
      error,
    };
  }
}
