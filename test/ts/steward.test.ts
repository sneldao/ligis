import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Hex, Address } from "viem";
import type { ClientContext } from "../../src/lib/client.js";
import type { Reasoner, ReasoningResult } from "../../src/zerog/compute.js";
import type { EvidenceStore, EvidenceManifest, StorageResult } from "../../src/zerog/storage.js";
import { TrustSteward } from "../../src/agent/steward.js";
import { capabilityHash } from "../../src/lib/util.js";

// ---------- Mock Reasoner ----------

class MockReasoner implements Reasoner {
  constructor(private response: string) {}
  async reason(_prompt: string): Promise<ReasoningResult> {
    return {
      text: this.response,
      verified: true,
      model: "mock-model",
      provider: "0xmock",
    };
  }
}

// ---------- Mock EvidenceStore ----------

class MockEvidenceStore implements EvidenceStore {
  stored: EvidenceManifest[] = [];
  async store(manifest: EvidenceManifest): Promise<StorageResult> {
    this.stored.push(manifest);
    return { rootHash: "0x" + "ab".repeat(32), txHash: "0x" + "cd".repeat(32) };
  }
  async retrieve(_rootHash: string): Promise<EvidenceManifest> {
    return this.stored[0]!;
  }
}

// ---------- Mock ClientContext (stateful chain simulator) ----------

const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ANVIL_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

function createMockCtx(): ClientContext {
  const issuedCaps = new Set<string>();
  let agentId = 1n;
  let nonce = 0n;

  const publicClient = {
    readContract: async (params: { functionName: string; args: readonly unknown[] }) => {
      switch (params.functionName) {
        case "walletOfAgent":
          return agentId;
        case "isCapable":
        case "isCapableFromIssuer":
          return issuedCaps.has((params.args[1] as string).toLowerCase());
        case "latestCredential": {
          const valid = issuedCaps.has((params.args[1] as string).toLowerCase());
          return {
            issuer: ANVIL_ADDR,
            issuedAt: 1000n,
            expiresAt: 9999999999n,
            revoked: false,
            valid,
          };
        }
        case "issuerNonce":
          return nonce;
        case "hashTypedData":
          return "0x" + "ee".repeat(32);
        default:
          throw new Error(`mock readContract: unexpected function ${params.functionName}`);
      }
    },
    waitForTransactionReceipt: async () => ({ blockNumber: 42n, status: "success" }),
  };

  const walletClient = {
    writeContract: async (params: { functionName: string; args: readonly unknown[] }) => {
      const hash = "0x" + Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64) as Hex;
      switch (params.functionName) {
        case "mintSelf":
          agentId = 2n;
          break;
        case "issue":
          issuedCaps.add((params.args[2] as string).toLowerCase());
          nonce++;
          break;
        case "setTokenURI":
          break;
      }
      return hash;
    },
  };

  return {
    publicClient,
    walletClient,
    account: { address: ANVIL_ADDR },
    network: { name: "Local Anvil", chainId: 31337, rpcUrl: "", explorerUrl: "", explorerApiUrl: "", nativeToken: { symbol: "ETH", name: "Ether", decimals: 18 } },
    networkName: "local-anvil",
    deployment: {
      pharosAgentId: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      credentialRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      chainId: 31337,
      deployer: ANVIL_ADDR,
      deployedAt: "0",
    },
    rpc: "http://127.0.0.1:8545",
    chain: { id: 31337, name: "Local Anvil" },
  } as unknown as ClientContext;
}

// ---------- Tests ----------

describe("TrustSteward", () => {
  it("completes the full loop: boot → reason → gate → self-issue → re-gate → record", async () => {
    const ctx = createMockCtx();
    process.env.PRIVATE_KEY = ANVIL_KEY;

    const reasoner = new MockReasoner(
      JSON.stringify({
        capabilities: ["agent.commerce.escrow"],
        reasoning: "escrow requires the escrow capability",
      }),
    );
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(ctx, reasoner, store);
    const result = await steward.run("open an escrow with counterparty X");

    assert.equal(result.ok, true);
    assert.equal(result.booted.tokenId, "1");
    assert.equal(result.booted.minted, false);
    assert.equal(result.reasoning.verified, true);
    assert.equal(result.capabilities.length, 1);
    assert.equal(result.capabilities[0].name, "agent.commerce.escrow");
    assert.equal(result.capabilities[0].capable, false);
    assert.equal(result.capabilities[0].selfIssued, true);
    assert.equal(result.gated, true);
    assert.ok(result.storage, "storage should be populated");
    assert.ok(result.anchored, "anchored should be populated");
    assert.match(result.anchored!.tokenUri, /^0g:\/\/0x/);
    assert.equal(store.stored.length, 1);
    assert.equal(result.manifest.goal, "open an escrow with counterparty X");
    assert.equal(result.manifest.capabilities[0].selfIssued, true);
  });

  it("skips self-issue when capability is already held", async () => {
    const ctx = createMockCtx();
    process.env.PRIVATE_KEY = ANVIL_KEY;

    // Pre-issue the capability by simulating an issue call
    const escrowHash = capabilityHash("agent.commerce.escrow").toLowerCase();
    (ctx.publicClient as unknown as { readContract: Function }).readContract = async (params: { functionName: string; args: readonly unknown[] }) => {
      if (params.functionName === "isCapable" || params.functionName === "isCapableFromIssuer") {
        return (params.args[1] as string).toLowerCase() === escrowHash;
      }
      if (params.functionName === "latestCredential") {
        const valid = (params.args[1] as string).toLowerCase() === escrowHash;
        return { issuer: ANVIL_ADDR, issuedAt: 1000n, expiresAt: 9999999999n, revoked: false, valid };
      }
      if (params.functionName === "walletOfAgent") return 1n;
      if (params.functionName === "issuerNonce") return 0n;
      if (params.functionName === "hashTypedData") return "0x" + "ee".repeat(32);
      throw new Error(`unexpected: ${params.functionName}`);
    };

    const reasoner = new MockReasoner(
      JSON.stringify({ capabilities: ["agent.commerce.escrow"], reasoning: "already has it" }),
    );
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(ctx, reasoner, store);
    const result = await steward.run("open an escrow");

    assert.equal(result.capabilities[0].capable, true);
    assert.equal(result.capabilities[0].selfIssued, false);
    assert.equal(result.gated, true);
  });

  it("handles unknown capabilities from the LLM", async () => {
    const ctx = createMockCtx();
    process.env.PRIVATE_KEY = ANVIL_KEY;

    const reasoner = new MockReasoner(
      JSON.stringify({
        capabilities: ["agent.commerce.escrow", "totally.fake.cap"],
        reasoning: "mixed",
      }),
    );
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(ctx, reasoner, store);
    const result = await steward.run("do something");

    assert.equal(result.capabilities.length, 1);
    assert.equal(result.unknownCapabilities.length, 1);
    assert.equal(result.unknownCapabilities[0], "totally.fake.cap");
  });

  it("dry-run does not write to chain or storage", async () => {
    const ctx = createMockCtx();
    process.env.PRIVATE_KEY = ANVIL_KEY;

    const reasoner = new MockReasoner(
      JSON.stringify({ capabilities: ["agent.commerce.escrow"], reasoning: "dry run" }),
    );
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(ctx, reasoner, store);
    const result = await steward.run("test goal", { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.capabilities[0].capable, false);
    assert.equal(result.capabilities[0].selfIssued, false);
    assert.equal(result.gated, false);
    assert.equal(result.storage, null);
    assert.equal(result.anchored, null);
    assert.equal(store.stored.length, 0);
  });

  it("returns ok:false when reasoning fails", async () => {
    const ctx = createMockCtx();
    process.env.PRIVATE_KEY = ANVIL_KEY;

    const reasoner: Reasoner = {
      async reason() {
        throw new Error("0G Compute unavailable");
      },
    };
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(ctx, reasoner, store);
    const result = await steward.run("test goal");

    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("reasoning failed"));
  });
});
