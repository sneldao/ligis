"use client";

import { useId, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/**
 * Inline glossary term: a dotted-underline button that discloses a
 * one-sentence definition in place. Keyboard and screen-reader friendly
 * (button + aria-expanded), no hover-only tooltip.
 */
export function Term({
  term,
  children,
}: {
  term: GlossaryKey;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="cursor-help text-left underline decoration-ink-quiet decoration-dotted decoration-1 underline-offset-4 transition-colors hover:decoration-terra"
      >
        {children}
        <span className="sr-only"> (what does this mean?)</span>
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className="my-2 block border-l border-rule pl-3 font-serif text-sm not-italic leading-relaxed text-ink-soft"
      >
        {GLOSSARY[term]}
      </span>
    </>
  );
}
