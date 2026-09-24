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
    body: "Refuse. Payment never starts.",
  },
  {
    id: "credential-no-pay",
    label: "Credential only",
    status: "402",
    statusClass: "text-sky",
    body: "Eligible — return x402 price. Not paid yet.",
  },
  {
    id: "credential-and-pay",
    label: "Credential + pay",
    status: "200",
    statusClass: "text-sage",
    body: "Deliver. Capability checked, payment settled.",
  },
];

/**
 * Interactive three-state gate branch. Toggle only — no scale/translate.
 */
export function GateStates() {
  const [branch, setBranch] = useState<Branch>("no-credential");
  const active = BRANCHES.find((b) => b.id === branch)!;

  return (
    <div>
      <p className="eyebrow">Walk the branch</p>
      <Rule className="mt-3" />

      <div
        className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2"
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
            className={`py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
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
        key={branch}
        className="animate-fade-in mt-5 flex items-baseline gap-4 border-t border-rule pt-4"
        role="tabpanel"
        aria-live="polite"
      >
        <span
          className={`font-mono text-3xl tabular tracking-tight sm:text-4xl ${active.statusClass}`}
        >
          {active.status}
        </span>
        <p className="max-w-md font-serif text-sm leading-relaxed text-ink sm:text-base">
          {active.body}
        </p>
      </div>
    </div>
  );
}
