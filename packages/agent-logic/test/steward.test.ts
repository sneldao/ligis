import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityHash,
  type ChainAdapter,
  type EvidenceManifest,
  type EvidenceStore,
  type IssueAgentIdResult,
  type Reasoner,
  type ReasoningResult,
  type SignedCredential,
  type StorageResult,
  type TxRef,
  type VerifyResult,
} from "@ligis/core";
import { TrustSteward } from "../src/index.js";

// ---------- Mock Reasoner ----------

class MockReasoner implements Reasoner {
  constructor(private response: string) {}
  async reason(_prompt: string): Promise<ReasoningResult> {
    return { text: this.response, verified: true, model: "mock-model", provider: "0xmock" };
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

// ---------- Mock ChainAdapter ----------

const WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

interface MockAdapterOpts {
  /** Capabilities the subject already holds at boot. */
  preIssuedCaps?: string[];
  /** If set, `getAgentId` returns null (so the Steward mints). */
  noAgent?: boolean;
}

function makeAdapter(opts: MockAdapterOpts = {}): ChainAdapter & { issuedCaps: Set<string>; minted: boolean } {
  const issuedCaps = new Set<string>((opts.preIssuedCaps ?? []).map((c) => c.toLowerCase()));
  let agentId: string | null = opts.noAgent ? null : "1";
  let nonce = 0;
  let minted = false;

  const randHash = () =>
    "0x" + Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64);
  const tx = (): TxRef => ({ hash: randHash(), blockNumber: "42", explorerUrl: "https://example/tx" });

  const adapter: ChainAdapter & { issuedCaps: Set<string>; minted: boolean } = {
    chainId: "mock",
    chainName: "Mock Chain",
    explorerUrl: "https://example.test/",
    issuedCaps,
    get minted() { return minted; },

    async getAgentId() { return agentId; },
    async issueAgentId(): Promise<IssueAgentIdResult> {
      agentId = "2";
      minted = true;
      return { agentId: "2", did: "did:ligis:mock:2", controller: WALLET, tx: tx() };
    },
    async rotateAgentId() { return { tx: tx() }; },

    async verifyCapability(o): Promise<VerifyResult> {
      const hash = typeof o.capability === "string" && o.capability.startsWith("0x")
        ? o.capability
        : capabilityHash(o.capability as string);
      const capable = issuedCaps.has(hash.toLowerCase());
      return {
        capable,
        capabilityHash: hash as `0x${string}`,
        subject: o.subject,
        capability: o.capability as string,
        latest: { issuer: WALLET, issuedAt: "1000", expiresAt: "9999999999", revoked: false, valid: capable },
      };
    },
    async signCredential(o): Promise<SignedCredential> {
      const hash = typeof o.capability === "string" && o.capability.startsWith("0x")
        ? o.capability
        : capabilityHash(o.capability as string);
      return {
        issuer: WALLET, subject: o.subject, capabilityHash: hash as `0x${string}`,
        issuedAt: "1000", expiresAt: "9999999999", nonce: String(nonce),
        digest: ("0x" + "ee".repeat(32)) as `0x${string}`, signature: "0xsig",
      };
    },
    async submitCredential(signed): Promise<{ tx: TxRef }> {
      issuedCaps.add(signed.capabilityHash.toLowerCase());
      nonce++;
      return { tx: tx() };
    },
    async revokeCredential() { return { tx: tx() }; },
    async anchorEvidence() { return { tx: tx() }; },

    hasWallet() { return true; },
    walletAddress() { return WALLET; },
  };
  return adapter;
}

// ---------- Tests ----------

describe("TrustSteward", () => {
  it("completes the full loop: boot → reason → gate → self-issue → re-gate → record", async () => {
    const adapter = makeAdapter();
    process.env.PRIVATE_KEY = "0xpk";

    const reasoner = new MockReasoner(JSON.stringify({
      capabilities: ["agent.commerce.escrow"], reasoning: "escrow requires the escrow capability",
    }));
    const store = new MockEvidenceStore();

    const steward = new TrustSteward(adapter, reasoner, store);
    const result = await steward.run("open an escrow with counterparty X");

    assert.equal(result.ok, true);
    assert.equal(result.booted.agentId, "1");
    assert.equal(result.booted.did, "did:ligis:mock:1");
    assert.equal(result.booted.minted, false);
    assert.equal(result.reasoning.verified, true);
    assert.equal(result.capabilities.length, 1);
    assert.equal(result.capabilities[0]!.name, "agent.commerce.escrow");
    assert.equal(result.capabilities[0]!.capable, false);
    assert.equal(result.capabilities[0]!.selfIssued, true);
    assert.equal(result.gated, true);
    assert.ok(result.storage, "storage should be populated");
    assert.ok(result.anchored, "anchored should be populated");
    assert.match(result.anchored!.tokenUri, /^0g:\/\/0x/);
    assert.equal(store.stored.length, 1);
    assert.equal(result.manifest.goal, "open an escrow with counterparty X");
    assert.equal(result.manifest.chainId, "mock");
    assert.equal(result.manifest.capabilities[0]!.selfIssued, true);
  });

  it("mints a new Agent ID when none exists", async () => {
    const adapter = makeAdapter({ noAgent: true });
    process.env.PRIVATE_KEY = "0xpk";
    const reasoner = new MockReasoner(JSON.stringify({ capabilities: [], reasoning: "none" }));
    const steward = new TrustSteward(adapter, reasoner, new MockEvidenceStore());
    const result = await steward.run("just exist");
    assert.equal(result.ok, true);
    assert.equal(result.booted.minted, true);
    assert.equal(result.booted.agentId, "2");
  });

  it("skips self-issue when capability is already held", async () => {
    const escrowHash = capabilityHash("agent.commerce.escrow");
    const adapter = makeAdapter({ preIssuedCaps: [escrowHash] });
    process.env.PRIVATE_KEY = "0xpk";

    const reasoner = new MockReasoner(JSON.stringify({
      capabilities: ["agent.commerce.escrow"], reasoning: "already has it",
    }));
    const steward = new TrustSteward(adapter, reasoner, new MockEvidenceStore());
    const result = await steward.run("open an escrow");

    assert.equal(result.capabilities[0]!.capable, true);
    assert.equal(result.capabilities[0]!.selfIssued, false);
    assert.equal(result.gated, true);
  });

  it("handles unknown capabilities from the LLM", async () => {
    const adapter = makeAdapter();
    process.env.PRIVATE_KEY = "0xpk";
    const reasoner = new MockReasoner(JSON.stringify({
      capabilities: ["agent.commerce.escrow", "totally.fake.cap"], reasoning: "mixed",
    }));
    const steward = new TrustSteward(adapter, reasoner, new MockEvidenceStore());
    const result = await steward.run("do something");

    assert.equal(result.capabilities.length, 1);
    assert.equal(result.unknownCapabilities.length, 1);
    assert.equal(result.unknownCapabilities[0], "totally.fake.cap");
  });

  it("dry-run does not write to chain or storage", async () => {
    const adapter = makeAdapter();
    process.env.PRIVATE_KEY = "0xpk";
    const reasoner = new MockReasoner(JSON.stringify({
      capabilities: ["agent.commerce.escrow"], reasoning: "dry run",
    }));
    const store = new MockEvidenceStore();
    const steward = new TrustSteward(adapter, reasoner, store);
    const result = await steward.run("test goal", { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.capabilities[0]!.capable, false);
    assert.equal(result.capabilities[0]!.selfIssued, false);
    assert.equal(result.gated, false);
    assert.equal(result.storage, null);
    assert.equal(result.anchored, null);
    assert.equal(store.stored.length, 0);
    assert.equal(adapter.issuedCaps.size, 0);
  });

  it("returns ok:false when reasoning fails", async () => {
    const adapter = makeAdapter();
    process.env.PRIVATE_KEY = "0xpk";
    const reasoner: Reasoner = {
      async reason() { throw new Error("0G Compute unavailable"); },
    };
    const steward = new TrustSteward(adapter, reasoner, new MockEvidenceStore());
    const result = await steward.run("test goal");

    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("reasoning failed"));
  });
});
