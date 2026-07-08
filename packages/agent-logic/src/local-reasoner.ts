/**
 * LocalReasoner — keyword-based fallback reasoner.
 *
 * Used when 0G Compute is unavailable (network issues, service down, wallet
 * unfunded). Produces the same JSON format as the LLM reasoner so
 * `parseReasoning()` works unchanged.
 *
 * The keyword matching is intentionally simple — it's a safety net, not a
 * replacement for TEE-verified inference. When 0G is available, the
 * `ZeroGCompute` reasoner should be preferred.
 */
import type { Reasoner, ReasoningResult } from "@ligis/core";
import { KNOWN_CAPABILITIES } from "./policy.js";

const GOAL_KEYWORDS: Array<{ pattern: RegExp; caps: string[] }> = [
  { pattern: /escrow|hold.*fund|custod/i, caps: ["agent.commerce.escrow"] },
  { pattern: /swap|trade|exchange.*token/i, caps: ["agent.commerce.swap"] },
  {
    pattern: /bridge|cross.chain|transfer.*chain/i,
    caps: ["agent.commerce.bridge"],
  },
  {
    pattern: /recurring|subscription|mandate|recurring.*payment/i,
    caps: ["agent.commerce.recurring"],
  },
  {
    pattern: /x402|http.*payment|pay.*per.*request/i,
    caps: ["agent.commerce.x402"],
  },
  { pattern: /kyc|identity.*verif|accred/i, caps: ["kyc.basic"] },
  { pattern: /accredited|investor|rwa|real.*world/i, caps: ["rwa.accredited"] },
  {
    pattern: /premium.*data|data.*feed|oracle|market.*data/i,
    caps: ["data.premium"],
  },
  { pattern: /cex|retail.*trad|exchange/i, caps: ["trade.cex-retail"] },
];

export class LocalReasoner implements Reasoner {
  async reason(prompt: string): Promise<ReasoningResult> {
    // Extract the goal from the prompt (it's the last line: "Goal: <text>")
    const goalMatch = prompt.match(/Goal:\s*(.+)$/s);
    const goal = goalMatch ? goalMatch[1].trim() : prompt;

    const matched = new Set<string>();
    for (const { pattern, caps } of GOAL_KEYWORDS) {
      if (pattern.test(goal)) {
        for (const c of caps) matched.add(c);
      }
    }
    if (matched.size === 0) {
      matched.add("agent.commerce.escrow");
      matched.add("agent.commerce.swap");
    }

    const caps = KNOWN_CAPABILITIES.filter((c) => matched.has(c.name));
    const capNames = caps.map((c) => `"${c.name}"`).join(", ");
    const text = `{
  "capabilities": [${capNames}],
  "reasoning": "Local policy engine matched keywords in the goal. Detected capabilities: ${caps.map((c) => c.name).join(", ")}."
}`;

    return {
      text,
      verified: false,
      model: "local-keyword-match",
      provider: "local",
    };
  }
}
