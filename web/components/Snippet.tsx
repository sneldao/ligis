"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

export function Snippet({ code, lang = "ts" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">{lang}</p>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyToClipboard(code);
            if (ok) setCopied(true);
          }}
          className={`text-[11px] uppercase tracking-[0.16em] transition-colors ${
            copied ? "text-sage" : "text-ink-quiet hover:text-ink"
          }`}
          aria-label="Copy snippet"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-paper-deep px-6 py-5 font-mono text-[13px] leading-relaxed tabular text-ink">
        {code}
      </pre>
    </div>
  );
}
