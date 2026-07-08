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
import { createRequire } from "module";
import type { Reasoner, ReasoningResult } from "@ligis/core";

// The 0G Compute SDK's ESM build has a broken re-export. Use the CJS build.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } =
  require("@0gfoundation/0g-compute-ts-sdk") as {
    createZGComputeNetworkBroker: typeof import("@0gfoundation/0g-compute-ts-sdk").createZGComputeNetworkBroker;
  };
type ZGComputeNetworkBroker =
  import("@0gfoundation/0g-compute-ts-sdk").ZGComputeNetworkBroker;

// ---------- Config ----------

export interface ZeroGConfig {
  rpcUrl: string;
  privateKey: string;
  provider: string;
}

/**
 * Default testnet provider: Qwen 2.5 7B (TeeML-verifiable).
 *
 * Changed from Gemma 3 27B (dead — compute-network-8.integratenetwork.work
 * has been unreachable since mid-2026) to Qwen 2.5 7B
 * (provider 0xa48f01287233509FD694a22Bf840225062E67836 on Galileo testnet)
 * which has verified working. Requires ≥1.0 OG minimum reserve in provider
 * ledger balance.
 */
const DEFAULT_PROVIDER = "0xa48f01287233509FD694a22Bf840225062E67836";

/**
 * Minimal shape of an OpenAI-compatible chat completion response.
 * 0G providers expose this interface; we only need these fields.
 */
interface ChatCompletionResponse {
  id: string;
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function loadZeroGConfig(): ZeroGConfig {
  const privateKey = process.env.ZEROG_PRIVATE_KEY;
  if (!privateKey) throw new Error("ZEROG_PRIVATE_KEY not set");
  return {
    rpcUrl: process.env.ZEROG_RPC_URL || "https://evmrpc-testnet.0g.ai",
    privateKey,
    provider: process.env.ZEROG_PROVIDER || DEFAULT_PROVIDER,
  };
}

// ---------- Implementation ----------

export class ZeroGCompute implements Reasoner {
  private broker: ZGComputeNetworkBroker | null = null;
  private metadata: { endpoint: string; model: string } | null = null;

  constructor(private config: ZeroGConfig) {}

  /** Lazily create the broker (cached for the lifetime of the instance). */
  private async getBroker(): Promise<ZGComputeNetworkBroker> {
    if (!this.broker) {
      const provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      const wallet = new ethers.Wallet(this.config.privateKey, provider);
      // ethers v6 dual-package CJS/ESM brand mismatch — runtime is correct.
      this.broker = await createZGComputeNetworkBroker(
        wallet as unknown as Parameters<typeof createZGComputeNetworkBroker>[0],
      );
    }
    return this.broker;
  }

  /** Lazily fetch + cache service metadata (endpoint, model). */
  private async getMetadata(): Promise<{ endpoint: string; model: string }> {
    if (!this.metadata) {
      const broker = await this.getBroker();
      this.metadata = await broker.inference.getServiceMetadata(
        this.config.provider,
      );
    }
    return this.metadata;
  }

  async reason(prompt: string): Promise<ReasoningResult> {
    const broker = await this.getBroker();
    const { endpoint, model } = await this.getMetadata();

    const headers = await broker.inference.getRequestHeaders(
      this.config.provider,
    );

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
      throw new Error(
        `0G inference failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      );
    }

    const completion = (await response.json()) as ChatCompletionResponse;
    const text: string = completion.choices?.[0]?.message?.content ?? "";
    const chatID = response.headers.get("ZG-Res-Key") || completion.id;
    const usage = completion.usage ? JSON.stringify(completion.usage) : "";

    const verified = await broker.inference.processResponse(
      this.config.provider,
      chatID,
      usage,
    );

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
 * Requires the wallet to hold enough OG for the ledger deposit + provider
 * funding + gas. Defaults to 0.5 OG ledger + 0.1 OG transfer (minimal setup).
 */
export async function setupProvider(config: ZeroGConfig): Promise<void> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const broker = await createZGComputeNetworkBroker(
    wallet as unknown as Parameters<typeof createZGComputeNetworkBroker>[0],
  );

  await broker.ledger.addLedger(5);
  await broker.inference.acknowledgeProviderSigner(config.provider);
  // Qwen 2.5 7B requires ≥ 1.0 OG minimum reserve; transfer 1.5 to be safe
  await broker.ledger.transferFund(
    config.provider,
    "inference",
    ethers.parseEther("1.5"),
  );
}
