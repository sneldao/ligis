"use client";

import { useState } from "react";
import { Rule } from "@/components/Rule";

type Branch = "no-credential" | "credential-no-pay" | "credential-and-pay";

const BRANCHES: {
  id: Branch;
  label: string;
  status: string;
  statusClass: string;
  body: string;
}[] = [
  {
    id: "no-credential",
    label: "No credential",
    status: "401",
    statusClass: "text-revoke",
    body: "Refuse. The caller can't prove they're allowed — payment never starts.",
  },
  {
    id: "credential-no-pay",
    label: "Credential, no payment",
    status: "402",
    statusClass: "text-sky",
    body: "Price it. Return x402 PaymentRequirements — eligible, not yet paid.",
  },
  {
    id: "credential-and-pay",
    label: "Credential + payment",
    status: "200",
    statusClass: "text-sage",
    body: "Deliver. Capability checked, payment settled — return the resource.",
  },
];

/**
 * Interactive three-state gate: the x402 / Trust Gate branch visitors walk.
 * Toggle only — no scale/translate motion.
 */
export function GateStates() {
  const [branch, setBranch] = useState<Branch>("no-credential");
  const active = BRANCHES.find((b) => b.id === branch)!;

  return (
    <div>
      <p className="eyebrow">Walk the branch</p>
      <Rule className="mt-3" />
      <p className="mt-4 max-w-xl font-serif text-sm leading-relaxed text-ink-soft">
        Same endpoint, three outcomes. Toggle what the caller has — this is the
        check merchants and spend agents actually run.
      </p>

      <div
        className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2"
        role="tablist"
        aria-label="Gate branch"
      >
        {BRANCHES.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={branch === b.id}
            onClick={() => setBranch(b.id)}
            className={`py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
              branch === b.id
                ? "text-ink underline decoration-terra decoration-1 underline-offset-4"
                : "text-ink-quiet hover:text-ink"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div
        className="mt-6 border-t border-rule pt-5"
        role="tabpanel"
        aria-live="polite"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          Agent wants premium data
          <span className="mx-2">→</span>
          <span className={active.statusClass}>{active.status}</span>
        </p>
        <p className="mt-3 max-w-xl font-serif text-base leading-relaxed text-ink">
          {active.body}
        </p>
      </div>
    </div>
  );
}
