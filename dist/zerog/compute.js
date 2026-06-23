/**
 * 0G Compute — the Trust Steward's reasoning brain.
 *
 * Wraps the @0gfoundation/0g-compute-ts-sdk serving broker to provide
 * TEE-verified LLM inference. The agent depends on the {@link Reasoner}
 * interface (not this concrete class) so it is testable offline with a mock.
 *
 * Remove 0G Compute and the agent loses its reasoning step — it cannot
 * map a natural-language goal to required capabilities.
 */
import { ethers } from "ethers";
import { createZGComputeNetworkBroker, } from "@0gfoundation/0g-compute-ts-sdk";
/** Default testnet provider: Gemma 3 27B IT (TeeML-verifiable). */
const DEFAULT_PROVIDER = "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08";
export function loadZeroGConfig() {
    const privateKey = process.env.ZEROG_PRIVATE_KEY;
    if (!privateKey)
        throw new Error("ZEROG_PRIVATE_KEY not set");
    return {
        rpcUrl: process.env.ZEROG_RPC_URL || "https://evmrpc-testnet.0g.ai",
        privateKey,
        provider: process.env.ZEROG_PROVIDER || DEFAULT_PROVIDER,
    };
}
// ---------- Implementation ----------
export class ZeroGCompute {
    config;
    broker = null;
    metadata = null;
    constructor(config) {
        this.config = config;
    }
    /** Lazily create the broker (cached for the lifetime of the instance). */
    async getBroker() {
        if (!this.broker) {
            const provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
            const wallet = new ethers.Wallet(this.config.privateKey, provider);
            // ethers v6 dual-package CJS/ESM brand mismatch — runtime is correct.
            this.broker = await createZGComputeNetworkBroker(wallet);
        }
        return this.broker;
    }
    /** Lazily fetch + cache service metadata (endpoint, model). */
    async getMetadata() {
        if (!this.metadata) {
            const broker = await this.getBroker();
            this.metadata = await broker.inference.getServiceMetadata(this.config.provider);
        }
        return this.metadata;
    }
    async reason(prompt) {
        const broker = await this.getBroker();
        const { endpoint, model } = await this.getMetadata();
        const headers = await broker.inference.getRequestHeaders(this.config.provider);
        const response = await fetch(`${endpoint}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: headers.Authorization,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }],
            }),
        });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`0G inference failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
        }
        const completion = (await response.json());
        const text = completion.choices?.[0]?.message?.content ?? "";
        const chatID = response.headers.get("ZG-Res-Key") || completion.id;
        const usage = completion.usage ? JSON.stringify(completion.usage) : "";
        const verified = await broker.inference.processResponse(this.config.provider, chatID, usage);
        return {
            text,
            verified: verified === true,
            model,
            provider: this.config.provider,
        };
    }
}
// ---------- One-time setup ----------
/**
 * Initialize a fresh 0G wallet for inference: create a ledger, acknowledge the
 * provider, and transfer funds. Run once per wallet/provider pair.
 *
 * Requires the wallet to hold at least 4 OG (3 for ledger + 1 for provider).
 */
export async function setupProvider(config) {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    await broker.ledger.addLedger(3);
    await broker.inference.acknowledgeProviderSigner(config.provider);
    await broker.ledger.transferFund(config.provider, "inference", ethers.parseEther("1.0"));
}
//# sourceMappingURL=compute.js.map