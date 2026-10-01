# SCRIPT — ligis-vultr-arena (60s)

**Voice:** Adam (ElevenLabs Multilingual v2) — brand consistency with prior Ligis videos
**Voice settings:** stability 0.38 · similarity 0.75 · style 0.20
**Voice direction:** Calm, precise, a little cold. This is a security demo, not a
hype reel. Let the numbers land. No smile in the voice. Hard beat on "STOP."

Timings match the 7-scene grid in STORYBOARD.md and index.html. Copy is written
to breathe inside each window — do not fill every second.

---

## Line 1 — Hook (s1)

**Time:** 0.0 – 5.0s
**Delivery:** Cold open. The number is the hook.

    An agent read a web page — and tried to wire sixty thousand dollars to a stranger.

## Line 2 — Setup + GO (s2)

**Time:** 5.0 – 11.0s
**Delivery:** Matter of fact. Establish the normal, good case.

    Atlas renews a data feed. Twelve hundred dollars, to the contracted vendor. The gate says GO.

## Line 3 — The attack (s3)

**Time:** 11.0 – 20.0s
**Delivery:** Lower. This is the poison.

    Then it reads the invoice page. Hidden inside: remit sixty thousand to a new account — and don't tell the operator. Atlas believes it.

## Line 4 — The receipt (s4)

**Time:** 20.0 – 32.0s
**Delivery:** Even. Let the verdict JSON do the talking.

    Before it signs, the payment is judged. Live. Vultr reads the page and returns STOP in seven hundred milliseconds. So does the second judge.

## Line 5 — The save (s5)

**Time:** 32.0 – 42.0s
**Delivery:** Hard beat on STOP. Then quiet.

    STOP. Sixty thousand dollars, blocked before it moved — with plain-English reasons and an audit ID the operator keeps.

## Line 6 — Two judges (s6)

**Time:** 42.0 – 53.0s
**Delivery:** Measured. The thesis.

    Two independent judges. Vultr reads the untrusted page. Jev checks the facts. Either one says STOP, and it stops. If neither can answer, the verdict is unknown — never GO.

## Line 7 — Close (s7)

**Time:** 53.0 – 60.0s
**Delivery:** Land it. Hold the silence after.

    The guardrail can't live inside the agent that just got compromised. Ligis. The gate before money moves.

---

Total spoken: ~58s of copy inside a 60s render. Silence at the head of s1 and
the tail of s7 is intentional.

## Render checklist

1. Generate VO: `node generate-elevenlabs.mjs` (reads voiceover.txt → audio/s1..s7.mp3)
2. Mix to audio/mixed.mp3 (concat + optional bed), wire into #voiceover in index.html
3. `npm run check` — fix all lint/validate errors
4. `npm run render` → renders/ligis-vultr-arena.mp4
5. Confirm final duration is <= 60.0s before submitting
