"use client";

import Link from "next/link";
import type { SubjectChainMismatch } from "@/lib/subject-format";

/** Inline “wrong chain — switch?” affordance under a subject field or error. */
export function ChainSwitchHint({
  mismatch,
  href,
}: {
  mismatch: SubjectChainMismatch;
  href: string;
}) {
  return (
    <p className="font-serif text-sm leading-relaxed text-ink-soft">
      {mismatch.message}{" "}
      <Link
        href={href}
        className="text-terra underline decoration-terra/40 decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
      >
        Switch to {mismatch.suggestedChainName} →
      </Link>
    </p>
  );
}
