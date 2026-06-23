/**
 * Shared types for the Pharos Agent Identity Skill.
 * Used by both the CLI (src/cli/index.ts) and the MCP server (src/mcp/server.ts).
 */
import type { Address, Hex } from "viem";
export type { Address, Hex };
/** A single capability credential. */
export interface Credential {
    issuer: Address;
    subject: Address;
    capabilityHash: Hex;
    issuedAt: bigint;
    expiresAt: bigint;
    nonce: bigint;
    signature: Hex;
}
/** A signed EIP-712 envelope that can be submitted on-chain. */
export interface SignedEnvelope extends Credential {
    digest: Hex;
}
/** The view returned by CredentialRegistry.latestCredential(subject, cap). */
export interface CredentialView {
    issuer: Address;
    issuedAt: bigint;
    expiresAt: bigint;
    revoked: boolean;
    valid: boolean;
}
/** Network configuration loaded from assets/networks.json. */
export interface Network {
    name: string;
    chainId: number;
    rpcUrl: string;
    fallbackRpcUrls?: string[];
    explorerUrl: string;
    explorerApiUrl: string;
    nativeToken: {
        symbol: string;
        name: string;
        decimals: number;
    };
}
/** A deployment record keyed by network (in assets/networks.json). */
export interface Deployment {
    pharosAgentId: Address;
    credentialRegistry: Address;
    chainId: number;
    deployer: Address;
    deployedAt: string;
}
/** The full assets/networks.json shape. */
export interface NetworksFile {
    networks: Record<string, Network>;
    defaultNetwork: string;
    deployment: Record<string, Deployment>;
}
