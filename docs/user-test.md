# Ligis — five-user test (Phase 6, gate-day validation)

> Run this with five people who build agents (LangChain / CrewAI / OpenAI
> function-calling — anyone whose tool surface includes sending USDC to a
> counterparty address). They should be new to Ligis. Spend 30 minutes per
> person. The test measures whether the `/gate` UI speaks the buyer's
> language, not whether they like the product.

## Why this exists

The plan's success criterion is "they finish without asking what 'subject'
or 'capability' means." If a single user pauses on either word, the gate
UI has failed — because those are internal vocabulary, not user vocabulary
(see `docs/positioning.md` "Glossary"). The test is a vocabulary test
disguised as a usability test.

## Setup

- Five users, booked separately, no overlap.
- Use a clean browser (no Ligis cookies, no chain wallet connected).
- Open only `https://ligis.vercel.app/gate`.
- Do **not** read them `docs/positioning.md` first. They should learn the
  product from the page.
- Share your screen; do not hover or annotate.

## The one task

> "Your agent is about to pay a vendor $4,200 for a year of premium data
> (capability `data.premium`). Before the wire goes out, decide whether it
> should. You have five minutes. Tell me when you're done and what you
> decided."

That sentence uses four user-words: **agent**, **vendor**, **pay**, **scope**.
What you are looking for is whether the user finds the gate UI without
having to ask "what do I type in the 'subject' box?" or "what's a
'capability'?" If they ask, the test failed at that word.

## What to record

For each user, capture (in a notes doc, not a form):

| Field                    | What it means                                                 |
| ------------------------ | ------------------------------------------------------------- |
| `time_to_first_decision` | Seconds from page-load to "GO" / "STOP" / "I'm done".         |
| `pauses`                 | Where the cursor stops or they ask a question. Mark the word. |
| `final_decision`         | GO, STOP, or "I'm not sure."                                  |
| `decision_correct`       | Was their decision right per the gate's verdict?              |
| `asked_about_subject`    | Did they ask what "subject" means?                            |
| `asked_about_capability` | Did they ask what "capability" means?                         |
| `asked_about_chain`      | Did they ask what "chain" means?                              |
| `felt_safe`              | "Would you wire this after this read?" Y/N.                   |
| `one_word_summary`       | Their one word for the gate, after the task.                  |

## Passing the test

The plan's pass condition is:

> they finish without asking what "subject" or "capability" means

Per user:

- ✅ **Pass** if `asked_about_subject = N` AND `asked_about_capability = N`.
  Their decision is allowed to be wrong (the test measures vocabulary, not
  correctness — `decision_correct` is a separate signal).
- ❌ **Fail** otherwise. Record the exact question they asked and the URL
  fragment when they said it.

Across all five users:

- ✅ **Test passed** if 4 of 5 users pass.
- ❌ **Test failed** if 2+ users pause on the same word — that's a signal,
  not noise, and the word must change.

## When to run

- Once the `/gate` plain-language form is live (✅ already shipped).
- After any rename of `subject` / `capability` / `chain` in the UI.
- After any change to the gate's primary CTA copy.

## After the test

Append the results table to `docs/proofs.md` (no PII — one row per user,
numbered, with `time_to_first_decision`, `pauses`, `asked_about_subject`,
`asked_about_capability`, `felt_safe`, and the final-decision-correctness
rate). The proof row is the audit trail, not the user's narrative.

If the test failed at `subject`, `capability`, or `chain`: those three words
are banned from `/gate` copy in the next patch. The plan called for that
exact pivot, and `scripts/lint-design.mjs` already enforces the surrounding
guardrails (`verifiable credentials`, `under 200ms`, etc.); the next lint
rule to add is "no `subject` in user-facing copy on `/gate`".

## Out of scope

- User's _opinion_ of Ligis ("is this useful?"). Not the test's job.
- Their technical knowledge of credentials or web3. If they ask what a
  credential is, that is also a fail — the UI should never have to.
- Comparing Ligis to competitors. The plan is explicit: one wedge, one
  story, one system.
