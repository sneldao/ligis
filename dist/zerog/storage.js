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
const DEFAULT_EVM_RPC = "https://evmrpc-testnet.0g.ai";
const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
export function loadZeroGStorageConfig() {
    const privateKey = process.env.ZEROG_PRIVATE_KEY;
    if (!privateKey)
        throw new Error("ZEROG_PRIVATE_KEY not set");
    return {
        evmRpc: process.env.ZEROG_RPC_URL || DEFAULT_EVM_RPC,
        indexerRpc: process.env.ZEROG_INDEXER_RPC || DEFAULT_INDEXER_RPC,
        privateKey,
    };
}
// ---------- Implementation ----------
export class ZeroGStorage {
    config;
    indexer = null;
    signer = null;
    constructor(config) {
        this.config = config;
    }
    /** Lazily create the indexer + signer (cached for the lifetime of the instance). */
    getClients() {
        if (!this.indexer || !this.signer) {
            const provider = new ethers.JsonRpcProvider(this.config.evmRpc);
            this.signer = new ethers.Wallet(this.config.privateKey, provider);
            this.indexer = new Indexer(this.config.indexerRpc);
        }
        return { indexer: this.indexer, signer: this.signer };
    }
    async store(manifest) {
        const { indexer, signer } = this.getClients();
        const data = new TextEncoder().encode(JSON.stringify(manifest));
        const memData = new MemData(data);
        const [tree, treeErr] = await memData.merkleTree();
        if (treeErr !== null) {
            throw new Error(`0G Storage merkle tree error: ${treeErr}`);
        }
        const [tx, uploadErr] = await indexer.upload(memData, this.config.evmRpc, 
        // ethers v6 dual-package CJS/ESM brand mismatch — runtime is correct.
        signer);
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
    async retrieve(rootHash) {
        const { indexer } = this.getClients();
        const [blob, dlErr] = await indexer.downloadToBlob(rootHash, {
            proof: true,
        });
        if (dlErr !== null) {
            throw new Error(`0G Storage download error: ${dlErr}`);
        }
        // downloadToBlob returns a Blob — convert to bytes then text
        const arrayBuffer = await blob.arrayBuffer();
        const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
        return JSON.parse(text);
    }
}
//# sourceMappingURL=storage.js.map