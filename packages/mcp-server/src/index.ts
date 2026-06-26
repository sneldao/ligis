/**
 * Ligis — MCP Server
 *
 * Exposes Ligis's chain-agnostic operations as MCP tools. All tools accept an
 * optional `chain` argument; today only `evm` is supported, with `casper`
 * reserved for the upcoming Casper adapter.
 *
 * Compatible with Claude Code, Codex, and any MCP-aware client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { capabilityHash, type ChainAdapter } from "@ligis/core";
import { EvmAdapter } from "@ligis/adapter-evm";
import { CasperAdapter } from "@ligis/adapter-casper";
import { TrustSteward } from "@ligis/agent-logic";
import {
  ZeroGCompute,
  ZeroGStorage,
  loadZeroGConfig,
  loadZeroGStorageConfig,
} from "@ligis/zerog";

// ---------- Adapter resolution ----------

/** Lazy, per-chain adapter cache so MCP startup is cheap and no chain RPC is hit unless used. */
const adapterCache = new Map<string, ChainAdapter>();

function getAdapter(chain: string | undefined): ChainAdapter {
  const key = (chain ?? "evm").toLowerCase();
  const cached = adapterCache.get(key);
  if (cached) return cached;
  let adapter: ChainAdapter;
  switch (key) {
    case "evm":
    case "pharos":
      adapter = new EvmAdapter();
      break;
    case "casper":
      adapter = new CasperAdapter();
      break;
    default:
      throw new Error(`Unknown chain: ${key}. Supported: evm, casper.`);
  }
  adapterCache.set(key, adapter);
  return adapter;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const chainProperty = {
  type: "string",
  description: "Target chain: 'evm' (default, Pharos + EVM) or 'casper' (Casper Testnet).",
};

// ---------- MCP server ----------

const server = new Server(
  { name: "ligis", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ligis-issue-id",
      description:
        "Mint a portable Agent ID for a controller wallet. Returns the new agent id and DID. Requires PRIVATE_KEY in env. Use this first to give an agent an on-chain identity before issuing or verifying credentials.",
      inputSchema: {
        type: "object",
        properties: {
          tokenUri: { type: "string", description: "Optional metadata URI (IPFS CID, HTTPS URL, 0g://...)" },
          controller: { type: "string", description: "Optional controller address. Defaults to the caller's wallet." },
          chain: chainProperty,
        },
      },
    },
    {
      name: "ligis-verify",
      description:
        "Read-only. Returns whether a subject wallet currently holds a valid (non-revoked, non-expired) credential for a given capability. Optionally scoped to a specific issuer.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "The agent's controller wallet" },
          capability: { type: "string", description: "Capability name (e.g. 'agent.commerce.escrow') or 0x...bytes32 hash." },
          issuer: { type: "string", description: "Optional. If provided, only credentials from this issuer are considered." },
          chain: chainProperty,
        },
        required: ["subject", "capability"],
      },
    },
    {
      name: "ligis-revoke",
      description:
        "Revoke a previously-issued credential. Only the original issuer can revoke. Permanent. Defaults to the caller's $PRIVATE_KEY; pass issuerKey to use a different issuer.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string" },
          capability: { type: "string" },
          nonce: { type: "string", description: "The credential nonce returned at issue time" },
          issuerKey: { type: "string", description: "Optional issuer private key (falls back to $PRIVATE_KEY)" },
          chain: chainProperty,
        },
        required: ["subject", "capability", "nonce"],
      },
    },
    {
      name: "ligis-rotate",
      description:
        "Rotate the controller of an existing Agent ID. The caller must be the current controller. Credentials issued under the old controller do NOT follow — re-issue them after rotation.",
      inputSchema: {
        type: "object",
        properties: {
          tokenId: { type: "string", description: "Agent id to rotate" },
          newController: { type: "string" },
          chain: chainProperty,
        },
        required: ["tokenId", "newController"],
      },
    },
    {
      name: "ligis-hash",
      description:
        "Compute the keccak256 hash of a capability name. Chain-neutral — the same hash identifies the capability on every Ligis chain.",
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string", description: "Human-readable capability name" },
        },
        required: ["capability"],
      },
    },
    {
      name: "ligis-sign-credential",
      description:
        "Build and sign a credential off-chain. Returns digest, signature, and a submission hint. The chain adapter's native signature scheme is used (EIP-712 for EVM).",
      inputSchema: {
        type: "object",
        properties: {
          issuerKey: { type: "string", description: "Issuer's private key" },
          subject: { type: "string" },
          capability: { type: "string" },
          expiresInSeconds: { type: "number", description: "Default 2,592,000 (30 days)." },
          chain: chainProperty,
        },
        required: ["issuerKey", "subject", "capability"],
      },
    },
    {
      name: "ligis-run-steward",
      description:
        "Run the Trust Steward loop: boot (mint Agent ID if needed) → reason (0G Compute) → gate (verify capabilities) → act (self-issue missing creds) → record (write evidence to 0G Storage, anchor root hash on-chain). Returns the full evidence manifest. Requires PRIVATE_KEY and ZEROG_PRIVATE_KEY in env.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Natural-language goal" },
          dryRun: { type: "boolean", description: "If true, reason + gate only — no on-chain writes or 0G Storage upload." },
          chain: chainProperty,
        },
        required: ["goal"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const chain = args.chain as string | undefined;
  try {
    switch (name) {
      case "ligis-issue-id": {
        const adapter = getAdapter(chain);
        return ok(await adapter.issueAgentId({
          controller: args.controller as string | undefined,
          tokenUri: args.tokenUri as string | undefined,
        }));
      }
      case "ligis-verify": {
        const adapter = getAdapter(chain);
        return ok(await adapter.verifyCapability({
          subject: args.subject as string,
          capability: args.capability as string,
          issuer: args.issuer as string | undefined,
        }));
      }
      case "ligis-revoke": {
        const adapter = getAdapter(chain);
        return ok(await adapter.revokeCredential({
          subject: args.subject as string,
          capability: args.capability as string,
          nonce: args.nonce as string,
          issuerKey: args.issuerKey as string | undefined,
        }));
      }
      case "ligis-rotate": {
        const adapter = getAdapter(chain);
        return ok(await adapter.rotateAgentId({
          agentId: args.tokenId as string,
          newController: args.newController as string,
        }));
      }
      case "ligis-hash":
        return ok({
          ok: true,
          action: "hash",
          input: args.capability as string,
          keccak256: capabilityHash(args.capability as string),
        });
      case "ligis-sign-credential": {
        const adapter = getAdapter(chain);
        return ok(await adapter.signCredential({
          issuerKey: args.issuerKey as string,
          subject: args.subject as string,
          capability: args.capability as string,
          expiresInSeconds: args.expiresInSeconds as number | undefined,
        }));
      }
      case "ligis-run-steward": {
        const adapter = getAdapter(chain);
        const reasoner = new ZeroGCompute(loadZeroGConfig());
        const store = new ZeroGStorage(loadZeroGStorageConfig());
        const steward = new TrustSteward(adapter, reasoner, store);
        return ok(await steward.run(args.goal as string, { dryRun: args.dryRun as boolean | undefined }));
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, tool: name }, null, 2) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ligis MCP server running on stdio");
