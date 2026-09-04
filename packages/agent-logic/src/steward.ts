/**
 * Trust Steward — the autonomous agent loop.
 *
 *   boot → reason → risk → gate → act → record
 *
 * Chain-agnostic. The Steward depends only on interfaces from @ligis/core:
 * {@link ChainAdapter}, {@link Reasoner}, {@link EvidenceStore}, and any
 * number of {@link RiskProvider}s. Swap any of them for a mock to test
 * offline; swap the adapter for a different chain to run the same loop on
 * Casper, EVM, etc.
 *
 * The run produces a {@link TrustDecision}: a provider-agnostic signal ledger
 * (identity, risk, capability) folded into one GO/STOP verdict with the
 * evidence manifest as its receipt.
 */
import type {
  ChainAdapter,
  EvidenceManifest,
  EvidenceStore,
  Reasoner,
  ReasoningResult,
  RiskProvider,
  RiskProviderInput,
  StorageResult,
  TrustDecision,
  TrustDecisionSummary,
  TrustSignal,
} from "@ligis/core";
import { TRUST_DECISION_TTL_SECONDS } from "@ligis/core";
import {
  buildReasoningPrompt,
  findCapability,
  parseReasoning,
} from "./policy.js";

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
    error?: string;
  }>;
  unknownCapabilities: string[];
  gated: boolean;
  action: { type: string; txHashes: string[] };
  storage: { rootHash: string; txHash: string } | null;
  anchored: { agentId: string; tokenUri: string; txHash: string } | null;
  manifest: EvidenceManifest;
  counterparty?: string;
  /** Signal ledger behind the decision (identity, risk, capability). */
  signals: TrustSignal[];
  /** The GO/STOP trust decision; `receipt` is the manifest above. */
  decision: TrustDecision;
  error?: string;
}

// ---------- Steward ----------

export interface StewardRunOpts {
  dryRun?: boolean;
  /** Optional counterparty to run risk providers against before gating. */
  counterparty?: string;
  /** Optional payment amount, recorded on the decision and passed to providers. */
  amount?: string;
  /** Explicit capability to gate on, in addition to any reasoned capabilities. */
  capability?: string;
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
    private riskProviders: RiskProvider[] = [],
  ) {}

  async run(goal: string, opts: StewardRunOpts = {}): Promise<StewardResult> {
    const dryRun = opts.dryRun ?? false;
    const counterparty = opts.counterparty;
    const controller = this.adapter.walletAddress();
    if (!controller) {
      throw new Error(
        "Adapter has no wallet — the Steward needs a signing key to operate.",
      );
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

    const identitySignal: TrustSignal = {
      kind: "identity",
      source: this.adapter.chainId,
      verdict: "go",
      confidence: 100,
      metadata: { agentId, did, minted },
    };

    // 2. REASON — map the natural-language goal to required capabilities
    let reasoning: ReasoningResult;
    try {
      reasoning = await this.reasoner.reason(buildReasoningPrompt(goal));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(
        goal,
        controller,
        agentId,
        did,
        minted,
        txHashes,
        [identitySignal],
        counterparty,
        `reasoning failed: ${message}`,
      );
    }

    // 3. PARSE — extract + validate against known capabilities, then merge
    // any capability the caller gated on explicitly.
    const parsed = parseReasoning(reasoning.text);
    const requiredCaps = [...parsed.capabilities];
    const unknownCapabilities = [...parsed.unknown];
    if (opts.capability) {
      const spec = findCapability(opts.capability);
      if (spec && !requiredCaps.some((c) => c.name === spec.name)) {
        requiredCaps.push(spec);
      } else if (!spec) {
        unknownCapabilities.push(opts.capability);
      }
    }

    // 4. RISK — run every provider in parallel against the counterparty.
    // A provider that throws becomes a stop signal: a failed risk check
    // blocks the payment rather than silently passing it.
    const riskSignals: TrustSignal[] = [];
    if (counterparty && this.riskProviders.length > 0) {
      const input: RiskProviderInput = {
        counterparty,
        intent: goal,
        ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
        ...(opts.capability !== undefined
          ? { capability: opts.capability }
          : {}),
      };
      const signals = await Promise.all(
        this.riskProviders.map(async (provider): Promise<TrustSignal> => {
          try {
            return await provider.resolve(input);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              kind: "risk",
              source: provider.name,
              verdict: "stop",
              confidence: 0,
              metadata: { providerFailed: true, error: message },
            };
          }
        }),
      );
      riskSignals.push(...signals);
    }

    // 5. GATE — check capability for each required cap
    const capResults: StewardResult["capabilities"] = [];
    for (const cap of requiredCaps) {
      const check = await this.adapter.verifyCapability({
        subject: controller,
        capability: cap.name,
      });
      capResults.push({
        name: cap.name,
        hash: cap.hash,
        capable: check.capable,
        selfIssued: false,
      });
    }

    // 6. ACT — self-issue any missing capabilities
    if (!dryRun) {
      const issuerKey = opts.issuerKey ?? process.env.PRIVATE_KEY;
      if (!issuerKey) {
        return this.fail(
          goal,
          controller,
          agentId,
          did,
          minted,
          txHashes,
          [identitySignal, ...riskSignals],
          counterparty,
          "PRIVATE_KEY not set — cannot self-issue credentials.",
        );
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

    // 7. RE-GATE — combine capabilities + risk signals for the final GO/STOP
    const finalCapable: boolean[] = [];
    let capabilityGated = true;
    for (const cap of capResults) {
      const capableNow = dryRun
        ? cap.capable
        : (
            await this.adapter.verifyCapability({
              subject: controller,
              capability: cap.name,
            })
          ).capable;
      finalCapable.push(capableNow);
      if (!capableNow) capabilityGated = false;
    }
    const capabilitySignals: TrustSignal[] = capResults.map((cap, i) => ({
      kind: "capability",
      source: this.adapter.chainId,
      verdict: finalCapable[i] ? "go" : "stop",
      confidence: 100,
      metadata: {
        capability: cap.name,
        hash: cap.hash,
        selfIssued: cap.selfIssued,
        ...(cap.issueTxHash ? { issueTxHash: cap.issueTxHash } : {}),
      },
    }));

    const riskGated = riskSignals.every((s) => s.verdict !== "stop");
    const gated = capabilityGated && riskGated;

    const signals: TrustSignal[] = [
      identitySignal,
      ...riskSignals,
      ...capabilitySignals,
    ];
    const expiresAt =
      Math.floor(Date.now() / 1000) + TRUST_DECISION_TTL_SECONDS;
    const decisionSummary: TrustDecisionSummary = {
      verdict: gated ? "go" : "stop",
      intent: goal,
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      expiresAt,
    };

    // 8. RECORD — build manifest, persist, anchor on-chain
    let storage: StorageResult | null = null;
    let anchored: StewardResult["anchored"] = null;
    let anchoredTokenUri = "";

    const manifestArgs = {
      agentId,
      did,
      controller,
      goal,
      ...(counterparty !== undefined ? { counterparty } : {}),
      reasoning,
      capabilities: capResults,
      signals,
      decision: decisionSummary,
      gated,
      txHashes,
      anchoredTokenUri,
    };

    if (!dryRun) {
      const manifest = this.buildManifest(manifestArgs);
      try {
        storage = await this.store.store(manifest);
        anchoredTokenUri = `0g://${storage.rootHash}`;
        const anchor = await this.adapter.anchorEvidence({
          agentId,
          uri: anchoredTokenUri,
        });
        anchored = {
          agentId,
          tokenUri: anchoredTokenUri,
          txHash: anchor.tx.hash,
        };
        txHashes.push(anchor.tx.hash);
      } catch {
        // storage or anchoring failed — the run still succeeded, evidence is partial
      }
    }

    const finalManifest = this.buildManifest({
      ...manifestArgs,
      txHashes,
      anchoredTokenUri,
    });

    const decision: TrustDecision = {
      counterparty: counterparty ?? "",
      intent: goal,
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      signals,
      verdict: gated ? "go" : "stop",
      receipt: finalManifest,
      expiresAt,
    };

    return {
      ok: true,
      booted: { agentId, did, minted },
      reasoning,
      capabilities: capResults,
      unknownCapabilities,
      gated,
      action: { type: ACTION_TYPE, txHashes },
      storage,
      anchored,
      manifest: finalManifest,
      counterparty,
      signals,
      decision,
    };
  }

  private buildManifest(args: {
    agentId: string;
    did: string;
    controller: string;
    goal: string;
    counterparty?: string;
    reasoning: ReasoningResult;
    capabilities: StewardResult["capabilities"];
    signals: TrustSignal[];
    decision: TrustDecisionSummary;
    gated: boolean;
    txHashes: string[];
    anchoredTokenUri: string;
  }): EvidenceManifest {
    return {
      version: 1,
      agentId: args.agentId,
      did: args.did,
      controller: args.controller,
      chainId: this.adapter.chainId,
      chainName: this.adapter.chainName,
      goal: args.goal,
      ...(args.counterparty !== undefined
        ? { counterparty: args.counterparty }
        : {}),
      reasoning: {
        text: args.reasoning.text,
        verified: args.reasoning.verified,
        model: args.reasoning.model,
        provider: args.reasoning.provider,
      },
      capabilities: args.capabilities,
      signals: args.signals,
      decision: args.decision,
      action: { type: ACTION_TYPE, gated: args.gated, txHashes: args.txHashes },
      anchoredTokenUri: args.anchoredTokenUri,
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
    signals: TrustSignal[],
    counterparty: string | undefined,
    error: string,
  ): StewardResult {
    const empty: ReasoningResult = {
      text: "",
      verified: false,
      model: "",
      provider: "",
    };
    const expiresAt =
      Math.floor(Date.now() / 1000) + TRUST_DECISION_TTL_SECONDS;
    const decisionSummary: TrustDecisionSummary = {
      verdict: "stop",
      intent: goal,
      expiresAt,
    };
    const manifest = this.buildManifest({
      agentId,
      did,
      controller,
      goal,
      ...(counterparty !== undefined ? { counterparty } : {}),
      reasoning: empty,
      capabilities: [],
      signals,
      decision: decisionSummary,
      gated: false,
      txHashes,
      anchoredTokenUri: "",
    });
    const decision: TrustDecision = {
      counterparty: counterparty ?? "",
      intent: goal,
      signals,
      verdict: "stop",
      receipt: manifest,
      expiresAt,
    };
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
      signals,
      decision,
      error,
    };
  }
}
