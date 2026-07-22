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

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) setCopied(true);
      }}
      className={`inline-flex items-baseline text-[11px] tracking-[0.16em] uppercase transition-colors ${
        copied ? "text-sage" : "text-ink-quiet hover:text-ink"
      } ${className}`}
      aria-label={`copy ${value}`}
    >
      {copied ? "copied" : label}
    </button>
  );
}
