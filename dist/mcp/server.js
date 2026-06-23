/**
 * Ligis — MCP Server
 *
 * Exposes the four core Identity Skills (issue, verify, revoke, rotate) plus two
 * helpers (hash, sign) as MCP tools. Compatible with Claude Code, Codex, and any
 * MCP-aware client.
 *
 * Run with:  npx -y tsx src/mcp/server.ts
 * Or:        npm run mcp:dev
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { CREDENTIAL_REGISTRY_ABI, PHAROS_AGENT_ID_ABI, capabilityHash, getClients, issueId, revoke, rotate, signCredential, verify, } from "../lib/index.js";
import { TrustSteward } from "../agent/index.js";
import { ZeroGCompute, loadZeroGConfig } from "../zerog/compute.js";
import { ZeroGStorage, loadZeroGStorageConfig } from "../zerog/storage.js";
export { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI };
// ---------- Shared client context (created once at startup) ----------
const ctx = getClients();
/** Wrap a plain data object as an MCP tool response. */
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
// ---------- MCP server bootstrap ----------
const server = new Server({ name: "ligis", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ligis-issue-id",
            description: "Mint a portable Agent ID NFT (PharosAgentID) for a controller wallet. Returns the new tokenId. Requires PRIVATE_KEY in env. Use this first to give an agent an on-chain identity before issuing or verifying credentials.",
            inputSchema: {
                type: "object",
                properties: {
                    tokenUri: {
                        type: "string",
                        description: "Optional metadata URI (IPFS CID, HTTPS URL, or empty). Stored on-chain as the token's metadata pointer.",
                    },
                    controller: {
                        type: "string",
                        description: "Optional controller address. If omitted, the caller's wallet becomes the controller.",
                    },
                },
            },
        },
        {
            name: "ligis-verify",
            description: "Read-only. Returns whether a subject wallet currently holds a valid (non-revoked, non-expired) credential for a given capability. Optionally scoped to a specific issuer. Does NOT require PRIVATE_KEY.",
            inputSchema: {
                type: "object",
                properties: {
                    subject: {
                        type: "string",
                        description: "The agent's controller wallet (0x...)",
                    },
                    capability: {
                        type: "string",
                        description: "Either a human-readable name (e.g. 'agent.commerce.escrow') or a 0x...bytes32 hash. Human names are keccak256-hashed internally.",
                    },
                    issuer: {
                        type: "string",
                        description: "Optional. If provided, only credentials from this issuer are considered.",
                    },
                },
                required: ["subject", "capability"],
            },
        },
        {
            name: "ligis-revoke",
            description: "Revoke a previously-issued credential. Only the original issuer can revoke. Revocation is permanent. By default uses the caller's $PRIVATE_KEY wallet; pass issuerKey to use a different issuer's key.",
            inputSchema: {
                type: "object",
                properties: {
                    subject: {
                        type: "string",
                        description: "The agent's controller wallet (0x...)",
                    },
                    capability: {
                        type: "string",
                        description: "Either a human-readable name (e.g. 'agent.commerce.escrow') or a 0x...bytes32 hash.",
                    },
                    nonce: {
                        type: "string",
                        description: "The credential nonce returned at issue time",
                    },
                    issuerKey: {
                        type: "string",
                        description: "Optional. Issuer's private key. If provided, used to sign the revoke tx. If omitted, the caller's $PRIVATE_KEY is used.",
                    },
                },
                required: ["subject", "capability", "nonce"],
            },
        },
        {
            name: "ligis-rotate",
            description: "Rotate the controller key of an existing Agent ID. The caller must be the current controller. The ID NFT moves to the new controller; credentials issued under the old controller address do NOT follow (re-issue them on the new controller).",
            inputSchema: {
                type: "object",
                properties: {
                    tokenId: {
                        type: "string",
                        description: "The Agent ID tokenId to rotate",
                    },
                    newController: {
                        type: "string",
                        description: "The new controller wallet (0x...)",
                    },
                },
                required: ["tokenId", "newController"],
            },
        },
        {
            name: "ligis-hash",
            description: "Compute the keccak256 hash of a capability name. Returns a 0x...bytes32. Use this to get a hash without deploying, or to verify that off-chain and on-chain names match.",
            inputSchema: {
                type: "object",
                properties: {
                    capability: {
                        type: "string",
                        description: "Human-readable capability name (e.g. 'agent.commerce.escrow')",
                    },
                },
                required: ["capability"],
            },
        },
        {
            name: "ligis-sign-credential",
            description: "Build and sign an EIP-712 credential attestation off-chain. Returns the digest, signature, and the exact `cast send` command to submit it. Use this on the issuer side; the resulting signature can be submitted by anyone.",
            inputSchema: {
                type: "object",
                properties: {
                    issuerKey: {
                        type: "string",
                        description: "Issuer's private key (0x...)",
                    },
                    subject: {
                        type: "string",
                        description: "The agent's controller wallet (0x...)",
                    },
                    capability: {
                        type: "string",
                        description: "Either a human-readable name (e.g. 'agent.commerce.escrow') or a 0x...bytes32 hash.",
                    },
                    expiresInSeconds: {
                        type: "number",
                        description: "Optional. Seconds from now until expiry. Default 2,592,000 (30 days).",
                    },
                },
                required: ["issuerKey", "subject", "capability"],
            },
        },
        {
            name: "ligis-run-steward",
            description: "Run the Trust Steward Agent loop: boot (mint Agent ID if needed) → reason (0G Compute maps the natural-language goal to required capabilities) → gate (isCapable check) → act (self-issue any missing credentials) → record (write evidence manifest to 0G Storage, anchor the root hash on-chain via setTokenURI). Returns the full evidence manifest with all tx hashes. Requires PRIVATE_KEY and ZEROG_PRIVATE_KEY in env.",
            inputSchema: {
                type: "object",
                properties: {
                    goal: {
                        type: "string",
                        description: "Natural-language goal (e.g. 'open an escrow with counterparty X'). The 0G Compute LLM maps this to required capabilities.",
                    },
                    dryRun: {
                        type: "boolean",
                        description: "If true, reason + gate only — no on-chain writes or 0G Storage upload. Useful for testing the reasoning step.",
                    },
                },
                required: ["goal"],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "ligis-issue-id":
                return ok(await issueId(ctx, args));
            case "ligis-verify":
                return ok(await verify(ctx, args));
            case "ligis-revoke":
                return ok(await revoke(ctx, args));
            case "ligis-rotate":
                return ok(await rotate(ctx, args));
            case "ligis-hash":
                return ok({
                    ok: true,
                    action: "hash",
                    input: args.capability,
                    keccak256: capabilityHash(args.capability),
                });
            case "ligis-sign-credential":
                return ok(await signCredential(ctx, args));
            case "ligis-run-steward": {
                const { goal, dryRun } = args;
                const reasoner = new ZeroGCompute(loadZeroGConfig());
                const store = new ZeroGStorage(loadZeroGStorageConfig());
                const steward = new TrustSteward(ctx, reasoner, store);
                return ok(await steward.run(goal, { dryRun }));
            }
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ ok: false, error: message, tool: name }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`ligis MCP server running on stdio (network: ${ctx.networkName})`);
//# sourceMappingURL=server.js.map