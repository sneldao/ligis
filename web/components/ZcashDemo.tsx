"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { DecisionVerdict } from "@/components/DecisionVerdict";
import { ZkCredentialResultView } from "@/components/ZkCredential";
import { Term } from "@/components/Term";
import { shortHash } from "@/lib/decision-copy";
import type { Decision } from "@/lib/decide";
import { zecAmount } from "@/lib/payment-asset";

/**
 * The guided Zecathon story, one step at a time, against the real API:
 *   1. no proof            → STOP (a shielded payee has no public credential)
 *   2. private proof       → GO
 *   3. same proof replayed → STOP
 *   4. revoked credential  → STOP
 * Each step is an explicit click (a verified proof burns its nullifier, so
 * nothing here runs from an effect).
 */
type StepId = "check" | "prove" | "replay" | "revoked";
type ZkProof = {
  proof: string;
  contextLabel: string;
  publicInputs: Record<string, string>;
};
type DemoProof = {
  payee: string;
  root: string;
  provedInMs: number;
  proofBytes: number;
  zkProof: ZkProof;
};
type StepState =
  | { phase: "idle" }
  | { phase: "running"; label: string }
  | { phase: "done"; decision: Decision; proof?: DemoProof }
  | { phase: "error"; message: string; offline?: boolean };

const STEPS: Array<{
  id: StepId;
  title: string;
  story: string;
  action: string;
  expect: string;
}> = [
  {
    id: "check",
    title: "Check the payment, no proof",
    story:
      "The agent asks the gate before paying. The payee is shielded, so there is no public credential to read. That's the point of shielding.",
    action: "Run the gate",
    expect: "Expect STOP: nothing public proves this payee is vetted.",
  },
  {
    id: "prove",
    title: "The payee proves its credential privately",
    story:
      "The payee generates a zero-knowledge proof: “I hold a valid escrow credential, issued to this address, in the current registry.” The gate learns that, and nothing else.",
    action: "Generate proof and send it",
    expect: "Expect GO: the proof answers the verified-payee check.",
  },
  {
    id: "replay",
    title: "An attacker replays the same proof",
    story:
      "Someone copies the proof and sends it again to get paid twice. Each proof carries a one-time tag the gate has already recorded.",
    action: "Replay the proof",
    expect: "Expect STOP: replay blocked.",
  },
  {
    id: "revoked",
    title: "A revoked credential tries to get paid",
    story:
      "Another payee's credential was revoked by its issuer. It can still make a mathematically valid proof, but only against the old registry, which the gate no longer trusts.",
    action: "Try the revoked credential",
    expect: "Expect STOP: revoked credentials drop out of the registry.",
  },
];

export function ZcashDemo({
  live,
  payee,
  revokedPayee,
  capability,
}: {
  live: boolean;
  payee: string;
  revokedPayee: string;
  capability: string;
}) {
  const [states, setStates] = useState<Record<StepId, StepState>>({
    check: { phase: "idle" },
    prove: { phase: "idle" },
    replay: { phase: "idle" },
    revoked: { phase: "idle" },
  });
  const proofRef = useRef<ZkProof | null>(null);
  const headings = useRef<Record<string, HTMLHeadingElement | null>>({});

  const doneCount = STEPS.filter((s) => states[s.id].phase === "done").length;
  const current = STEPS.find((s) => states[s.id].phase !== "done")?.id;
  const set = (id: StepId, s: StepState) =>
    setStates((prev) => ({ ...prev, [id]: s }));

  const intentFor = (p: string, zkProof?: ZkProof) => ({
    payee: p,
    amountUsd: 25,
    ...zecAmount("0.25"),
    purpose: "Release escrowed ZEC to the contracted counterparty",
    capability,
    mandate: { payees: [p], maxUsd: 50, expectedUsd: 25 },
    ...(zkProof ? { zkProof } : {}),
  });

  async function gate(body: object): Promise<Decision> {
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data as Decision;
  }

  async function prove(scenario: "holder" | "revoked"): Promise<DemoProof> {
    const res = await fetch("/api/zk/demo-proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const data = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) {
      const err = new Error(data.error ?? res.statusText) as Error & {
        offline?: boolean;
      };
      err.offline = res.status === 403 || res.status === 503;
      throw err;
    }
    return data as DemoProof;
  }

  async function run(id: StepId) {
    try {
      if (id === "check") {
        set(id, { phase: "running", label: "Asking the gate…" });
        set(id, { phase: "done", decision: await gate(intentFor(payee)) });
      } else if (id === "prove") {
        set(id, { phase: "running", label: "Payee is generating a proof…" });
        const p = await prove("holder");
        proofRef.current = p.zkProof;
        set(id, { phase: "running", label: "Gate is verifying the proof…" });
        const decision = await gate(intentFor(payee, p.zkProof));
        set(id, { phase: "done", decision, proof: p });
      } else if (id === "replay") {
        if (!proofRef.current) throw new Error("Run step 2 first.");
        set(id, { phase: "running", label: "Replaying the proof…" });
        const decision = await gate(intentFor(payee, proofRef.current));
        set(id, { phase: "done", decision });
      } else {
        set(id, { phase: "running", label: "Revoked payee is proving…" });
        const p = await prove("revoked");
        set(id, { phase: "running", label: "Gate is checking…" });
        const decision = await gate(intentFor(revokedPayee, p.zkProof));
        set(id, { phase: "done", decision, proof: p });
      }
      requestAnimationFrame(() => headings.current[id]?.focus());
    } catch (e) {
      const err = e as Error & { offline?: boolean };
      set(id, { phase: "error", message: err.message, offline: err.offline });
    }
  }

  function reset() {
    proofRef.current = null;
    setStates({
      check: { phase: "idle" },
      prove: { phase: "idle" },
      replay: { phase: "idle" },
      revoked: { phase: "idle" },
    });
  }

  return (
    <section className="mt-14" aria-labelledby="zcash-demo-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="zcash-demo-title" className="eyebrow">
          The payment
        </h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          <span aria-live="polite">
            {doneCount} of {STEPS.length} done
          </span>
          {doneCount > 0 ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={reset}
                className="uppercase underline decoration-rule decoration-1 underline-offset-4 hover:text-ink hover:decoration-terra"
              >
                start over
              </button>
            </>
          ) : null}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-rule pt-4 sm:grid-cols-[auto_1fr]">
        <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          Paying
        </dt>
        <dd className="font-serif text-base text-ink">
          0.25 ZEC <span className="text-ink-quiet">(≈ $25)</span>, shielded
        </dd>
        <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          To
        </dt>
        <dd className="min-w-0 font-mono text-sm text-ink [overflow-wrap:anywhere]">
          {payee}
        </dd>
        <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          For
        </dt>
        <dd className="font-serif text-base text-ink">
          Escrow release · needs{" "}
          <Term term="permission">
            <code className="font-mono text-sm">{capability}</code>
          </Term>
        </dd>
        <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          Contract
        </dt>
        <dd className="font-serif text-base text-ink-soft">
          This payee, up to $50
        </dd>
      </dl>

      {!live ? (
        <p className="mt-6 border-l-2 border-terra pl-4 font-serif text-sm leading-relaxed text-ink-soft">
          Live proof generation is off on this server, so steps 2–4 show what a
          live run returns. To run them for real:{" "}
          <code className="font-mono text-[13px]">
            LIGIS_ZK_ROOT_MANIFEST=demo pnpm --filter @ligis/web start
          </code>{" "}
          with nargo and bb installed, or{" "}
          <code className="font-mono text-[13px]">pnpm demo:zcash-zk</code>.
        </p>
      ) : null}

      <ol className="mt-10 space-y-10">
        {STEPS.map((step, i) => {
          const st = states[step.id];
          const locked =
            i > 0 &&
            states[STEPS[i - 1]!.id].phase !== "done" &&
            !(step.id === "revoked" && states.prove.phase === "done");
          const isCurrent = current === step.id;
          const needsProver = step.id !== "check";
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`border-l-2 pl-6 ${isCurrent ? "border-terra" : "border-rule"}`}
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                Step {i + 1}
                {st.phase === "done" ? " · done" : locked ? " · locked" : ""}
              </p>
              <h3
                ref={(el) => {
                  headings.current[step.id] = el;
                }}
                tabIndex={-1}
                className="mt-1 font-serif text-xl text-ink"
              >
                {step.title}
              </h3>
              <p className="mt-2 max-w-xl font-serif text-base leading-relaxed text-ink-soft">
                {step.story}
              </p>

              {st.phase === "idle" || st.phase === "error" ? (
                <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                  <button
                    type="button"
                    disabled={locked || (needsProver && !live)}
                    onClick={() => run(step.id)}
                    className="border border-terra px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:bg-terra hover:text-paper disabled:border-rule disabled:text-ink-quiet disabled:hover:bg-transparent"
                  >
                    {step.action}
                  </button>
                  <span className="font-serif text-sm italic text-ink-quiet">
                    {locked
                      ? `Finish step ${i} first.`
                      : needsProver && !live
                        ? `Live run: ${step.expect.replace(/^Expect /, "")}`
                        : step.expect}
                  </span>
                </div>
              ) : null}

              <div role="status" aria-live="polite" className="mt-4">
                {st.phase === "running" ? (
                  <p className="font-serif text-base italic text-ink-soft">
                    {st.label}
                    <span className="caret" aria-hidden />
                  </p>
                ) : st.phase === "error" ? (
                  <p className="border-l-2 border-terra pl-4 font-serif text-sm text-ink">
                    {st.offline
                      ? `Live proving isn't available here: ${st.message}`
                      : `Something went wrong: ${st.message}. Try the step again.`}
                  </p>
                ) : st.phase === "done" ? (
                  <StepResult step={step.id} state={st} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {doneCount === STEPS.length ? (
        <div className="mt-12 border-t border-rule pt-6">
          <p className="font-serif text-xl text-ink">
            That&rsquo;s the whole story.
          </p>
          <p className="mt-2 max-w-xl font-serif text-base leading-relaxed text-ink-soft">
            The agent paid a shielded payee only after a private proof, and
            refused a replay and a revoked credential, without anyone learning
            who the payee is.
          </p>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em]">
            <Link
              href="/gate"
              className="text-ink underline decoration-terra decoration-1 underline-offset-4"
            >
              Gate your own payment →
            </Link>
            <button
              type="button"
              onClick={reset}
              className="uppercase text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-ink"
            >
              Run it again
            </button>
          </p>
        </div>
      ) : null}
    </section>
  );
}

function StepResult({
  step,
  state,
}: {
  step: StepId;
  state: Extract<StepState, { phase: "done" }>;
}) {
  const { decision, proof } = state;
  return (
    <div className="space-y-6">
      {proof ? (
        <div className="font-serif text-sm leading-relaxed text-ink-soft">
          <p>
            Proof generated in {proof.provedInMs}ms (
            {Math.round(proof.proofBytes / 1024)} KB), against registry{" "}
            <span className="font-mono tabular">{shortHash(proof.root)}</span>.
          </p>
          {step === "prove" ? (
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  The gate learns
                </dt>
                <dd>
                  this payee address, this permission, still valid, a one-time
                  tag
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
                  Stays private
                </dt>
                <dd>who the payee is, who issued it, which credential</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : null}
      {decision.zkCredential ? (
        <ZkCredentialResultView zk={decision.zkCredential} />
      ) : null}
      <DecisionVerdict decision={decision} eyebrow="gate · decision" />
    </div>
  );
}
