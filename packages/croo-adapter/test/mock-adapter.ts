import type { ChainAdapter } from "@ligis/core";
import type { VerifyResult } from "@ligis/core";

/**
 * Build a mock VerifyResult for testing the risk handler without
 * touching real chain RPC.
 */
export function mockVerifyResult(opts: {
  capable: boolean;
  issuer?: string;
  issuedAtSeconds?: number;
  expiresAtSeconds?: number;
  revoked?: boolean;
  capability?: string;
}): VerifyResult {
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = opts.issuedAtSeconds ?? now - 30 * 24 * 60 * 60; // 30 days ago by default
  const expiresAt = opts.expiresAtSeconds ?? now + 180 * 24 * 60 * 60; // 180 days from now
  return {
    capable: opts.capable,
    capabilityHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    latest: {
      issuer: opts.issuer ?? "0x1234567890123456789012345678901234567890",
      issuedAt: String(issuedAt),
      expiresAt: String(expiresAt),
      revoked: opts.revoked ?? false,
      valid: opts.capable && !opts.revoked,
    },
    subject: "0xtest",
    capability: opts.capability ?? "agent.commerce.escrow",
  };
}

/**
 * Mock chain adapter that returns pre-configured VerifyResults
 * per capability.
 */
export class MockChainAdapter implements Partial<ChainAdapter> {
  readonly chainId = "test";
  readonly chainName = "Test Chain";
  readonly explorerUrl = "https://test";

  private results: Map<string, VerifyResult>;
  public verifyCalls: Array<{ subject: string; capability: string; issuer?: string }> = [];

  constructor(results: Map<string, VerifyResult>) {
    this.results = results;
  }

  async verifyCapability(opts: {
    subject: string;
    capability: string;
    issuer?: string;
  }): Promise<VerifyResult> {
    this.verifyCalls.push(opts);
    return (
      this.results.get(opts.capability) ??
      mockVerifyResult({ capable: false })
    );
  }
}
