/**
 * 0G Storage — the Trust Steward's verifiable evidence store.
 *
 * Wraps the @0gfoundation/0g-storage-ts-sdk to upload and retrieve evidence
 * manifests. The agent depends on the {@link EvidenceStore} interface (not this
 * concrete class) so it is testable offline with a mock.
 *
 * Remove 0G Storage and the agent loses its verifiable evidence store —
 * decisions are made but never anchored or retrievable.
 */
import { ethers } from "ethers";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";

// ---------- Interface (what the agent depends on) ----------

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

// ---------- Evidence manifest (the agent builds this, the store persists it) ----------

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

// ---------- Config ----------

export interface ZeroGStorageConfig {
  evmRpc: string;
  indexerRpc: string;
  privateKey: string;
}

const DEFAULT_EVM_RPC = "https://evmrpc-testnet.0g.ai";
const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";

export function loadZeroGStorageConfig(): ZeroGStorageConfig {
  const privateKey = process.env.ZEROG_PRIVATE_KEY;
  if (!privateKey) throw new Error("ZEROG_PRIVATE_KEY not set");
  return {
    evmRpc: process.env.ZEROG_RPC_URL || DEFAULT_EVM_RPC,
    indexerRpc: process.env.ZEROG_INDEXER_RPC || DEFAULT_INDEXER_RPC,
    privateKey,
  };
}

// ---------- Implementation ----------

export class ZeroGStorage implements EvidenceStore {
  private indexer: Indexer | null = null;
  private signer: ethers.Wallet | null = null;

  constructor(private config: ZeroGStorageConfig) {}

  /** Lazily create the indexer + signer (cached for the lifetime of the instance). */
  private getClients(): { indexer: Indexer; signer: ethers.Wallet } {
    if (!this.indexer || !this.signer) {
      const provider = new ethers.JsonRpcProvider(this.config.evmRpc);
      this.signer = new ethers.Wallet(this.config.privateKey, provider);
      this.indexer = new Indexer(this.config.indexerRpc);
    }
    return { indexer: this.indexer, signer: this.signer };
  }

  async store(manifest: EvidenceManifest): Promise<StorageResult> {
    const { indexer, signer } = this.getClients();
    const data = new TextEncoder().encode(JSON.stringify(manifest));
    const memData = new MemData(data);

    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      throw new Error(`0G Storage merkle tree error: ${treeErr}`);
    }

    const [tx, uploadErr] = await indexer.upload(
      memData,
      this.config.evmRpc,
      // ethers v6 dual-package CJS/ESM brand mismatch — runtime is correct.
      signer as unknown as Parameters<typeof indexer.upload>[2],
    );
    if (uploadErr !== null) {
      throw new Error(`0G Storage upload error: ${uploadErr}`);
    }

    // Handle both single and fragmented (>4GB) responses
    if ("rootHash" in tx) {
      return { rootHash: tx.rootHash, txHash: tx.txHash };
    }
    // For fragmented uploads, use the first root hash
    return {
      rootHash: tx.rootHashes[0],
      txHash: tx.txHashes[0],
    };
  }

  async retrieve(rootHash: string): Promise<EvidenceManifest> {
    const { indexer } = this.getClients();
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash, {
      proof: true,
    });
    if (dlErr !== null) {
      throw new Error(`0G Storage download error: ${dlErr}`);
    }
    // downloadToBlob returns a Blob — convert to bytes then text
    const arrayBuffer = await (blob as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    return JSON.parse(text) as EvidenceManifest;
  }
}
