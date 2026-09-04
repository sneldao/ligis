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

  const tone = copied ? "text-sage" : "text-ink-quiet hover:text-ink";

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
          className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] transition-colors ${tone}`}
          aria-label="Copy snippet"
        >
          {copied ? (
            <>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="2,6.5 5,9 10,3" />
              </svg>
              copied
            </>
          ) : (
            "copy"
          )}
        </button>
      </div>
      <pre className="overflow-x-auto bg-paper-deep px-6 py-5 font-mono text-[13px] leading-relaxed tabular text-ink">
        {code}
      </pre>
    </div>
  );
}
