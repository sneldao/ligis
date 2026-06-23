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
import { CREDENTIAL_REGISTRY_ABI, PHAROS_AGENT_ID_ABI } from "../lib/index.js";
export { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI };
