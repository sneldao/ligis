/**
 * On-chain identity operations for Ligis.
 *
 * Single source of truth for issue / verify / revoke / rotate / sign.
 * These pure functions take a ClientContext and return plain data objects —
 * no console.log, no MCP envelope. Callers (CLI, MCP, Agent) shape the I/O.
 *
 * Consolidated from the previously duplicated implementations in
 * cli/index.ts and mcp/server.ts.
 */
import { type Hex } from "viem";
import { type ClientContext } from "./client.js";
/** Parse a capability arg as either a 32-byte hex hash or a human-readable name. */
export declare function parseCapability(s: string): Hex;
export declare function issueId(ctx: ClientContext, opts: {
    controller?: string;
    tokenUri?: string;
}): Promise<{
    ok: boolean;
    action: string;
    controller: `0x${string}`;
    tokenId: string;
    txHash: `0x${string}`;
    blockNumber: string;
    explorer: string;
}>;
export declare function verify(ctx: ClientContext, opts: {
    subject: string;
    capability: string;
    issuer?: string;
}): Promise<{
    ok: boolean;
    action: string;
    subject: `0x${string}`;
    capability: string;
    capabilityHash: `0x${string}`;
    capable: boolean;
    latest: {
        issuer: `0x${string}`;
        issuedAt: string;
        expiresAt: string;
        revoked: boolean;
        valid: boolean;
    };
    network: string;
    chainId: number;
}>;
export declare function revoke(ctx: ClientContext, opts: {
    subject: string;
    capability: string;
    nonce: string;
    issuerKey?: string;
}): Promise<{
    ok: boolean;
    action: string;
    subject: `0x${string}`;
    capability: string;
    nonce: string;
    txHash: `0x${string}`;
    blockNumber: string;
    explorer: string;
}>;
export declare function rotate(ctx: ClientContext, opts: {
    tokenId: string;
    newController: string;
}): Promise<{
    ok: boolean;
    action: string;
    tokenId: string;
    from: `0x${string}`;
    to: `0x${string}`;
    txHash: `0x${string}`;
    blockNumber: string;
    explorer: string;
}>;
export declare function signCredential(ctx: ClientContext, opts: {
    issuerKey: string;
    subject: string;
    capability: string;
    expiresInSeconds?: number;
}): Promise<{
    ok: boolean;
    action: string;
    issuer: `0x${string}`;
    subject: `0x${string}`;
    capability: string;
    capabilityHash: `0x${string}`;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    digest: `0x${string}`;
    signature: `0x${string}`;
    submitCommand: string;
}>;
