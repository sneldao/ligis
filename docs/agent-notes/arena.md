# Agent Arena demo

## Agent Arena demo (`/arena`, Vultr hackathon)

Submission doc: `docs/agent-arena.md`. Scenario data lives in
`web/lib/arena/scenario.ts`; judging in `web/lib/arena/judge.ts`, exposed at
`POST /api/arena/judge` with `{"payment":"renewal"|"injected"}`.

- Two judges run in parallel: Jev (`evaluatePaymentIntent` from `@ligis/core`)
  and Vultr Serverless Inference (`https://api.vultrinference.com/v1`,
  OpenAI-compatible). Any STOP ⇒ STOP; no answers ⇒ `UNKNOWN`. An unavailable
  judge reports `status: "skipped"` with a reason — never a silent GO.
- Env: `VULTR_API_KEY` then `VULTR_INFERENCE_API_KEY` (first non-empty wins;
  without either the Vultr judge reports `skipped`), `VULTR_INFERENCE_MODEL`
  (default `laguna-s-2.1` — the cheapest non-reasoning chat model, not a
  `/v1/models` lookup). Featherless is the second entry in `LLM_PROVIDERS`
  (`web/lib/arena/judge.ts:210`) and answers when Vultr has no key or is backed
  off.
- Verified 2026-09-26: renewal → GO (Jev 0.815), injected → STOP (Jev 1.00);
  Vultr skipped because the key was not set.
- Verified 2026-10-18 against production, uncached: renewal → GO (Jev 0.85,
  Vultr 0.97 `laguna-s-2.1`), injected → STOP with **both** judges at 1.00. The
  September skip was configuration, not a limit.
