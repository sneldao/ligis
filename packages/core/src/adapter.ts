/**
 * ChainAdapter — the boundary between chain-neutral logic (Trust Steward,
 * policy engine, evidence builder) and chain-native execution.
 *
 * Concrete adapters live in:
 *   - packages/adapter-evm   (Pharos and any EVM)
 *   - packages/adapter-casper (Casper, planned)
 *
 * Every operation accepts and returns chain-neutral types from `./types`.
 * Adapters convert to/from chain-native representations internally.
 */
import type {
  CapabilityHash,
  CredentialView,
  SignedCredential,
  TxRef,
} from "./types.js";

/** A capability is identified either by human-readable name or by its hash. */
export type CapabilityRef = string | CapabilityHash;

export interface VerifyResult {
  capable: boolean;
  capabilityHash: CapabilityHash;
  latest: CredentialView;
  /** Chain-formatted subject as understood by the adapter (echo of input, normalized). */
  subject: string;
  capability: string;
}

export interface IssueAgentIdOpts {
  /** Defaults to the adapter's wallet address. */
  controller?: string;
  /** Off-chain metadata pointer (IPFS CID, https://, 0g://, ...). */
  tokenUri?: string;
}

export interface IssueAgentIdResult {
  /** Chain-native agent id (e.g. tokenId on EVM, account hash on Casper). */
  agentId: string;
  /** The same id wrapped as a DID (`did:ligis:<chain>:<id>`). */
  did: string;
  controller: string;
  tx: TxRef;
}

export interface SignCredentialOpts {
  issuerKey: string;
  subject: string;
  capability: CapabilityRef;
  /** Defaults to 30 days. */
  expiresInSeconds?: number;
}

export interface RevokeOpts {
  subject: string;
  capability: CapabilityRef;
  nonce: string;
  /** Issuer key; falls back to the adapter's wallet if omitted. */
  issuerKey?: string;
}

export interface AnchorEvidenceOpts {
  /** Chain-native agent id, NOT a DID. */
  agentId: string;
  /** Pointer to evidence (typically `0g://<rootHash>`). */
  uri: string;
}

/**
 * The chain-neutral contract. Every method is async and returns plain JSON-safe
 * data. No viem types, no Casper SDK types, no `bigint` leak across this line.
 */
export interface ChainAdapter {
  /** Stable chain identifier: `<ecosystem>-<network>` (e.g. "pharos-atlantic"). */
  readonly chainId: string;
  /** Human-readable chain name (e.g. "Pharos Atlantic Testnet"). */
  readonly chainName: string;
  /** Block explorer base URL. */
  readonly explorerUrl: string;

  // ---------- identity ----------

  /** Resolve a controller address → agent id, or null if none. */
  getAgentId(controller: string): Promise<string | null>;

  /** Mint a new agent id. */
  issueAgentId(opts?: IssueAgentIdOpts): Promise<IssueAgentIdResult>;

  /** Rotate the controller of an existing agent id. */
  rotateAgentId(opts: { agentId: string; newController: string }): Promise<{ tx: TxRef }>;

  // ---------- credentials ----------

  /** Read whether a subject currently holds a valid credential for a capability. */
  verifyCapability(opts: {
    subject: string;
    capability: CapabilityRef;
    issuer?: string;
  }): Promise<VerifyResult>;

  /** Build and sign a credential off-chain. */
  signCredential(opts: SignCredentialOpts): Promise<SignedCredential>;

  /** Submit a signed credential on-chain. */
  submitCredential(signed: SignedCredential): Promise<{ tx: TxRef }>;

  /** Revoke a previously-issued credential. */
  revokeCredential(opts: RevokeOpts): Promise<{ tx: TxRef }>;

  // ---------- evidence anchoring ----------

  /** Anchor an off-chain evidence pointer (uri) to an agent id on-chain. */
  anchorEvidence(opts: AnchorEvidenceOpts): Promise<{ tx: TxRef }>;

  // ---------- wallet ----------

  /** True if the adapter has a configured signing wallet. */
  hasWallet(): boolean;

  /** Chain-formatted wallet address, or null if no wallet is configured. */
  walletAddress(): string | null;
}
