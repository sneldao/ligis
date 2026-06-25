/**
 * Trust Steward — the autonomous agent loop.
 *
 *   boot → reason → gate → act → record
 *
 * Chain-agnostic. The Steward depends only on three interfaces from
 * @ligis/core: {@link ChainAdapter}, {@link Reasoner}, {@link EvidenceStore}.
 * Swap any of them for a mock to test offline; swap the adapter for a
 * different chain to run the same loop on Casper, EVM, etc.
 */
import type {
  ChainAdapter,
  EvidenceManifest,
  EvidenceStore,
  Reasoner,
  ReasoningResult,
  StorageResult,
} from "@ligis/core";
import { buildReasoningPrompt, parseReasoning } from "./policy.js";

// ---------- Result types ----------

export interface StewardResult {
  ok: boolean;
  booted: { agentId: string; did: string; minted: boolean };
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
  anchored: { agentId: string; tokenUri: string; txHash: string } | null;
  manifest: EvidenceManifest;
  error?: string;
}

// ---------- Steward ----------

export interface StewardRunOpts {
  dryRun?: boolean;
  /**
   * Optional issuer key for self-issuing credentials. Defaults to
   * `process.env.PRIVATE_KEY`. Pulled here (not from the adapter) so that
   * non-Node runtimes can inject it explicitly.
   */
  issuerKey?: string;
}

const ACTION_TYPE = "self-issue-gate-record";

export class TrustSteward {
  constructor(
    private adapter: ChainAdapter,
    private reasoner: Reasoner,
    private store: EvidenceStore,
  ) {}

  async run(goal: string, opts: StewardRunOpts = {}): Promise<StewardResult> {
    const dryRun = opts.dryRun ?? false;
    const controller = this.adapter.walletAddress();
    if (!controller) {
      throw new Error("Adapter has no wallet — the Steward needs a signing key to operate.");
    }

    const txHashes: string[] = [];

    // 1. BOOT — ensure the agent has an on-chain identity
    let agentId: string;
    let minted = false;
    const existingId = await this.adapter.getAgentId(controller);
    if (existingId === null) {
      if (dryRun) {
        agentId = "0";
      } else {
        const res = await this.adapter.issueAgentId();
        agentId = res.agentId;
        minted = true;
        txHashes.push(res.tx.hash);
      }
    } else {
      agentId = existingId;
    }
    const did = `did:ligis:${this.adapter.chainId}:${agentId}`;

    // 2. REASON — map the natural-language goal to required capabilities
    let reasoning: ReasoningResult;
    try {
      reasoning = await this.reasoner.reason(buildReasoningPrompt(goal));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(goal, controller, agentId, did, minted, txHashes, `reasoning failed: ${message}`);
    }

    // 3. PARSE — extract + validate against known capabilities
    const parsed = parseReasoning(reasoning.text);

    // 4. GATE — check capability for each required cap
    const capResults: StewardResult["capabilities"] = [];
    for (const cap of parsed.capabilities) {
      const check = await this.adapter.verifyCapability({ subject: controller, capability: cap.name });
      capResults.push({
        name: cap.name,
        hash: cap.hash,
        capable: check.capable,
        selfIssued: false,
      });
    }

    // 5. ACT — self-issue any missing capabilities
    if (!dryRun) {
      const issuerKey = opts.issuerKey ?? process.env.PRIVATE_KEY;
      if (!issuerKey) {
        return this.fail(goal, controller, agentId, did, minted, txHashes,
          "PRIVATE_KEY not set — cannot self-issue credentials.");
      }
      for (const cap of capResults) {
        if (cap.capable) continue;
        try {
          const signed = await this.adapter.signCredential({
            issuerKey,
            subject: controller,
            capability: cap.name,
          });
          const submitted = await this.adapter.submitCredential(signed);
          cap.selfIssued = true;
          cap.issueTxHash = submitted.tx.hash;
          txHashes.push(submitted.tx.hash);
        } catch {
          // self-issue failed for this capability — continue with the rest
        }
      }
    }

    // 6. RE-GATE — verify all required capabilities are now held
    let gated = true;
    for (const cap of capResults) {
      if (dryRun) {
        if (!cap.capable) gated = false;
      } else {
        const recheck = await this.adapter.verifyCapability({ subject: controller, capability: cap.name });
        if (!recheck.capable) gated = false;
      }
    }

    // 7. RECORD — build manifest, persist, anchor on-chain
    let storage: StorageResult | null = null;
    let anchored: StewardResult["anchored"] = null;
    let anchoredTokenUri = "";

    if (!dryRun) {
      const manifest = this.buildManifest(
        agentId, did, controller, goal, reasoning, capResults, gated, txHashes, "",
      );
      try {
        storage = await this.store.store(manifest);
        anchoredTokenUri = `0g://${storage.rootHash}`;
        const anchor = await this.adapter.anchorEvidence({ agentId, uri: anchoredTokenUri });
        anchored = { agentId, tokenUri: anchoredTokenUri, txHash: anchor.tx.hash };
        txHashes.push(anchor.tx.hash);
      } catch {
        // storage or anchoring failed — the run still succeeded, evidence is partial
      }
    }

    const finalManifest = this.buildManifest(
      agentId, did, controller, goal, reasoning, capResults, gated, txHashes, anchoredTokenUri,
    );

    return {
      ok: true,
      booted: { agentId, did, minted },
      reasoning,
      capabilities: capResults,
      unknownCapabilities: parsed.unknown,
      gated,
      action: { type: ACTION_TYPE, txHashes },
      storage,
      anchored,
      manifest: finalManifest,
    };
  }

  private buildManifest(
    agentId: string,
    did: string,
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
      agentId,
      did,
      controller,
      chainId: this.adapter.chainId,
      chainName: this.adapter.chainName,
      goal,
      reasoning: {
        text: reasoning.text,
        verified: reasoning.verified,
        model: reasoning.model,
        provider: reasoning.provider,
      },
      capabilities,
      action: { type: ACTION_TYPE, gated, txHashes },
      anchoredTokenUri,
      recordedAt: Math.floor(Date.now() / 1000),
    };
  }

  private fail(
    goal: string,
    controller: string,
    agentId: string,
    did: string,
    minted: boolean,
    txHashes: string[],
    error: string,
  ): StewardResult {
    const empty: ReasoningResult = { text: "", verified: false, model: "", provider: "" };
    const manifest = this.buildManifest(agentId, did, controller, goal, empty, [], false, txHashes, "");
    return {
      ok: false,
      booted: { agentId, did, minted },
      reasoning: empty,
      capabilities: [],
      unknownCapabilities: [],
      gated: false,
      action: { type: ACTION_TYPE, txHashes },
      storage: null,
      anchored: null,
      manifest,
      error,
    };
  }
}
