/**
 * ZeroGAdapter — implements ChainAdapter for the 0G Chain (EVM-compatible L1).
 *
 * 0G Chain is EVM-compatible, so this adapter reuses the battle-tested
 * @ligis/adapter-evm implementation under the hood and simply pins the network
 * to one of the 0G networks defined in assets/networks.json.
 */
import { loadConfig } from "@ligis/core";
import type {
  AnchorEvidenceOpts,
  CapabilityRef,
  ChainAdapter,
  IssueAgentIdOpts,
  IssueAgentIdResult,
  RevokeOpts,
  SignCredentialOpts,
  SignedCredential,
  TxRef,
  VerifyResult,
} from "@ligis/core";
import { EvmAdapter, createEvmAdapter } from "@ligis/adapter-evm";

export interface ZeroGAdapterOptions {
  /** Network alias from assets/networks.json. Defaults to "0g-newton-testnet". */
  network?: "0g-newton-testnet" | "0g-mainnet";
}

export class ZeroGAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly explorerUrl: string;
  private readonly evmAdapter: EvmAdapter;

  constructor(opts: ZeroGAdapterOptions = {}) {
    const networkName = opts.network ?? "0g-newton-testnet";
    // 0G Chain is EVM-compatible; pin the network by temporarily setting the
    // same env var the core loader reads, then build the EVM adapter from that.
    process.env.LIGIS_NETWORK = networkName;
    const loaded = loadConfig();
    this.evmAdapter = createEvmAdapter({
      config: loaded,
      chainIdOverride: networkName,
    });
    this.chainId = networkName;
    this.chainName = loaded.network.name;
    this.explorerUrl = loaded.network.explorerUrl;
  }

  // ---------- identity ----------

  async getAgentId(controller: string): Promise<string | null> {
    return this.evmAdapter.getAgentId(controller);
  }

  async issueAgentId(opts: IssueAgentIdOpts = {}): Promise<IssueAgentIdResult> {
    return this.evmAdapter.issueAgentId(opts);
  }

  async rotateAgentId(opts: {
    agentId: string;
    newController: string;
  }): Promise<{ tx: TxRef }> {
    return this.evmAdapter.rotateAgentId(opts);
  }

  // ---------- credentials ----------

  async verifyCapability(opts: {
    subject: string;
    capability: CapabilityRef;
    issuer?: string;
  }): Promise<VerifyResult> {
    return this.evmAdapter.verifyCapability(opts);
  }

  async signCredential(opts: SignCredentialOpts): Promise<SignedCredential> {
    return this.evmAdapter.signCredential(opts);
  }

  async submitCredential(signed: SignedCredential): Promise<{ tx: TxRef }> {
    return this.evmAdapter.submitCredential(signed);
  }

  async revokeCredential(opts: RevokeOpts): Promise<{ tx: TxRef }> {
    return this.evmAdapter.revokeCredential(opts);
  }

  // ---------- evidence anchoring ----------

  async anchorEvidence(opts: AnchorEvidenceOpts): Promise<{ tx: TxRef }> {
    return this.evmAdapter.anchorEvidence(opts);
  }

  // ---------- wallet ----------

  hasWallet(): boolean {
    return this.evmAdapter.hasWallet();
  }

  walletAddress(): string | null {
    return this.evmAdapter.walletAddress();
  }
}

/** Convenience factory. */
export function createZeroGAdapter(
  opts: ZeroGAdapterOptions = {},
): ZeroGAdapter {
  return new ZeroGAdapter(opts);
}
