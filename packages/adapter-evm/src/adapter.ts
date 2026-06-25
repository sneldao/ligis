/**
 * EvmAdapter — implements the chain-neutral ChainAdapter contract for any
 * EVM-compatible chain (Pharos, anvil, ...). Composes the operations module
 * (which talks to viem) and normalizes results into ChainAdapter shapes.
 */
import { loadConfig, formatDid } from "@ligis/core";
import type {
  AnchorEvidenceOpts,
  CapabilityRef,
  ChainAdapter,
  IssueAgentIdOpts,
  IssueAgentIdResult,
  LoadedConfig,
  RevokeOpts,
  SignCredentialOpts,
  SignedCredential,
  TxRef,
  VerifyResult,
} from "@ligis/core";
import { buildClientContext, type ClientContext } from "./client.js";
import {
  getAgentId,
  issueId,
  revoke,
  rotate,
  signCredential,
  submitCredential,
  updateTokenUri,
  verify,
} from "./operations.js";

export interface EvmAdapterOptions {
  /** Pre-loaded config; if omitted, loaded from networks.json. */
  config?: LoadedConfig;
  /** Override the chain id slug used in DIDs. Defaults to the network name. */
  chainIdOverride?: string;
}

export class EvmAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly explorerUrl: string;
  /** Exposed for callers that still need the raw viem context (e.g. ad-hoc reads). */
  readonly ctx: ClientContext;

  constructor(opts: EvmAdapterOptions = {}) {
    const loaded = opts.config ?? loadConfig();
    this.ctx = buildClientContext(loaded);
    this.chainId = opts.chainIdOverride ?? loaded.networkName;
    this.chainName = loaded.network.name;
    this.explorerUrl = loaded.network.explorerUrl;
  }

  // ---------- identity ----------

  async getAgentId(controller: string): Promise<string | null> {
    const id = await getAgentId(this.ctx, controller);
    return id === 0n ? null : id.toString();
  }

  async issueAgentId(opts: IssueAgentIdOpts = {}): Promise<IssueAgentIdResult> {
    const res = await issueId(this.ctx, opts);
    return {
      agentId: res.tokenId,
      did: formatDid(this.chainId, res.tokenId),
      controller: res.controller,
      tx: { hash: res.txHash, blockNumber: res.blockNumber, explorerUrl: res.explorer },
    };
  }

  async rotateAgentId(opts: { agentId: string; newController: string }): Promise<{ tx: TxRef }> {
    const res = await rotate(this.ctx, { tokenId: opts.agentId, newController: opts.newController });
    return { tx: { hash: res.txHash, blockNumber: res.blockNumber, explorerUrl: res.explorer } };
  }

  // ---------- credentials ----------

  async verifyCapability(opts: {
    subject: string;
    capability: CapabilityRef;
    issuer?: string;
  }): Promise<VerifyResult> {
    const res = await verify(this.ctx, {
      subject: opts.subject,
      capability: opts.capability,
      issuer: opts.issuer,
    });
    return {
      capable: res.capable,
      capabilityHash: res.capabilityHash,
      subject: res.subject,
      capability: res.capability,
      latest: res.latest,
    };
  }

  async signCredential(opts: SignCredentialOpts): Promise<SignedCredential> {
    const res = await signCredential(this.ctx, opts);
    return {
      issuer: res.issuer,
      subject: res.subject,
      capabilityHash: res.capabilityHash,
      issuedAt: res.issuedAt,
      expiresAt: res.expiresAt,
      nonce: res.nonce,
      digest: res.digest,
      signature: res.signature,
      submitCommand: res.submitCommand,
    };
  }

  async submitCredential(signed: SignedCredential): Promise<{ tx: TxRef }> {
    const res = await submitCredential(this.ctx, {
      issuer: signed.issuer,
      subject: signed.subject,
      capabilityHash: signed.capabilityHash,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
      nonce: signed.nonce,
      signature: signed.signature as `0x${string}`,
    });
    return { tx: { hash: res.txHash, blockNumber: res.blockNumber, explorerUrl: res.explorer } };
  }

  async revokeCredential(opts: RevokeOpts): Promise<{ tx: TxRef }> {
    const res = await revoke(this.ctx, opts);
    return { tx: { hash: res.txHash, blockNumber: res.blockNumber, explorerUrl: res.explorer } };
  }

  // ---------- evidence anchoring ----------

  async anchorEvidence(opts: AnchorEvidenceOpts): Promise<{ tx: TxRef }> {
    const res = await updateTokenUri(this.ctx, { tokenId: opts.agentId, tokenUri: opts.uri });
    return { tx: { hash: res.txHash, blockNumber: res.blockNumber, explorerUrl: res.explorer } };
  }

  // ---------- wallet ----------

  hasWallet(): boolean {
    return this.ctx.account !== null;
  }

  walletAddress(): string | null {
    return this.ctx.account?.address ?? null;
  }
}

/** Convenience factory mirroring the old `getClients()` ergonomics. */
export function createEvmAdapter(opts: EvmAdapterOptions = {}): EvmAdapter {
  return new EvmAdapter(opts);
}
