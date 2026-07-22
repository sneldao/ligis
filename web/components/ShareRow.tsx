"use client";

import { useEffect, useState } from "react";
import { recordVisit } from "@/lib/recent-agents";
import { copyToClipboard } from "@/lib/clipboard";

export function ShareRow({
  url,
  text,
  agentAddress,
}: {
  url: string;
  text: string;
  agentAddress?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  useEffect(() => {
    if (agentAddress) recordVisit(agentAddress);
  }, [agentAddress]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  const tweetHref = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const blueskyHref = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`;

  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
      <button
        type="button"
        onClick={async () => {
          const ok = await copyToClipboard(url);
          if (ok) setCopied(true);
        }}
        className={`underline decoration-rule decoration-1 underline-offset-4 transition-colors ${
          copied ? "text-sage decoration-sage" : "text-ink hover:decoration-terra"
        }`}
      >
        {copied ? "url copied" : "copy url"}
      </button>
      <a
        href={tweetHref}
        target="_blank"
        rel="noreferrer"
        className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
      >
        share on X ↗
      </a>
      <a
        href={blueskyHref}
        target="_blank"
        rel="noreferrer"
        className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
      >
        share on Bluesky ↗
      </a>
      {canNativeShare ? (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.share({ title: "Ligis · agent", text, url });
            } catch {}
          }}
          className="text-ink-soft underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-terra"
        >
          share ↗
        </button>
      ) : null}
    </div>
  );
}
