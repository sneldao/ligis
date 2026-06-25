/**
 * Chain-neutral types for Ligis.
 *
 * These types describe identity, capabilities, and credentials in a form that
 * does not assume any particular chain. Concrete chain adapters (EVM, Casper,
 * ...) translate these into chain-native representations at the boundary.
 */

/** 32-byte hex string, used for capability hashes and credential digests. */
export type Bytes32 = `0x${string}`;

/** keccak256 hash of a capability name, encoded as a 32-byte hex string. */
export type CapabilityHash = Bytes32;

/**
 * A DID-style identifier for an agent across chains.
 *
 *   did:ligis:<chain>:<chain-native-id>
 *
 * Examples:
 *   did:ligis:pharos-atlantic:0x39e3D2c9...
 *   did:ligis:casper-testnet:account-hash-abcd...
 */
export type AgentDid = string;

/** Chain identifier in the form `<ecosystem>-<network>` (e.g. "pharos-atlantic"). */
export type ChainId = string;

// ---------- Network configuration (loaded from assets/networks.json) ----------

export interface NativeToken {
  symbol: string;
  name: string;
  decimals: number;
}

export interface Network {
  name: string;
  chainId: number;
  rpcUrl: string;
  fallbackRpcUrls?: string[];
  explorerUrl: string;
  explorerApiUrl: string;
  nativeToken: NativeToken;
}

export interface Deployment {
  pharosAgentId: string;
  credentialRegistry: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
}

export interface NetworksFile {
  networks: Record<string, Network>;
  defaultNetwork: string;
  deployment: Record<string, Deployment>;
}

// ---------- Credentials (chain-neutral envelope) ----------

/**
 * The on-chain view of the latest credential for a (subject, capability) pair.
 * Adapters normalize chain-native values (uint64, timestamp, etc.) into
 * decimal strings for cross-chain consistency.
 */
export interface CredentialView {
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  valid: boolean;
}

/**
 * A signed credential envelope. The `signature` field is chain-scheme specific
 * (ECDSA over EIP-712 for EVM, Ed25519 over canonical JSON for Casper); the
 * adapter that produced it is the only thing that can verify or submit it.
 */
export interface SignedCredential {
  issuer: string;
  subject: string;
  capabilityHash: CapabilityHash;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  digest: Bytes32;
  signature: `0x${string}` | string;
  /** Optional human-readable submission hint (e.g. cast send command). */
  submitCommand?: string;
}

// ---------- Transaction refs ----------

export interface TxRef {
  hash: string;
  blockNumber?: string;
  explorerUrl?: string;
}
