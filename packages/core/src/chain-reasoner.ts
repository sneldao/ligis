/**
 * ChainReasoner — ordered fallback across several `Reasoner`s.
 *
 * Each `reason()` call tries every reasoner in order and returns the first
 * success. A failing reasoner is skipped for that call only — nothing is
 * permanently marked down, so a provider that recovers is used again on the
 * next call. When every reasoner fails, the thrown error lists each one so
 * the caller can see the whole chain, not just the last failure.
 */
import type { Reasoner, ReasoningResult } from "./reasoner.js";

export interface ChainReasonerOptions {
  /** Display names index-aligned with `reasoners`, for logs and errors. */
  names?: string[];
  /** Called each time a reasoner throws and the next one is tried. */
  onFallback?: (name: string, error: unknown) => void;
}

export class ChainReasoner implements Reasoner {
  constructor(
    private reasoners: Reasoner[],
    private opts: ChainReasonerOptions = {},
  ) {
    if (reasoners.length === 0) {
      throw new Error("ChainReasoner requires at least one reasoner");
    }
  }

  async reason(prompt: string): Promise<ReasoningResult> {
    const failures: string[] = [];
    for (let i = 0; i < this.reasoners.length; i++) {
      try {
        return await this.reasoners[i]!.reason(prompt);
      } catch (error) {
        const name = this.opts.names?.[i] ?? `reasoner[${i}]`;
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${msg}`);
        this.opts.onFallback?.(name, error);
      }
    }
    throw new Error(`all reasoners failed — ${failures.join("; ")}`);
  }
}
