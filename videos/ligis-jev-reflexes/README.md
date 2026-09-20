# Ligis — The Gate Has Reflexes (Jev × x402)

HyperFrames composition for the 28-second Twitter/X promo: the Trust Gate's Jev
intent layer judging payments in ~436ms at $0.00 billed.

> **Numbers are real** — captured live 2026-09-20 through the Vercel AI Gateway
> (`typesafe-ai/jev`): legit GO 0.93 · underpay STOP 0.98 · overpay STOP 0.93 ·
> misdirected STOP 0.96 · warm decisions 345–647ms · $0.00000000 billed.
> Source: `scripts/jev-stress-demo.lastrun.txt`, live `curl -i` headers.

## Structure

| File               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `index.html`       | Root timeline — 4 scenes, 28s, 1920×1080              |
| `STORYBOARD.md`    | Scene plan, design-rule compliance, source numbers    |
| `hyperframes.json` | HyperFrames project config (matches sibling projects) |

Design follows `web/DESIGN.md`: warm paper, hairline containment, Fraunces /
Hanken Grotesk / JetBrains Mono, fixed verdict color semantics
(sage=GO, revoke=STOP, terra once). Muted-first — every scene is
self-captioning; no voiceover, no music bed required.

## Commands

```bash
pnpm check    # lint + validate + inspect
pnpm dev      # local preview
pnpm render   # renders ligis-jev-reflexes.mp4 (gitignored)
```

Regenerate the source numbers any time:

```bash
# Terminal 1
set -a; source .env.d/casper.env .env.d/aigateway.env; set +a
LIGIS_JEV_ENABLED=1 LIGIS_GATE_CREDENTIAL_TTL_MS=30000 pnpm x402:dev
# Terminal 2
pnpm demo:jev
```
