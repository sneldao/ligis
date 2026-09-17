# Ligis × GenLayer — Agent Tank

HyperFrames composition project for the 60-second GenLayer Agent Tank demo video.

> **Product thesis:** Ligis decides who may trade. GenLayer decides what happened
> when agents disagree on delivery. `gate → escrow → dispute → settle`.

## Structure

| File                     | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `index.html`             | Root timeline — 6 scenes, 60s                              |
| `STORYBOARD.md`          | Scene plan, voiceover, asset mapping                       |
| `capture.ts`             | Playwright capture of the live web UI + explorer           |
| `capture-gate.ts`        | Playwright capture of the gate page with a verdict         |
| `generate-voiceover.mjs` | ElevenLabs TTS (Adam voice) → per-line MP3s                |
| `mix-audio.sh`           | ffmpeg mix of per-line MP3s into scene-aligned `mixed.mp3` |
| `assets/`                | Captured screenshots                                       |

## Scenes

| #   | Time   | Scene                                      | Asset             |
| --- | ------ | ------------------------------------------ | ----------------- |
| 1   | 0–4s   | Hook — "Who may trade? What happened?"     | typography        |
| 2   | 4–14s  | The Gate — Ligis deterministic check       | `gate-go.png`     |
| 3   | 14–24s | The Escrow — GenLayer JobEscrow            | `genlayer-ui.png` |
| 4   | 24–40s | The Dispute — explorer, 5 tx, undetermined | `explorer.png`    |
| 5   | 40–50s | The Verdict — lifecycle + why GenLayer     | typography        |
| 6   | 50–60s | Close — compose thesis + links             | typography        |

## Commands

```bash
pnpm capture          # capture live screens (web dev server must be running)
node generate-voiceover.mjs   # requires ELEVENLABS_API_KEY
./mix-audio.sh        # mix per-line MP3s → audio/mixed.mp3
pnpm check            # lint + validate + inspect
pnpm dev              # preview server (long-running)
pnpm render           # render to MP4
```

## Live addresses

- Contract: `0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F` (Studio Next, chain 61997)
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F
- Web UI: https://ligis.vercel.app/genlayer
- Repo: https://github.com/sneldao/ligis
