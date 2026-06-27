/**
 * Policy — the capability → action gating table (single source of truth).
 *
 * Defines the known capability namespace, builds the reasoning prompt for 0G
 * Compute, and parses the LLM's response into validated capabilities.
 */
import { capabilityHash, type CapabilityHash } from "@ligis/core";

// ---------- Capability registry ----------

export interface CapabilitySpec {
  name: string;
  hash: CapabilityHash;
  description: string;
}

/**
 * The starter capability set. Matches assets/credentials.example.json.
 * The Steward can only self-issue capabilities from this list — unknown
 * capabilities returned by the LLM are flagged but not acted upon.
 */
export const KNOWN_CAPABILITIES: CapabilitySpec[] = [
  { name: "kyc.basic", hash: capabilityHash("kyc.basic"), description: "Basic KYC verification" },
  { name: "trade.cex-retail", hash: capabilityHash("trade.cex-retail"), description: "Retail CEX trading" },
  { name: "rwa.accredited", hash: capabilityHash("rwa.accredited"), description: "Accredited investor status" },
  { name: "agent.commerce.escrow", hash: capabilityHash("agent.commerce.escrow"), description: "Open and manage escrows" },
  { name: "agent.commerce.swap", hash: capabilityHash("agent.commerce.swap"), description: "Execute token swaps" },
  { name: "agent.commerce.bridge", hash: capabilityHash("agent.commerce.bridge"), description: "Cross-chain bridge operations" },
  { name: "agent.commerce.recurring", hash: capabilityHash("agent.commerce.recurring"), description: "Recurring payment mandates" },
  { name: "agent.commerce.x402", hash: capabilityHash("agent.commerce.x402"), description: "x402 HTTP payment protocol" },
  { name: "data.premium", hash: capabilityHash("data.premium"), description: "Premium data feed access" },
];

/** Look up a capability by name or 0x...bytes32 hash. */
export function findCapability(nameOrHash: string): CapabilitySpec | undefined {
  return KNOWN_CAPABILITIES.find(
    (c) => c.name === nameOrHash || c.hash.toLowerCase() === nameOrHash.toLowerCase(),
  );
}

// ---------- Reasoning prompt ----------

/**
 * Build the system prompt for the 0G Compute Reasoner.
 *
 * Instructs the LLM to map a natural-language goal to required capabilities
 * from the known set, returning structured JSON.
 */
export function buildReasoningPrompt(goal: string): string {
  const capList = KNOWN_CAPABILITIES.map(
    (c) => `  - ${c.name}: ${c.description}`,
  ).join("\n");

  return `You are a Trust Steward agent on a Casper or Pharos blockchain. Given a natural-language goal, determine which capabilities are required to accomplish it.

Context: The agent operates in a DeFi/RWA ecosystem where:
- Tokenized real-world assets (RWA) require accredited investor credentials
- Premium data feeds (oracle prices, market data) require data.premium capability
- x402 HTTP payments enable per-request micropayments for API access
- Escrow, swap, bridge, and recurring payment capabilities enable autonomous commerce
- KYC verification is required for regulated financial activities

Available capabilities:
${capList}

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "capabilities": ["agent.commerce.escrow", ...],
  "reasoning": "brief explanation of why these capabilities are required"
}

Only include capabilities from the list above. If no capabilities are needed, return an empty array.

Goal: ${goal}`;
}

// ---------- Reasoning parser ----------

export interface ParsedReasoning {
  capabilities: CapabilitySpec[];
  reasoning: string;
  unknown: string[];
}

/**
 * Parse the LLM's text response into structured capabilities.
 *
 * Handles JSON extraction (strips markdown code fences), validates each
 * capability name against KNOWN_CAPABILITIES, and separates known from
 * unknown.
 */
export function parseReasoning(text: string): ParsedReasoning {
  const json = extractJson(text);
  if (!json) {
    return { capabilities: [], reasoning: text, unknown: [] };
  }

  const rawCaps: string[] = Array.isArray(json.capabilities) ? json.capabilities : [];
  const reasoning: string = typeof json.reasoning === "string" ? json.reasoning : "";

  const capabilities: CapabilitySpec[] = [];
  const unknown: string[] = [];

  for (const name of rawCaps) {
    const spec = findCapability(name);
    if (spec) {
      capabilities.push(spec);
    } else {
      unknown.push(name);
    }
  }

  return { capabilities, reasoning, unknown };
}

/**
 * Extract a JSON object from a text string that may be wrapped in markdown
 * code fences or surrounded by prose.
 */
function extractJson(text: string): { capabilities: unknown; reasoning?: unknown } | null {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  // Try finding the first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}
