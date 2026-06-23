import type { ClientContext } from "../lib/index.js";
import type { Reasoner, ReasoningResult } from "../zerog/compute.js";
import type { EvidenceManifest, EvidenceStore } from "../zerog/storage.js";
export interface StewardResult {
    ok: boolean;
    booted: {
        tokenId: string;
        minted: boolean;
    };
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
    action: {
        type: string;
        txHashes: string[];
    };
    storage: {
        rootHash: string;
        txHash: string;
    } | null;
    anchored: {
        tokenId: string;
        tokenUri: string;
        txHash: string;
    } | null;
    manifest: EvidenceManifest;
    error?: string;
}
export declare class TrustSteward {
    private ctx;
    private reasoner;
    private store;
    constructor(ctx: ClientContext, reasoner: Reasoner, store: EvidenceStore);
    run(goal: string, opts?: {
        dryRun?: boolean;
    }): Promise<StewardResult>;
    private buildManifest;
    private fail;
}
