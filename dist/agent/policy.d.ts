/**
 * Policy — the capability → action gating table (single source of truth).
 *
 * Defines the known capability namespace, builds the reasoning prompt for 0G
 * Compute, and parses the LLM's response into validated capabilities.
 */
import { type Hex } from "../lib/index.js";
export interface CapabilitySpec {
    name: string;
    hash: Hex;
    description: string;
}
/**
 * The starter capability set. Matches assets/credentials.example.json.
 * The Steward can only self-issue capabilities from this list — unknown
 * capabilities returned by the LLM are flagged but not acted upon.
 */
export declare const KNOWN_CAPABILITIES: CapabilitySpec[];
/** Look up a capability by name or 0x...bytes32 hash. */
export declare function findCapability(nameOrHash: string): CapabilitySpec | undefined;
/**
 * Build the system prompt for the 0G Compute Reasoner.
 *
 * Instructs the LLM to map a natural-language goal to required capabilities
 * from the known set, returning structured JSON.
 */
export declare function buildReasoningPrompt(goal: string): string;
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
export declare function parseReasoning(text: string): ParsedReasoning;
