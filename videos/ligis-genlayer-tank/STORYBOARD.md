---
format: 1920x1080
message: "Ligis decides who may trade. GenLayer decides what happened when agents disagree on delivery."
arc: Hook → Gate → Escrow → Dispute → Verdict → Close
audience: GenLayer Agent Tank judges
music: driving, cinematic electronica; tempo ~128 BPM; no lyrics
duration: 60s
---

## Frame 1 — Hook (0s..5s)

- scene: Big kinetic type on warm cream — "Who may trade?" then "What happened?"
- duration: 5s
- transition_in: cut
- status: outline
- voiceover: "Agent A hires Agent B. A wallet isn't trust. A payment rail can't settle 'was it good enough?'"
- asset_candidates: none — pure typography

Two questions, one beat each. The hook frames the whole video: eligibility and adjudication are different problems.

## Frame 2 — The Gate (5s..13s)

- scene: Ligis gate UI screenshot — "The gate before the payment." with verdict block showing GO/STOP
- duration: 8s
- transition_in: crossfade
- status: outline
- voiceover: "Ligis answers the first question — a deterministic gate on Casper. One on-chain read: GO or STOP. From chain state, not a Ligis server."
- asset_candidates: gate-go.png (live capture of /gate page)

Show the Ligis gate in action. The verdict block (left-rule, sage/revoke) is the product's wedge. The point: the gate is real, it's on-chain, it's deterministic.

## Frame 3 — The Escrow (13s..25s)

- scene: GenLayer JobEscrow UI screenshot — contract address, job #1 "● Disputed", gate receipt on-chain
- duration: 12s
- transition_in: cut
- status: outline
- voiceover: "The gate receipt goes to GenLayer. create_job locks the stake and stores the Ligis proof on-chain. The seller delivers. The buyer disputes."
- asset_candidates: genlayer-ui.png (live capture of /genlayer page)

Show the JobEscrow contract state. The job is disputed — this is the moment GenLayer becomes load-bearing. The gate receipt is stored on-chain (visible, not just voiceover).

## Frame 4 — The Dispute (25s..40s)

- scene: Explorer screenshot — 5 transactions, all SUCCESS, "Undetermined" consensus on resolve
- duration: 15s
- transition_in: wipe
- status: outline
- voiceover: "GenLayer validators fetch the deliverable from the web. Each one asks an LLM: does this meet the brief? The Equivalence Principle means they agree on the verdict — not the reasoning. This resolve came back undetermined — a real adjudication outcome, not a stub."
- asset_candidates: explorer.png (live capture of explorer-studio-dev.genlayer.com)

The GenLayer-native part. Validators independently fetch the deliverable and judge it. The undetermined result is honest — it shows the AI-jury is real, not scripted.

## Frame 5 — The Verdict (40s..50s)

- scene: Split — left: lifecycle ledger (open → delivered → disputed → resolved_release | resolved_refund), right: "The AI-jury is the missing piece"
- duration: 10s
- transition_in: crossfade
- status: outline
- voiceover: "Without GenLayer, there's no deterministic fallback for 'was the delivery good enough?' That's exactly the gap Intelligent Contracts fill."
- asset_candidates: none — typography + lifecycle visualization

The "why" moment. The lifecycle shows the full path. The text explains why this can't be done deterministically.

## Frame 6 — Close (50s..60s)

- scene: Big type — "Ligis × GenLayer" + "Who may trade. What happened." + links
- duration: 10s
- transition_in: crossfade
- status: outline
- voiceover: "One stack. Ligis gates who may trade. GenLayer adjudicates what happened. Live on Studio Next. One-command repro: pnpm demo:genlayer."
- asset_candidates: contract address, explorer link, repo link

End with the compose thesis restated and the live links. Clean lockup.
