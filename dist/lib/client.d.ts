/**
 * Shared viem client bootstrap for Ligis.
 *
 * Single source of truth for public/wallet client creation, used by the CLI,
 * MCP server, and (Phase 2) the Trust Steward Agent. Consolidates the
 * previously duplicated client setup from cli/index.ts and mcp/server.ts.
 */
import { createPublicClient, createWalletClient, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Deployment, type Network } from "./index.js";
export interface ClientContext {
    publicClient: ReturnType<typeof createPublicClient>;
    walletClient: ReturnType<typeof createWalletClient> | null;
    account: ReturnType<typeof privateKeyToAccount> | null;
    network: Network;
    networkName: string;
    deployment: Deployment;
    rpc: string;
    chain: ReturnType<typeof defineChain>;
}
/**
 * Build a ClientContext from the loaded config + environment.
 *
 * Honors `PHAROS_RPC_URL` (env override of the default RPC) and adds
 * retry/timeout to the transport for resilience.
 */
export declare function getClients(): ClientContext;
/**
 * Assert that a wallet is configured and return the wallet client + account.
 * Throws a clear error if PRIVATE_KEY is not set.
 */
export declare function requireWallet(ctx: ClientContext): {
    walletClient: NonNullable<ClientContext["walletClient"]>;
    account: NonNullable<ClientContext["account"]>;
};
