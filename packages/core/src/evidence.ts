/**
 * EvidenceStore — verifiable persistence for Trust Steward run manifests.
 *
 * The default implementation lives in packages/zerog (0G Storage), but any
 * content-addressed store can plug in. The manifest is built by the Steward
 * and is intentionally chain-neutral so the same manifest format works across
 * adapters.
 */
export interface EvidenceManifest {
  version: 1;
  agentId: string;
  did?: string;
  controller: string;
  chainId: string;
  chainName: string;
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
  action: { type: string; gated: boolean; txHashes: string[] };
  anchoredTokenUri: string;
  recordedAt: number;
}

export interface StorageResult {
  /** Content address (e.g. merkle root) — anchored on-chain by the adapter. */
  rootHash: string;
  /** Storage-layer transaction hash, if applicable. */
  txHash: string;
}

export interface EvidenceStore {
  store(manifest: EvidenceManifest): Promise<StorageResult>;
  retrieve(rootHash: string): Promise<EvidenceManifest>;
}
