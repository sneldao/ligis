/**
 * Reasoner — the Trust Steward's reasoning interface.
 *
 * Abstracts LLM inference. The default implementation lives in
 * packages/zerog (TEE-verified inference via 0G Compute), but any provider
 * that returns text + verification metadata can plug in.
 */
export interface ReasoningResult {
  text: string;
  verified: boolean;
  model: string;
  provider: string;
}

export interface Reasoner {
  reason(prompt: string): Promise<ReasoningResult>;
}
