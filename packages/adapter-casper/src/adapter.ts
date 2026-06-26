/**
 * CasperAdapter — implements ChainAdapter for the Casper Network.
 *
 * Architecturally identical to EvmAdapter: it composes a thin operations
 * module (which talks to casper-js-sdk) and normalizes results to the
 * chain-neutral types from @ligis/core.
 *
 * All 8 operations are implemented in operations.ts via casper-js-sdk:
 * getAgentId, issueAgentId, rotateAgentId, verifyCapability,
 * signCredential, submitCredential, revokeCredential, anchorEvidence.
 * Write ops build TransactionV1 payloads, sign with a secp256k1 key
 * from env, and submit via putTransaction + waitForTransaction.
 */
import { capabilityHash, formatDid, parseCapability } from "@ligis/core";
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
import { buildCasperClient, type CasperClientContext } from "./client.js";
import { loadCasperConfig, type CasperConfig } from "./config.js";
import * as ops from "./operations.js";

export interface CasperAdapterOptions {
  /** Pre-built config; if omitted, loaded from env. */
  config?: CasperConfig;
}

export class CasperAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly explorerUrl: string;
  /** Exposed for callers that want the raw casper-js-sdk RpcClient. */
  readonly ctx: CasperClientContext;

  constructor(opts: CasperAdapterOptions = {}) {
    const config = opts.config ?? loadCasperConfig();
    this.ctx = buildCasperClient(config);
    this.chainId = config.network.chainName === "casper" ? "casper-mainnet" : "casper-testnet";
    this.chainName = config.network.displayName;
    this.explorerUrl = config.network.explorerUrl;
  }

  // ---------- identity ----------

  async getAgentId(controller: string): Promise<string | null> {
    return ops.getAgentId(this.ctx, controller);
  }

  async issueAgentId(opts: IssueAgentIdOpts = {}): Promise<IssueAgentIdResult> {
    const res = await ops.issueAgentId(this.ctx, opts);
    return {
      agentId: res.agentId,
      did: formatDid(this.chainId, res.agentId),
      controller: res.controller,
      tx: this.tx(res.txHash, res.blockNumber),
    };
  }

  async rotateAgentId(opts: { agentId: string; newController: string }): Promise<{ tx: TxRef }> {
    const res = await ops.rotateAgentId(this.ctx, opts);
    return { tx: this.tx(res.txHash, res.blockNumber) };
  }

  // ---------- credentials ----------

  async verifyCapability(opts: {
    subject: string;
    capability: CapabilityRef;
    issuer?: string;
  }): Promise<VerifyResult> {
    const capStr = typeof opts.capability === "string" ? opts.capability : (opts.capability as string);
    const res = await ops.verifyCapability(this.ctx, {
      subject: opts.subject,
      capability: capStr,
      issuer: opts.issuer,
    });
    return {
      capable: res.capable,
      capabilityHash: res.capabilityHash,
      subject: opts.subject,
      capability: capStr,
      latest: res.latest,
    };
  }

  async signCredential(opts: SignCredentialOpts): Promise<SignedCredential> {
    const capStr = typeof opts.capability === "string" ? opts.capability : (opts.capability as string);
    const res = await ops.signCredential(this.ctx, {
      issuerKey: opts.issuerKey,
      subject: opts.subject,
      capability: capStr,
      expiresInSeconds: opts.expiresInSeconds,
    });
    return res as SignedCredential;
  }

  async submitCredential(signed: SignedCredential): Promise<{ tx: TxRef }> {
    const res = await ops.submitCredential(this.ctx, {
      issuer: signed.issuer,
      subject: signed.subject,
      capabilityHash: signed.capabilityHash,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
      nonce: signed.nonce,
      signature: signed.signature as string,
    });
    return { tx: this.tx(res.txHash, res.blockNumber) };
  }

  async revokeCredential(opts: RevokeOpts): Promise<{ tx: TxRef }> {
    const capStr = typeof opts.capability === "string" ? opts.capability : (opts.capability as string);
    const res = await ops.revokeCredential(this.ctx, {
      subject: opts.subject,
      capability: capStr,
      nonce: opts.nonce,
      issuerKey: opts.issuerKey,
    });
    return { tx: this.tx(res.txHash, res.blockNumber) };
  }

  // ---------- evidence anchoring ----------

  async anchorEvidence(opts: AnchorEvidenceOpts): Promise<{ tx: TxRef }> {
    const res = await ops.anchorEvidence(this.ctx, opts);
    return { tx: this.tx(res.txHash, res.blockNumber) };
  }

  // ---------- wallet ----------

  hasWallet(): boolean {
    return this.ctx.accountHash !== null || this.ctx.publicKeyHex !== null;
  }

  walletAddress(): string | null {
    // Returns the account hash (Casper's address equivalent) preferentially.
    return this.ctx.accountHash ?? this.ctx.publicKeyHex;
  }

  /**
   * Query the CSPR balance of a public key or account hash.
   * Returns { balance: motes string, displayBalance: "X.XXXX CSPR" }.
   */
  async getBalance(publicKeyOrAccountHash?: string): Promise<{ balance: string; displayBalance: string }> {
    const key = publicKeyOrAccountHash ?? this.ctx.publicKeyHex ?? "";
    if (!key) throw new Error("CasperAdapter.getBalance: no public key configured and none provided");
    return ops.getBalance(this.ctx, key);
  }

  // ---------- internals ----------

  private tx(hash: string, blockNumber: string): TxRef {
    return {
      hash,
      blockNumber,
      explorerUrl: `${this.explorerUrl}/transaction/${hash}`,
    };
  }
}

/** Convenience factory. */
export function createCasperAdapter(opts: CasperAdapterOptions = {}): CasperAdapter {
  return new CasperAdapter(opts);
}

/**
 * Re-export capabilityHash for callers — the SAME function is used on EVM and
 * Casper, since the hash is chain-neutral. This is a load-bearing invariant:
 * `capabilityHash("kyc.basic")` produces an identical 32-byte hash on both
 * chains, which is what makes cross-chain credential portability possible.
 */
export { capabilityHash, parseCapability };
