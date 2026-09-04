"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

export function CopyButton({
  value,
  label = "copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);

  const tone = copied ? "text-sage" : "text-ink-quiet hover:text-ink";

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) setCopied(true);
      }}
      className={`inline-flex items-center gap-1 text-[11px] tracking-[0.16em] uppercase transition-colors ${tone} ${className}`}
      aria-label={`copy ${value}`}
    >
      {copied ? (
        <>
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="2,6.5 5,9 10,3" />
          </svg>
          copied
        </>
      ) : (
        label
      )}
    </button>
  );
}
