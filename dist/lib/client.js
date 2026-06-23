/**
 * Shared viem client bootstrap for Ligis.
 *
 * Single source of truth for public/wallet client creation, used by the CLI,
 * MCP server, and (Phase 2) the Trust Steward Agent. Consolidates the
 * previously duplicated client setup from cli/index.ts and mcp/server.ts.
 */
import { createPublicClient, createWalletClient, defineChain, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./index.js";
/**
 * Build a ClientContext from the loaded config + environment.
 *
 * Honors `PHAROS_RPC_URL` (env override of the default RPC) and adds
 * retry/timeout to the transport for resilience.
 */
export function getClients() {
    const { networkName, network, deployment } = loadConfig();
    const rpc = process.env.PHAROS_RPC_URL || network.rpcUrl;
    const transport = http(rpc, { retryCount: 3, timeout: 20_000 });
    const publicClient = createPublicClient({ transport });
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : null;
    const chain = defineChain({
        id: network.chainId,
        name: network.name,
        nativeCurrency: network.nativeToken,
        rpcUrls: { default: { http: [rpc] } },
    });
    const walletClient = account
        ? createWalletClient({ account, transport, chain })
        : null;
    return { publicClient, walletClient, account, network, networkName, deployment, rpc, chain };
}
/**
 * Assert that a wallet is configured and return the wallet client + account.
 * Throws a clear error if PRIVATE_KEY is not set.
 */
export function requireWallet(ctx) {
    if (!ctx.walletClient || !ctx.account) {
        throw new Error("PRIVATE_KEY is not set. Set it in the environment to use write operations.");
    }
    return { walletClient: ctx.walletClient, account: ctx.account };
}
//# sourceMappingURL=client.js.map