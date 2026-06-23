export interface EvidenceStore {
    store(manifest: EvidenceManifest): Promise<StorageResult>;
    retrieve(rootHash: string): Promise<EvidenceManifest>;
}
export interface StorageResult {
    /** Merkle root of the uploaded data — anchored on-chain via setTokenURI. */
    rootHash: string;
    /** 0G Storage upload transaction hash. */
    txHash: string;
}
export interface EvidenceManifest {
    version: 1;
    agentId: string;
    controller: string;
    network: string;
    chainId: number;
    goal: string;
    reasoning: {
        text: string;
        verified: boolean;
        model: string;
        provider: string;
    };
    capabilities: Array<{
        name: string;
        hash: string;
        capable: boolean;
        selfIssued: boolean;
        issueTxHash?: string;
    }>;
    action: {
        type: string;
        gated: boolean;
        txHashes: string[];
    };
    anchoredTokenUri: string;
    recordedAt: number;
}
export interface ZeroGStorageConfig {
    evmRpc: string;
    indexerRpc: string;
    privateKey: string;
}
export declare function loadZeroGStorageConfig(): ZeroGStorageConfig;
export declare class ZeroGStorage implements EvidenceStore {
    private config;
    private indexer;
    private signer;
    constructor(config: ZeroGStorageConfig);
    /** Lazily create the indexer + signer (cached for the lifetime of the instance). */
    private getClients;
    store(manifest: EvidenceManifest): Promise<StorageResult>;
    retrieve(rootHash: string): Promise<EvidenceManifest>;
}
