"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOG_CONFIG, rigState } from "./catalogState";

export function FieldChrome({ leaveHref }: { leaveHref: string }) {
  const router = useRouter();
  const [far, setFar] = useState(false);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFar(rigState.zoom >= CATALOG_CONFIG.lodMarker);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 8_000);
    return () => window.clearTimeout(id);
  }, [hint]);

  function leave() {
    router.push(leaveHref);
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-x-0 top-24 flex flex-col items-center px-5 text-center sm:top-28">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
          {far
            ? "the registry · zoom in to resolve identities"
            : "the registry"}
        </p>
      </div>

      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 px-5 text-center sm:bottom-10">
        {hint ? (
          <button
            type="button"
            onClick={() => setHint(false)}
            className="pointer-events-auto font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet hover:text-ink-soft"
          >
            <span className="hidden sm:inline">
              drag · scroll · pinch · WASD · click a specimen
            </span>
            <span className="sm:hidden">drag · pinch · tap</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={leave}
          className="pointer-events-auto font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-terra"
        >
          Esc · leave the field
        </button>
      </div>
    </div>
  );
}
